import type { Database } from '../platform/database.js';
import type { Settings } from '../settings/index.js';
import {
  type DirectoryRule,
  type FileAccess,
  type PermissionRule,
  permissionScopeKey,
} from './contract.js';

import { resolveDirectoryRule } from './files.js';

export class PermissionRepository {
  constructor(private readonly settings: Settings) {}

  static async removeObsoleteTable(database: Database): Promise<void> {
    await database.exec('DROP TABLE IF EXISTS clef_permissions');
  }

  async fileAccess() {
    const view = await this.settings.view();
    return {
      revision: view.revision,
      policy: view.active.files,
      error: view.error,
    };
  }

  async saveFileRule(rule: DirectoryRule, revision: string, signal: AbortSignal): Promise<string> {
    const saved = await this.settings.update(
      revision,
      (document) => {
        const resolved = resolveDirectoryRule(rule);
        document.files.directories = document.files.directories.filter((item) => {
          const existing = resolveDirectoryRule(item);
          return (existing.identity ?? existing.path) !== (resolved.identity ?? resolved.path);
        });
        document.files.directories.push(rule);
      },
      signal,
    );
    return saved.revision;
  }

  async saveFileAccess(policy: FileAccess, revision: string): Promise<void> {
    await this.settings.update(revision, (document) => {
      document.files = policy;
    });
  }

  async view() {
    const view = await this.settings.view();
    return {
      revision: view.revision,
      rules: view.active.permissions,
      error: view.error,
    };
  }

  async save(rule: PermissionRule, revision?: string, signal?: AbortSignal): Promise<string> {
    const view = await this.settings.view();
    const saved = await this.settings.update(
      revision ?? view.revision,
      (document) => {
        document.permissions = document.permissions.filter(
          (item) => permissionScopeKey(item) !== permissionScopeKey(rule),
        );
        document.permissions.push(rule);
      },
      signal,
    );
    return saved.revision;
  }

  async remove(origin: string): Promise<void> {
    const view = await this.settings.view();
    await this.settings.update(view.revision, (document) => {
      document.permissions = document.permissions.filter(
        (item) => 'kind' in item || item.origin !== origin,
      );
    });
  }
}
