import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function createHttpServer() {
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    forceCloseConnections: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
  });
  app.addHook('onRequest', async (request, reply) => {
    const port = request.raw.socket.localPort ?? 3737;
    const hosts = [
      `127.0.0.1:${port}`,
      `localhost:${port}`,
    ];
    if (!hosts.includes(request.headers.host ?? '')) throw new HttpError(403, 'Invalid host.');
    const origin = request.headers.origin;
    if (origin && !hosts.some((host) => origin === `http://${host}`))
      throw new HttpError(403, 'Cross-origin access is not allowed.');
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({
        error: error.message,
      });
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'Check the input and try again.',
      });
    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({
        error:
          error.statusCode === 429
            ? 'Too many attempts. Wait one minute and try again.'
            : 'The request was rejected.',
      });
    }
    return reply.code(500).send({
      error: 'The request could not be completed.',
    });
  });
  return app;
}
