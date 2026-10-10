import { Type } from '@earendil-works/pi-ai';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { ZodError } from 'zod';
import { fileCommandSchema } from '../files/contract.js';
import type { Files } from '../files/index.js';
import { HttpError } from '../platform/http.js';

function result(value: unknown) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 512 * 1024)
    throw new HttpError(400, 'File result exceeds 512 KiB.');
  return {
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
  };
}

export function fileTools(files: Files) {
  return defineExtension({
    name: 'clef-files',
    tools: [
      defineTool({
        name: 'files_access',
        description:
          'Inspect the workspace root and current directory grants. This cannot grant permissions or enable global access.',
        parameters: Type.Object(
          {},
          {
            additionalProperties: false,
          },
        ),
        replay: 'safe',
        executionMode: 'sequential',
        outputLimits: {
          maxBytes: 512 * 1024,
        },
        async execute() {
          return result(await files.access());
        },
      }),
      defineTool({
        name: 'files',
        description:
          'List a directory, read UTF-8 text, write up to 64 KiB, create one directory, or delete one file. Relative paths start in the workspace. Use canonical absolute paths elsewhere. Parent directories must exist; mkdir creates one at a time. Reads return up to 64 KiB with nextOffset. Lists return at most 200 entries. Missing access pauses for user approval. Deletion ALWAYS needs separate approval. Moves, links, special files, Clef private files, and code execution are unavailable. Do not retry interrupted mutations blindly.',
        parameters: Type.Object(
          {
            operation: Type.Union(
              [
                'list',
                'read',
                'write',
                'mkdir',
                'delete',
              ].map((operation) => Type.Literal(operation)),
            ),
            path: Type.String({
              minLength: 1,
              maxLength: 4096,
            }),
            content: Type.Optional(
              Type.String({
                maxLength: 65536,
              }),
            ),
            offset: Type.Optional(
              Type.Integer({
                minimum: 0,
                maximum: Number.MAX_SAFE_INTEGER,
              }),
            ),
          },
          {
            additionalProperties: false,
          },
        ),
        replay: 'unsafe',
        executionMode: 'sequential',
        outputLimits: {
          maxBytes: 512 * 1024,
        },
        async execute(args, api, context) {
          try {
            const command = fileCommandSchema.parse(args);
            return result(
              await files.execute(command, {
                conversationId: String(api.conversationId),
                callId: String(api.taskId),
                signal: context.abortSignal ?? AbortSignal.timeout(120_000),
              }),
            );
          } catch (error) {
            return {
              ...result({
                error:
                  error instanceof HttpError
                    ? error.message
                    : error instanceof ZodError
                      ? 'Invalid file action. Check the operation, path, and size limits.'
                      : 'File action did not complete. Inspect the file before retrying a change.',
              }),
              isError: true,
            };
          }
        },
      }),
    ],
  });
}
