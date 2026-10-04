import type { FastifyReply } from 'fastify';

export function openEvents(reply: FastifyReply) {
  reply.hijack();
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) reply.raw.setHeader(name, value);
  }
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  const closed = new Promise<void>((resolve) => {
    reply.raw.once('close', resolve);
  });
  const timeout = setTimeout(() => reply.raw.end(), 60_000);
  reply.raw.once('close', () => clearTimeout(timeout));
  return {
    closed,
    async send(event: string, value: Record<string, unknown>): Promise<void> {
      if (reply.raw.destroyed) return;
      if (!reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            reply.raw.off('drain', finish);
            reply.raw.off('close', finish);
            resolve();
          };
          reply.raw.once('drain', finish);
          reply.raw.once('close', finish);
          if (reply.raw.destroyed) finish();
        });
      }
    },
  };
}
