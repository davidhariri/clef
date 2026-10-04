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
export const modelSettingsSchema = z.strictObject({
  provider: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/),
  modelId: z.string().min(1).max(120),
  thinkingLevel: thinkingSchema,
});
export type ModelSettings = z.infer<typeof modelSettingsSchema>;
export const modelConfigurationSchema = z.strictObject({
  defaults: modelSettingsSchema.nullable(),
  connections: z
    .array(
      z.union([
        z.strictObject({
          provider: z.literal('ollama'),
          url: z.string().min(1).max(2048),
        }),
        z.strictObject({
          provider: z
            .string()
            .min(1)
            .max(80)
            .regex(/^[a-zA-Z0-9_-]+$/),
          secretRef: z.string().min(1).max(100),
        }),
      ]),
    )
    .max(20),
});
export type ModelConfiguration = z.infer<typeof modelConfigurationSchema>;
export const catalogSchema = z.object({
  revision: z.string(),
  configurationError: z.string().nullable(),
  defaults: modelSettingsSchema.nullable(),
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      oauth: z.boolean(),
      connected: z.boolean(),
      url: z.string().optional(),
      error: z.string().optional(),
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
