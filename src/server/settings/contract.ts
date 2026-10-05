import { z } from 'zod';
import { modelConfigurationSchema } from '../models/contract.js';
import { fileAccessSchema, permissionRulesSchema } from '../permissions/contract.js';

export const settingsSchema = z.strictObject({
  version: z.literal(1),
  models: modelConfigurationSchema,
  permissions: permissionRulesSchema,
  files: fileAccessSchema,
});

export type SettingsDocument = z.infer<typeof settingsSchema>;

export const settingsViewSchema = z.object({
  revision: z.string(),
  active: settingsSchema,
  error: z.string().nullable(),
});

export const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export type SettingsView = z.infer<typeof settingsViewSchema>;
