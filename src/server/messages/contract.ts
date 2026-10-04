import { z } from 'zod';
import { modelSettingsSchema } from '../models/contract.js';
import { permissionRequestSchema } from '../permissions/contract.js';

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum([
    'user',
    'assistant',
    'tool',
  ]),
  text: z.string(),
  error: z.boolean(),
  pending: z.boolean(),
});
export type ChatMessage = z.infer<typeof messageSchema>;
export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  model: modelSettingsSchema,
});
export type ConversationInfo = z.infer<typeof conversationSchema>;
export const snapshotSchema = z.object({
  conversation: conversationSchema,
  messages: z.array(messageSchema),
  busy: z.boolean(),
  permissions: z.array(permissionRequestSchema),
});
export type ConversationSnapshot = z.infer<typeof snapshotSchema>;
export const sendInputSchema = z
  .object({
    text: z.string().trim().min(1).max(32000),
    requestId: z.string().uuid(),
  })
  .strict();
