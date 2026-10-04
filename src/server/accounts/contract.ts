import { z } from 'zod';

export const accountInputSchema = z
  .object({
    username: z.string().trim().min(1).max(80),
    password: z.string().min(12).max(256),
    key: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();
export type AccountInput = z.infer<typeof accountInputSchema>;
export const loginInputSchema = z
  .object({
    username: z.string().max(80),
    password: z.string().max(256),
  })
  .strict();
export const statusSchema = z.object({
  phase: z.enum([
    'setup',
    'login',
    'locked',
    'connect',
    'ready',
  ]),
  hostname: z.string(),
});
export type AppStatus = z.infer<typeof statusSchema>;
export const okSchema = z.object({
  ok: z.literal(true),
});
