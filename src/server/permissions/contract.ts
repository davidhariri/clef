import { z } from 'zod';

export const permissionChoiceSchema = z.enum([
  'deny',
  'once',
  'always',
  'never',
]);
export type PermissionChoice = z.infer<typeof permissionChoiceSchema>;
export const permissionRequestSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  url: z.string(),
  origin: z.string(),
  method: z.literal('GET'),
  expiresAt: z.number(),
});
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;
export const permissionRuleSchema = z.object({
  origin: z.string(),
  method: z.literal('GET'),
  decision: z.enum([
    'allow',
    'deny',
  ]),
});
export type PermissionRule = z.infer<typeof permissionRuleSchema>;
