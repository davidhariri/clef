import type { FastifyInstance } from 'fastify';
import type { Files } from './service.js';

export function registerFileRoutes(app: FastifyInstance, files: Files): void {
  app.get('/api/files/access', async () => files.access());
  app.put('/api/files/access', async (request) => files.saveAccess(request.body));
}
