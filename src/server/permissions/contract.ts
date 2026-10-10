import { z } from 'zod';
import { modelSettingsSchema } from '../models/contract.js';

export const filePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      Array.from(path).every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
    'Control characters are not allowed in paths.',
  );
export const directoryPathSchema = filePathSchema.refine(
  (path) =>
    path.startsWith('/') &&
    (path === '/' ||
      path
        .split('/')
        .slice(1)
        .every((part) => part !== '' && part !== '.' && part !== '..')),
  'Use a normalized absolute directory path.',
);
export const directoryAccessSchema = z.enum([
  'read',
  'read-write',
  'deny',
]);
export const directoryRuleSchema = z
  .strictObject({
    path: directoryPathSchema,
    access: directoryAccessSchema,
  })
  .refine(
    (rule) => rule.path !== '/' || rule.access !== 'read-write',
    'Use the global setting for root read/write access.',
  );
export const fileAccessSchema = z.strictObject({
  global: z.boolean(),
  directories: z
    .array(directoryRuleSchema)
    .max(100)
    .refine(
      (rules) => new Set(rules.map((rule) => rule.path)).size === rules.length,
      'Duplicate directory paths are not allowed.',
    ),
});
export type FileAccess = z.infer<typeof fileAccessSchema>;

export function requiresGlobalConfirmation(
  current: FileAccess,
  next: FileAccess,
  confirmed: boolean,
): boolean {
  return next.global && !current.global && !confirmed;
}

export type DirectoryRule = z.infer<typeof directoryRuleSchema>;
export const fileOperationSchema = z.enum([
  'list',
  'read',
  'write',
  'mkdir',
  'delete',
]);
export type FileOperation = z.infer<typeof fileOperationSchema>;
export const fileActionSchema = z.strictObject({
  path: directoryPathSchema,
  directory: directoryPathSchema,
  operation: fileOperationSchema,
  version: z.string().max(256),
  bytes: z.number().int().nonnegative().max(65536).optional(),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type FileAction = z.infer<typeof fileActionSchema>;
const fileRequestSchema = fileActionSchema.extend({
  kind: z.literal('file'),
  id: z.string(),
  conversationId: z.string(),
  callId: z.string(),
  revision: z.string(),
  expiresAt: z.number(),
});

export const permissionChoiceSchema = z.enum([
  'deny',
  'once',
  'always',
  'never',
]);
export type PermissionChoice = z.infer<typeof permissionChoiceSchema>;
const webRequestSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  url: z.string(),
  origin: z.string(),
  method: z.literal('GET'),
  expiresAt: z.number(),
});
const webRuleSchema = z.strictObject({
  origin: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.origin === value;
      } catch {
        return false;
      }
    }),
  method: z.literal('GET'),
  decision: z.enum([
    'allow',
    'deny',
  ]),
});
export const configurationScopeSchema = z.strictObject({
  kind: z.literal('configuration'),
  conversationId: z.string().min(1).max(80),
  defaults: modelSettingsSchema,
  switchConversation: z.boolean(),
});
export type ConfigurationScope = z.infer<typeof configurationScopeSchema>;
export const configurationChangeSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  defaults: modelSettingsSchema,
  switchConversation: z.boolean(),
});
export type ConfigurationChange = z.infer<typeof configurationChangeSchema>;
const configurationRequestSchema = configurationScopeSchema.extend({
  id: z.string(),
  callId: z.string(),
  revision: z.string(),
  expiresAt: z.number(),
});
export const permissionRequestSchema = z.union([
  webRequestSchema,
  configurationRequestSchema,
  fileRequestSchema,
]);
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;
export const permissionRuleSchema = z.union([
  webRuleSchema,
  configurationScopeSchema.extend({
    decision: z.enum([
      'allow',
      'deny',
    ]),
  }),
]);
export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export function permissionScopeKey(rule: PermissionRule | ConfigurationScope): string {
  if ('kind' in rule)
    return JSON.stringify([
      rule.kind,
      rule.conversationId,
      rule.defaults.provider,
      rule.defaults.modelId,
      rule.defaults.thinkingLevel,
      rule.switchConversation,
    ]);
  return JSON.stringify([
    rule.origin,
    rule.method,
  ]);
}

export const permissionRulesSchema = z
  .array(permissionRuleSchema)
  .max(100)
  .refine(
    (rules) => new Set(rules.map(permissionScopeKey)).size === rules.length,
    'Duplicate permission scopes are not allowed.',
  );
