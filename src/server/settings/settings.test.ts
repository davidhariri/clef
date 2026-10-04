import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testApplication } from '../../../tests/installation.js';
import { availablePort } from '../../../tests/network.js';
import { type SettingsView, settingsViewSchema } from './contract.js';

describe('settings API', () => {
  let clef: Awaited<ReturnType<typeof testApplication>>;
  let path: string;
  let source: string;
  let original: SettingsView;

  beforeEach(async () => {
    clef = await testApplication();
    path = join(clef.home, 'settings.yaml');
    source = await readFile(path, 'utf8');
    original = settingsViewSchema.parse(
      (
        await clef.server.inject({
          url: '/api/settings',
          headers: clef.headers,
        })
      ).json(),
    );
  });

  afterEach(async () => {
    await clef.dispose();
  });

  it('protects inspection, validation and replacement with authentication', async () => {
    for (const request of [
      {
        method: 'GET' as const,
        url: '/api/settings',
      },
      {
        method: 'POST' as const,
        url: '/api/settings/validate',
        payload: {
          source,
        },
      },
      {
        method: 'PUT' as const,
        url: '/api/settings',
        payload: {
          source,
          revision: original.revision,
        },
      },
    ]) {
      const response = await clef.server.inject({
        ...request,
        headers: {
          host: clef.headers.host,
        },
      });
      expect(response.statusCode).toBe(401);
    }
    const foreign = await clef.server.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: {
        ...clef.headers,
        origin: 'https://untrusted.example',
      },
      payload: {
        source,
        revision: original.revision,
      },
    });
    expect(foreign.statusCode).toBe(403);
    expect(
      (
        await clef.server.inject({
          url: '/api/settings',
          headers: clef.headers,
        })
      ).json(),
    ).toEqual(original);
  });

  it.each([
    [
      'malformed YAML',
      () => 'models: [',
    ],
    [
      'duplicate keys',
      (text: string) => `${text}\nversion: 1\n`,
    ],
    [
      'aliases',
      (text: string) => text.replace('permissions: []', 'permissions: &policy [*policy]'),
    ],
    [
      'unknown tags',
      (text: string) =>
        text.replace('permissions: []', 'permissions: !unsafe synthetic-private-marker'),
    ],
    [
      'unbound secret references',
      (text: string) => text.replace('provider:openai', 'provider:anthropic'),
    ],
    [
      'conflicting permission scopes',
      (text: string) =>
        text.replace(
          'permissions: []',
          'permissions:\n  - origin: https://example.com\n    method: GET\n    decision: allow\n  - origin: https://example.com\n    method: GET\n    decision: deny',
        ),
    ],
    [
      'unknown fields',
      (text: string) => `${text}\nendpoint: https://untrusted.example/synthetic-private-marker\n`,
    ],
    [
      'unknown models',
      (text: string) => text.replace('modelId: test-model', 'modelId: missing'),
    ],
  ])('rejects %s without exposing source in diagnostics', async (_name, change) => {
    const response = await clef.server.inject({
      method: 'POST',
      url: '/api/settings/validate',
      headers: clef.headers,
      payload: {
        source: change(source),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('synthetic-private-marker');
    expect(await readFile(path, 'utf8')).toBe(source);
  });

  it('keeps the complete active snapshot when a replacement has an invalid permission section', async () => {
    const invalid = source
      .replace('modelId: test-model', 'modelId: second-model')
      .replace(
        'permissions: []',
        'permissions:\n  - origin: https://example.com\n    method: POST\n    decision: allow',
      );
    const update = await clef.server.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: clef.headers,
      payload: {
        source: invalid,
        revision: original.revision,
      },
    });
    expect(update.statusCode).toBe(400);
    expect(await readFile(path, 'utf8')).toBe(source);

    await writeFile(path, invalid);
    const retained = settingsViewSchema.parse(
      (
        await clef.server.inject({
          url: '/api/settings',
          headers: clef.headers,
        })
      ).json(),
    );
    expect(retained.active).toEqual(original.active);
    expect(retained.revision).toBe(original.revision);
    expect(retained.error).toBeTruthy();
    const catalog = (
      await clef.server.inject({
        url: '/api/models',
        headers: clef.headers,
      })
    ).json();
    expect(catalog.defaults.modelId).toBe('test-model');
    expect(catalog.configurationError).toBe(retained.error);
    const blocked = await clef.server.inject({
      method: 'PUT',
      url: '/api/models/default',
      headers: clef.headers,
      payload: {
        ...catalog.defaults,
        revision: original.revision,
      },
    });
    expect(blocked.statusCode).toBe(409);
    const replacement = await clef.server.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: clef.headers,
      payload: {
        source,
        revision: original.revision,
      },
    });
    expect(replacement.statusCode).toBe(409);

    await writeFile(path, source);
    expect(
      (
        await clef.server.inject({
          url: '/api/settings',
          headers: clef.headers,
        })
      ).json(),
    ).toEqual(original);
  });

  it('rejects an unsafe Ollama endpoint without activating the replacement', async () => {
    const document = structuredClone(original.active);
    document.models.connections.push({
      provider: 'ollama',
      url: 'file:///private-model-data',
    });
    const response = await clef.server.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: clef.headers,
      payload: {
        source: JSON.stringify(document),
        revision: original.revision,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('private-model-data');
    expect(
      (
        await clef.server.inject({
          url: '/api/settings',
          headers: clef.headers,
        })
      ).json(),
    ).toEqual(original);
  });

  it('bounds HTTP bodies and configuration files', async () => {
    const large = `${source}#${'x'.repeat(65536)}`;
    const response = await clef.server.inject({
      method: 'POST',
      url: '/api/settings/validate',
      headers: clef.headers,
      payload: {
        source: large,
      },
    });
    expect(response.statusCode).toBe(413);
    await writeFile(path, large);
    const view = settingsViewSchema.parse(
      (
        await clef.server.inject({
          url: '/api/settings',
          headers: clef.headers,
        })
      ).json(),
    );
    expect(view.active).toEqual(original.active);
    expect(view.error).toContain('64 KiB');
  });

  it('refuses symlink reads and replacements without modifying the target', async () => {
    const target = join(clef.home, 'external.yaml');
    const external = source.replace('modelId: test-model', 'modelId: second-model');
    await writeFile(target, external);
    await rm(path);
    await symlink(target, path);
    const view = settingsViewSchema.parse(
      (
        await clef.server.inject({
          url: '/api/settings',
          headers: clef.headers,
        })
      ).json(),
    );
    expect(view.active).toEqual(original.active);
    expect(view.error).toContain('Cannot read settings.yaml');
    const response = await clef.server.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: clef.headers,
      payload: {
        source,
        revision: original.revision,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(await readFile(target, 'utf8')).toBe(external);
  });
});

