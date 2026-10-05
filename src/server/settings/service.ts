import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import type { ModelConfiguration } from '../models/contract.js';
import { HttpError } from '../platform/http.js';
import { type SettingsDocument, type SettingsView, settingsSchema } from './contract.js';

const maximumBytes = 64 * 1024;

function revision(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

export class Settings {
  private active: SettingsDocument | undefined;
  private activeRevision = '';
  private failure: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private validateModels: ((models: ModelConfiguration) => Promise<void>) | undefined;
  readonly path: string;

  constructor(home: string) {
    this.path = join(home, 'settings.yaml');
  }

  async initialize(validateModels: (models: ModelConfiguration) => Promise<void>): Promise<void> {
    this.validateModels = validateModels;
    try {
      writeFileSync(
        this.path,
        stringify({
          version: 1,
          models: {
            defaults: null,
            connections: [],
          },
          permissions: [],
          files: this.initialFileAccess(),
        }),
        {
          flag: 'wx',
          mode: 0o600,
        },
      );
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    await this.initializeFileAccess();
    await this.view();
  }

  private initialFileAccess() {
    return {
      global: false,
      directories: [
        {
          path: realpathSync.native(join(dirname(this.path), 'workspace')),
          access: 'read-write',
        },
      ],
    };
  }

  private async initializeFileAccess(): Promise<void> {
    const source = this.read();
    const parsed = parseDocument(source, {
      prettyErrors: false,
      uniqueKeys: true,
    });
    if (parsed.errors.length || parsed.warnings.length) return;
    let value: unknown;
    try {
      value = parsed.toJS({
        maxAliasCount: 0,
      });
    } catch {
      return;
    }
    const previous = settingsSchema
      .omit({
        files: true,
      })
      .safeParse(value);
    if (!previous.success) return;
    const next = stringify({
      ...previous.data,
      files: this.initialFileAccess(),
    });
    await this.validate(next);
    this.replace(next, revision(source));
  }

  private read(): string {
    const fd = openSync(
      this.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > maximumBytes)
        throw new HttpError(400, 'settings.yaml must be a regular file of at most 64 KiB.');
      const buffer = Buffer.alloc(maximumBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = readSync(fd, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      if (length > maximumBytes) throw new HttpError(400, 'settings.yaml exceeds 64 KiB.');
      return buffer.toString('utf8', 0, length);
    } finally {
      closeSync(fd);
    }
  }

  async validate(source: string): Promise<SettingsDocument> {
    if (Buffer.byteLength(source) > maximumBytes)
      throw new HttpError(400, 'settings.yaml exceeds 64 KiB.');
    const parsed = parseDocument(source, {
      prettyErrors: false,
      uniqueKeys: true,
    });
    if (parsed.errors.length || parsed.warnings.length)
      throw new HttpError(
        400,
        'Invalid settings.yaml syntax. Check indentation, duplicate keys and YAML tags.',
      );
    let value: unknown;
    try {
      value = parsed.toJS({
        maxAliasCount: 0,
      });
    } catch {
      throw new HttpError(400, 'settings.yaml aliases are not supported.');
    }
    const checked = settingsSchema.safeParse(value);
    if (!checked.success)
      throw new HttpError(
        400,
        'Invalid settings.yaml schema. Check version, models and permissions; unknown fields are not allowed.',
      );
    if (!this.validateModels) throw new Error('Settings validation is not initialized.');
    await this.validateModels(checked.data.models);
    return checked.data;
  }

  private async reload(): Promise<void> {
    try {
      const source = this.read();
      const nextRevision = revision(source);
      if (nextRevision === this.activeRevision) {
        this.failure = null;
        return;
      }
      const next = await this.validate(source);
      if (this.read() !== source)
        throw new HttpError(409, 'settings.yaml changed during validation. Retry.');
      this.active = next;
      this.activeRevision = nextRevision;
      this.failure = null;
    } catch (error) {
      this.failure =
        error instanceof HttpError
          ? error.message
          : 'Cannot read settings.yaml. Check the file and its permissions.';
      if (!this.active)
        throw new HttpError(503, `${this.failure} No valid configuration is active.`);
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  view(): Promise<SettingsView> {
    return this.serialized(async () => {
      await this.reload();
      return this.snapshot();
    });
  }

  private snapshot(): SettingsView {
    if (!this.active) throw new HttpError(503, 'No valid configuration is active.');
    return {
      revision: this.activeRevision,
      active: structuredClone(this.active),
      error: this.failure,
    };
  }

  update(
    expectedRevision: string,
    change: (document: SettingsDocument) => void,
    signal?: AbortSignal,
  ): Promise<SettingsView> {
    return this.serialized(async () => {
      signal?.throwIfAborted();
      await this.reload();
      if (this.failure)
        throw new HttpError(409, `${this.failure} Repair settings.yaml before saving.`);
      if (expectedRevision !== this.activeRevision)
        throw new HttpError(409, 'Settings changed. Inspect the current revision and try again.');
      const next = this.snapshot().active;
      change(next);
      const source = stringify(next);
      if (Buffer.byteLength(source) > maximumBytes)
        throw new HttpError(400, 'settings.yaml exceeds 64 KiB.');
      const prepared = await this.validate(source);
      signal?.throwIfAborted();
      this.replace(source, expectedRevision);
      this.active = prepared;
      this.activeRevision = revision(source);
      return this.snapshot();
    });
  }

  private replace(source: string, expectedRevision: string): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, source);
      fsyncSync(fd);
      if (revision(this.read()) !== expectedRevision)
        throw new HttpError(409, 'settings.yaml changed before saving. Retry.');
      renameSync(temporary, this.path);
      const directory = openSync(dirname(this.path), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } finally {
      closeSync(fd);
      rmSync(temporary, {
        force: true,
      });
    }
  }
}
