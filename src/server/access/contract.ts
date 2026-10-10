import { z } from 'zod';

export const okSchema = z.object({
  ok: z.literal(true),
});
export const statusSchema = z.object({
  phase: z.enum([
    'locked',
    'connect',
    'ready',
  ]),
  hostname: z.string(),
  local: z.boolean(),
});
export const clientSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  createdAt: z.number(),
});
export const clientsSchema = z.object({
  clients: z.array(clientSchema),
});
export const issuedClientSchema = clientSchema.extend({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
