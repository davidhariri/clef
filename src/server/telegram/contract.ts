import { z } from 'zod';

export const telegramInputSchema = z
  .object({
    token: z
      .string()
      .trim()
      .regex(/^\d+:[A-Za-z0-9_-]{20,200}$/),
  })
  .strict();

export const telegramStatusSchema = z.object({
  state: z.enum([
    'disconnected',
    'pairing',
    'connected',
  ]),
  username: z.string().optional(),
  ownerId: z.number().optional(),
  error: z.string().optional(),
});

export type TelegramStatus = z.infer<typeof telegramStatusSchema>;

export const telegramPairingSchema = z.object({
  url: z.url(),
  expiresAt: z.number(),
});

export type TelegramPairing = z.infer<typeof telegramPairingSchema>;
