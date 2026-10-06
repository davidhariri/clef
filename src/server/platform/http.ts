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
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.origin || request.headers['sec-fetch-site'])
      throw new HttpError(403, 'Browser access is not allowed.');
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
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
        error: 'The request was rejected.',
      });
    }
    return reply.code(500).send({
      error: 'The request could not be completed.',
    });
  });
  return app;
}
