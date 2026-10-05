import { z } from 'zod';
import { modelSettingsSchema } from '../models/contract.js';
import { permissionRequestSchema } from '../permissions/contract.js';

const uiKeySchema = z
  .string()
  .regex(/^(?!__proto__$|constructor$|prototype$)[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const uiLabelSchema = z.string().min(1).max(240);
const uiTextSchema = z.string().max(4000);
const uiBindingSchema = z.strictObject({
  $bindState: z
    .string()
    .regex(/^\/(?!__proto__$|constructor$|prototype$)[A-Za-z][A-Za-z0-9_-]{0,63}$/),
});
const uiChildrenSchema = z.array(uiKeySchema).max(64);

export const uiComponents = {
  Card: z.strictObject({
    title: uiLabelSchema,
  }),
  Stack: z.strictObject({
    direction: z.enum([
      'vertical',
      'horizontal',
    ]),
  }),
  Text: z.strictObject({
    text: uiTextSchema,
  }),
  Table: z.strictObject({
    columns: z.array(uiLabelSchema).min(1).max(8),
    rows: z.array(z.array(uiTextSchema).max(8)).max(30),
  }),
  Input: z.strictObject({
    label: uiLabelSchema,
    value: uiTextSchema,
  }),
  Textarea: z.strictObject({
    label: uiLabelSchema,
    value: uiTextSchema,
  }),
  Select: z.strictObject({
    label: uiLabelSchema,
    value: uiTextSchema,
    options: z
      .array(
        z.strictObject({
          label: uiLabelSchema,
          value: z.string().min(1).max(240),
        }),
      )
      .min(1)
      .max(40),
  }),
  Checkbox: z.strictObject({
    label: uiLabelSchema,
    checked: z.boolean(),
  }),
  Button: z.strictObject({
    label: uiLabelSchema,
  }),
};

export const uiIntentSchema = z.strictObject({
  intent: uiLabelSchema,
});
const uiStateSchema = z
  .record(
    uiKeySchema,
    z.union([
      uiTextSchema,
      z.boolean(),
      z.number().finite(),
    ]),
  )
  .refine((state) => Object.keys(state).length <= 32, 'Use at most 32 state fields.');

export const uiSpecSchema = z.strictObject({
  root: uiKeySchema,
  elements: z
    .record(
      uiKeySchema,
      z.discriminatedUnion('type', [
        z.strictObject({
          type: z.literal('Card'),
          props: uiComponents.Card,
          children: uiChildrenSchema,
        }),
        z.strictObject({
          type: z.literal('Stack'),
          props: uiComponents.Stack,
          children: uiChildrenSchema,
        }),
        z.strictObject({
          type: z.literal('Text'),
          props: uiComponents.Text,
        }),
        z.strictObject({
          type: z.literal('Table'),
          props: uiComponents.Table,
        }),
        z.strictObject({
          type: z.literal('Input'),
          props: uiComponents.Input.extend({
            value: uiBindingSchema,
          }),
        }),
        z.strictObject({
          type: z.literal('Textarea'),
          props: uiComponents.Textarea.extend({
            value: uiBindingSchema,
          }),
        }),
        z.strictObject({
          type: z.literal('Select'),
          props: uiComponents.Select.extend({
            value: uiBindingSchema,
          }),
        }),
        z.strictObject({
          type: z.literal('Checkbox'),
          props: uiComponents.Checkbox.extend({
            checked: uiBindingSchema,
          }),
        }),
        z.strictObject({
          type: z.literal('Button'),
          props: uiComponents.Button,
          on: z.strictObject({
            press: z.strictObject({
              action: z.literal('submit'),
              params: uiIntentSchema,
            }),
          }),
        }),
      ]),
    )
    .refine((elements) => Object.keys(elements).length <= 64, 'Use at most 64 elements.'),
  state: uiStateSchema,
});
export type UiSpec = z.infer<typeof uiSpecSchema>;
export const uiResultSchema = z.strictObject({
  spec: uiSpecSchema,
});
export const uiAnswerSchema = z.strictObject({
  intent: uiLabelSchema,
  values: uiStateSchema,
});
export type UiAnswer = z.infer<typeof uiAnswerSchema>;
export const uiSubmissionSchema = uiAnswerSchema.extend({
  messageId: z.string().min(1).max(100),
});
export type UiSubmission = z.infer<typeof uiSubmissionSchema>;

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
  ui: uiResultSchema
    .extend({
      submitted: z.boolean(),
      answer: uiAnswerSchema.optional(),
    })
    .optional(),
});
export type ChatMessage = z.infer<typeof messageSchema>;
const conversationSchema = z.object({
  id: z.string(),
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
export const sendInputSchema = z.union([
  z.strictObject({
    text: z.string().trim().min(1).max(32000),
    requestId: z.string().uuid(),
  }),
  z.strictObject({
    ui: uiSubmissionSchema,
  }),
]);
export type SendInput = z.infer<typeof sendInputSchema>;
