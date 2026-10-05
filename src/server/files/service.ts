import { createHash } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Permissions } from '../permissions/index.js';
import { HttpError } from '../platform/http.js';
import { type FileCommand, fileAccessUpdateSchema, fileCommandSchema } from './contract.js';
import { FilePaths, validateFileTarget } from './paths.js';
import { checkWorkspaceQuota } from './quota.js';
import { listDirectory, readText, syncParent, writeText } from './storage.js';

export type FileInvocation = {
  conversationId: string;
  callId: string;
  signal: AbortSignal;
};

export class Files {
  private readonly paths: FilePaths;
  private active = 0;

  constructor(
    home: string,
    workspace: string,
    private readonly permissions: Permissions,
  ) {
    this.paths = new FilePaths(home, workspace);
  }

  async access() {
    return {
      workspace: this.paths.workspace,
      ...(await this.permissions.fileAccess()),
    };
  }

  async saveAccess(input: unknown) {
    const change = fileAccessUpdateSchema.parse(input);
    const current = await this.permissions.fileAccess();
    const directories = change.policy.directories.map((rule) => {
      const unchanged = current.policy.directories.find(
        (item) => item.path === rule.path && item.access === rule.access,
      );
      return (
        unchanged ?? {
          ...rule,
          path: this.paths.directory(rule.path),
        }
      );
    });
    await this.permissions.saveFileAccess(
      {
        ...change.policy,
        directories,
      },
      change.revision,
      change.confirmGlobal,
    );
    return this.access();
  }

  async execute(input: FileCommand, invocation: FileInvocation) {
    if (this.active >= 8) throw new HttpError(429, 'Too many active file actions.');
    this.active++;
    try {
      return await this.perform(input, invocation);
    } finally {
      this.active--;
    }
  }

  private async perform(input: FileCommand, invocation: FileInvocation) {
    const command = fileCommandSchema.parse(input);
    invocation.signal.throwIfAborted();
    const target = this.paths.inspect(command.path);
    validateFileTarget(command.operation, target.stat);
    const revision = await this.permissions.authorizeFile(
      invocation.conversationId,
      invocation.callId,
      {
        path: target.path,
        directory: command.operation === 'list' ? target.path : dirname(target.path),
        operation: command.operation,
        version: target.version,
        ...(command.operation === 'write'
          ? {
              bytes: Buffer.byteLength(command.content),
              contentHash: createHash('sha256').update(command.content).digest('hex'),
            }
          : {}),
      },
      target.ancestors,
      invocation.signal,
    );
    await this.permissions.assertFileRevision(revision);
    invocation.signal.throwIfAborted();
    const current = this.paths.inspect(command.path);
    if (
      current.path !== target.path ||
      current.version !== target.version ||
      current.parentIdentity !== target.parentIdentity
    )
      throw new HttpError(409, 'The target changed. Retry the action.');
    switch (command.operation) {
      case 'list':
        return listDirectory(current.path);
      case 'read':
        return readText(current.path, current.version, command.offset);
      case 'write':
        if (current.inWorkspace)
          checkWorkspaceQuota(
            this.paths.workspace,
            Buffer.byteLength(command.content) - (current.stat?.size ?? 0),
            !current.stat,
          );
        return writeText(current.path, command.content);
      case 'mkdir':
        if (current.inWorkspace) checkWorkspaceQuota(this.paths.workspace, 0, true);
        mkdirSync(current.path, {
          mode: 0o700,
        });
        syncParent(current.path);
        return {
          path: current.path,
          created: true,
        };
      case 'delete':
        unlinkSync(current.path);
        syncParent(current.path);
        return {
          path: current.path,
          deleted: true,
        };
    }
  }
}
