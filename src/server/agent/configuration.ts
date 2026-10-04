import { Type } from '@earendil-works/pi-ai';
import { configure, defineExtension, defineTool } from '@earendil-works/pi-durable';
import type { Models } from '../models/index.js';
import { configurationChangeSchema } from '../permissions/contract.js';
import type { Permissions } from '../permissions/index.js';
import { HttpError } from '../platform/http.js';
import type { Settings } from '../settings/index.js';

function result(value: unknown) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 16 * 1024)
    throw new HttpError(400, 'Configuration inspection exceeds 16 KiB. Use the settings UI.');
  return {
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
  };
}

export function configurationTools(settings: Settings, models: Models, permissions: Permissions) {
  const inspect = defineTool({
    name: 'settings_inspect',
    description:
      'Inspect validated non-secret settings, revision and available models. This does not authorize changes or access to secrets.',
    parameters: Type.Object(
      {},
      {
        additionalProperties: false,
      },
    ),
    replay: 'safe',
    executionMode: 'sequential',
    outputLimits: {
      maxBytes: 16384,
    },
    async execute() {
      const view = await settings.view();
      const catalog = await models.catalog();
      return result({
        revision: view.revision,
        models: view.active.models,
        savedPermissionCount: view.active.permissions.length,
        error: view.error,
        availableModels: catalog.models.slice(0, 20),
        moreModels: catalog.models.length > 20,
      });
    },
  });
  const change = defineTool({
    name: 'settings_change',
    description:
      'Request an exact model-default change for the next user message, optionally switching this reply at its next model request. User approval is required unless this exact scope has a saved rule. Inspect first. Cannot edit permissions, credentials, references, endpoints, or other conversations.',
    parameters: Type.Object(
      {
        revision: Type.String({
          pattern: '^[a-f0-9]{64}$',
          maxLength: 64,
        }),
        defaults: Type.Object(
          {
            provider: Type.String({
              minLength: 1,
              maxLength: 80,
            }),
            modelId: Type.String({
              minLength: 1,
              maxLength: 120,
            }),
            thinkingLevel: Type.String({
              maxLength: 10,
            }),
          },
          {
            additionalProperties: false,
          },
        ),
        switchConversation: Type.Boolean(),
      },
      {
        additionalProperties: false,
      },
    ),
    replay: 'unsafe',
    executionMode: 'sequential',
    outputLimits: {
      maxBytes: 1024,
    },
    async execute(args, api, context) {
      try {
        const input = configurationChangeSchema.parse(args);
        const signal = context.abortSignal ?? AbortSignal.timeout(120_000);
        const view = await settings.view();
        if (
          !view.active.models.connections.some((item) => item.provider === input.defaults.provider)
        )
          throw new HttpError(403, 'Connect the provider through Settings first.');
        await models.validateSelection(input.defaults);
        const revision = await permissions.authorizeConfiguration(
          String(api.conversationId),
          String(api.taskId),
          input,
          signal,
        );
        await models.saveDefaults(input.defaults, revision, signal);
        if (input.switchConversation) {
          await api.commit(
            (tx) =>
              configure(tx, api.conversationId, {
                model: {
                  provider: input.defaults.provider,
                  modelId: input.defaults.modelId,
                },
                thinkingLevel: input.defaults.thinkingLevel,
              }),
            context,
          );
        }
        return result({
          applied: true,
          switched: input.switchConversation,
        });
      } catch (error) {
        return {
          ...result({
            error:
              error instanceof HttpError
                ? error.message
                : 'Configuration change was not completed. Inspect settings before retrying.',
          }),
          isError: true,
        };
      }
    },
  });
  return defineExtension({
    name: 'clef-configuration',
    tools: [
      inspect,
      change,
    ],
  });
}
