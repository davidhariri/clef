import { createProvider, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { z } from 'zod';
import { HttpError } from '../platform/http.js';
import { thinkingSchema } from './contract.js';

const tagsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string().min(1),
      remote_model: z.string().optional(),
    }),
  ),
});
const showSchema = z.object({
  capabilities: z.array(z.string()),
  remote_model: z.string().optional(),
  model_info: z.record(z.string(), z.unknown()).default({}),
  thinking: z
    .object({
      values: z.array(
        z.union([
          z.boolean(),
          z.string(),
        ]),
      ),
    })
    .optional(),
});

export function ollamaUrl(input: string): string {
  const parsed = z.url().safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Enter an HTTP or HTTPS Ollama server URL.');

  const url = new URL(parsed.data);
  if (
    ![
      'http:',
      'https:',
    ].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new HttpError(
      400,
      'Use the Ollama server URL without credentials, a path, a query, or a fragment.',
    );
  }

  return url.origin;
}

async function ollamaJson(
  url: string,
  path: string,
  signal: AbortSignal,
  model?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method: model ? 'POST' : 'GET',
      headers: model
        ? {
            'Content-Type': 'application/json',
          }
        : {},
      body: model
        ? JSON.stringify({
            model,
          })
        : null,
      signal,
      redirect: 'error',
    });
  } catch {
    throw new HttpError(
      502,
      'Cannot reach Ollama. Check the server URL and its connection from the Clef server.',
    );
  }

  if (!response.ok)
    throw new HttpError(
      502,
      `Ollama model discovery failed (HTTP ${response.status}). Check the server and installed models.`,
    );

  try {
    return await response.json();
  } catch {
    throw new HttpError(502, 'Ollama returned an invalid model discovery response.');
  }
}

function thinkingMap(
  info: z.infer<typeof showSchema>,
): NonNullable<Model<'openai-completions'>['thinkingLevelMap']> {
  if (!info.capabilities.includes('thinking')) return {};

  const values = info.thinking?.values;
  if (!values)
    throw new HttpError(
      502,
      'Ollama did not report supported thinking settings. Update Ollama and try again.',
    );

  const map: Partial<Record<z.infer<typeof thinkingSchema>, string | null>> = Object.fromEntries(
    thinkingSchema.options.map((level) => [
      level,
      null,
    ]),
  );
  for (const level of thinkingSchema.options) {
    if (values.includes(level)) map[level] = level;
  }
  if (values.includes(false)) map.off = 'none';
  if (values.includes(true)) map.medium = 'medium';
  if (Object.values(map).every((value) => value === null))
    throw new HttpError(502, 'This Ollama model has no thinking settings supported by Clef.');

  return map;
}

function chatModel(
  url: string,
  id: string,
  info: z.infer<typeof showSchema>,
): Model<'openai-completions'> {
  const architecture = info.model_info['general.architecture'];
  const context = info.model_info[`${architecture}.context_length`];
  const contextWindow = typeof context === 'number' && context > 0 ? context : 4096;

  return {
    id,
    name: id,
    provider: 'ollama',
    api: 'openai-completions',
    baseUrl: `${url}/v1`,
    reasoning: info.capabilities.includes('thinking'),
    input: info.capabilities.includes('vision')
      ? [
          'text',
          'image',
        ]
      : [
          'text',
        ],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow,
    maxTokens: Math.min(8192, contextWindow),
    thinkingLevelMap: thinkingMap(info),
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: true,
      maxTokensField: 'max_tokens',
    },
  };
}

export async function discoverOllama(url: string): Promise<Model<'openai-completions'>[]> {
  const signal = AbortSignal.timeout(10_000);
  const tags = tagsSchema.safeParse(await ollamaJson(url, '/api/tags', signal));
  if (!tags.success) throw new HttpError(502, 'Ollama returned an invalid model list.');

  const models: Model<'openai-completions'>[] = [];
  for (const tag of tags.data.models) {
    if (tag.remote_model) continue;
    const show = showSchema.safeParse(await ollamaJson(url, '/api/show', signal, tag.name));
    if (!show.success) throw new HttpError(502, 'Ollama returned invalid model details.');
    if (show.data.remote_model || !show.data.capabilities.includes('completion')) continue;
    models.push(chatModel(url, tag.name, show.data));
  }
  if (!models.length)
    throw new HttpError(
      400,
      'Ollama has no installed local chat models. Install a chat model on that server, then connect again.',
    );

  return models;
}

export function ollamaProvider(models: readonly Model<'openai-completions'>[] = []) {
  return createProvider({
    id: 'ollama',
    name: 'Ollama',
    models,
    auth: {
      apiKey: {
        name: 'Ollama',
        resolve: async () =>
          models.length
            ? {
                auth: {
                  apiKey: 'ollama',
                },
              }
            : undefined,
      },
    },
    api: openAICompletionsApi(),
  });
}
