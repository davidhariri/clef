import { z } from 'zod';

export const thinkingSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);
export const modelSettingsSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  thinkingLevel: thinkingSchema,
});
export type ModelSettings = z.infer<typeof modelSettingsSchema>;
export const catalogSchema = z.object({
  defaults: modelSettingsSchema.nullable(),
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      oauth: z.boolean(),
      connected: z.boolean(),
    }),
  ),
  models: z.array(
    z.object({
      provider: z.string(),
      id: z.string(),
      name: z.string(),
      thinkingLevels: z.array(thinkingSchema),
    }),
  ),
});
export type ModelCatalog = z.infer<typeof catalogSchema>;
export const loginStateSchema = z.object({
  id: z.string(),
  state: z.enum([
    'working',
    'waiting',
    'done',
    'failed',
  ]),
  url: z.string().optional(),
  message: z.string(),
  prompt: z.string().optional(),
  choices: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
    }),
  ),
});
export type LoginState = z.infer<typeof loginStateSchema>;