it('refuses a named pipe without blocking server startup', async () => {
  const home = await mkdtemp(join(tmpdir(), 'clef-pipe-settings-'));
  try {
    await promisify(execFile)('mkfifo', [
      join(home, 'settings.yaml'),
    ]);
    await expect(
      promisify(execFile)(
        process.execPath,
        [
          '--import',
          'tsx',
          'src/server/main.ts',
          'serve',
        ],
        {
          env: {
            ...process.env,
            CLEF_HOME: home,
            CLEF_PORT: String(await availablePort()),
          },
          timeout: 3000,
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('must be a regular file'),
    });
  } finally {
    await rm(home, {
      recursive: true,
      force: true,
    });
  }
});

it('refuses startup with an invalid initial permission policy', async () => {
  const home = await mkdtemp(join(tmpdir(), 'clef-invalid-settings-'));
  try {
    await writeFile(
      join(home, 'settings.yaml'),
      'version: 1\nmodels:\n  defaults: null\n  connections: []\npermissions:\n  - decision: allow\n',
    );
    await expect(
      promisify(execFile)(
        process.execPath,
        [
          '--import',
          'tsx',
          'src/server/main.ts',
          'serve',
        ],
        {
          env: {
            ...process.env,
            CLEF_HOME: home,
            CLEF_PORT: String(await availablePort()),
          },
          timeout: 10000,
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('No valid configuration is active.'),
    });
  } finally {
    await rm(home, {
      recursive: true,
      force: true,
    });
  }
});
