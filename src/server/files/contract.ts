import { z } from 'zod';
import { fileAccessSchema, filePathSchema } from '../permissions/contract.js';

const pathSchema = filePathSchema;
export const fileCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('list'),
    path: pathSchema,
  }),
  z.strictObject({
    operation: z.literal('read'),
    path: pathSchema,
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  }),
  z.strictObject({
    operation: z.literal('write'),
    path: pathSchema,
    content: z.string().max(65536),
  }),
  z.strictObject({
    operation: z.literal('mkdir'),
    path: pathSchema,
  }),
  z.strictObject({
    operation: z.literal('delete'),
    path: pathSchema,
  }),
]);
export type FileCommand = z.input<typeof fileCommandSchema>;
export const fileAccessViewSchema = z.object({
  workspace: z.string(),
  revision: z.string(),
  policy: fileAccessSchema,
  error: z.string().nullable(),
});
export type FileAccessView = z.infer<typeof fileAccessViewSchema>;
export const fileAccessUpdateSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  policy: fileAccessSchema,
  confirmGlobal: z.boolean().default(false),
});
