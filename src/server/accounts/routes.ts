import { timingSafeEqual } from 'node:crypto';
import { hostname } from 'node:os';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Credentials } from '../credentials/index.js';
import type { Models } from '../models/index.js';
import { HttpError } from '../platform/http.js';
import { accountInputSchema, loginInputSchema } from './contract.js';
import type { Accounts } from './service.js';

export function registerAccountRoutes(
  app: FastifyInstance,
  accounts: Accounts,
  credentials: Credentials,
  models: Models,
  setupToken: string,
): void {
  const publicPaths = new Set([
    '/api/status',
    '/api/setup',
    '/api/login',
  ]);
  const session = async (reply: FastifyReply) => {
    reply.setCookie('clef', await accounts.createSession(), {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api',
      maxAge: 7 * 86400,
    });
  };
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || publicPaths.has(path)) return;
    const token = request.cookies.clef;
    if (!token) throw new HttpError(401, 'Sign in to continue.');
    if (path !== '/api/logout') {
      const unsubscribe = accounts.onSessionEnd(token, () => reply.raw.destroy());
      reply.raw.once('close', unsubscribe);
      reply.raw.once('finish', unsubscribe);
    }
    if (!(await accounts.sessionValid(token))) throw new HttpError(401, 'Sign in to continue.');
    if (credentials.locked && path !== '/api/credentials/recover' && path !== '/api/logout')
      throw new HttpError(423, 'Restore your encryption key first.');
  });
  app.get('/api/status', async (request) => {
    let phase: 'setup' | 'login' | 'locked' | 'connect' | 'ready';
    if (!(await accounts.hasAccount())) phase = 'setup';
    else if (!(await accounts.sessionValid(request.cookies.clef))) phase = 'login';
    else if (credentials.locked) phase = 'locked';
    else phase = (await models.catalog()).defaults ? 'ready' : 'connect';
    return {
      phase,
      hostname: hostname(),
    };
  });
  const rate = {
    config: {
      rateLimit: {
        max: 8,
        timeWindow: '1 minute',
      },
    },
  };
  app.post('/api/setup', rate, async (request, reply) => {
    const supplied = request.headers['x-clef-setup'];
    if (
      typeof supplied !== 'string' ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(setupToken) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(setupToken))
    )
      throw new HttpError(403, 'Open the setup link printed by the server.');
    if (await accounts.hasAccount()) throw new HttpError(409, 'Setup is already complete.');
    await accounts.setup(accountInputSchema.parse(request.body));
    await session(reply);
    return {
      ok: true,
    };
  });
  app.post('/api/login', rate, async (request, reply) => {
    const input = loginInputSchema.parse(request.body);
    if (!(await accounts.verifyPassword(input.username, input.password)))
      throw new HttpError(401, 'Incorrect username or password.');
    await session(reply);
    return {
      ok: true,
    };
  });
  app.post('/api/logout', async (request, reply) => {
    if (request.cookies.clef) await accounts.endSession(request.cookies.clef);
    reply.clearCookie('clef', {
      path: '/api',
    });
    return {
      ok: true,
    };
  });
}
