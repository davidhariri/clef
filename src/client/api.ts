import { z } from 'zod';

type RequestOptions = {
  body?: Record<string, unknown>;
  method?: string;
  headers?: Record<string, string>;
};

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };
  if (options.body) init.body = JSON.stringify(options.body);
  const response = await fetch(path, init);
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = z
      .object({
        error: z.string(),
      })
      .safeParse(data);
    throw new Error(error.success ? error.data.error : 'The request failed.');
  }
  return schema.parse(data);
}
