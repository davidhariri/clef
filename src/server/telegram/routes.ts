import type { FastifyInstance } from 'fastify';
import { HttpError } from '../platform/http.js';
import { TelegramError } from './client.js';
import { telegramInputSchema } from './contract.js';
import type { Telegram } from './service.js';

export function registerTelegramRoutes(app: FastifyInstance, telegram: Telegram): void {
  app.get('/api/telegram', async () => telegram.status());
  app.post('/api/telegram/connect', async (request) => {
    const { token } = telegramInputSchema.parse(request.body);
    try {
      return await telegram.connect(token);
    } catch (error) {
      if (error instanceof TelegramError) throw new HttpError(502, error.message);
      throw error;
    }
  });
  app.post('/api/telegram/pair', async () => telegram.pair());
  app.post('/api/telegram/disconnect', async () => {
    await telegram.disconnect();
    return {
      ok: true,
    };
  });
}
