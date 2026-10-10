import { randomUUID } from 'node:crypto';
import { HttpError } from '../platform/http.js';
import {
  type ConfigurationChange,
  type ConfigurationScope,
  type FileAccess,
  type FileAction,
  type FileOperation,
  fileAccessSchema,
  fileActionSchema,
  type PermissionChoice,
  type PermissionRequest,
  type PermissionRule,
  permissionScopeKey,
  requiresGlobalConfirmation,
} from './contract.js';
import { fileDecision, resolveDirectoryRules } from './files.js';
import type { PermissionRepository } from './repository.js';

type Waiting = {
  request: PermissionRequest;
  signal: AbortSignal;
  deciding: boolean;
  settle: (revision: string) => void;
  cancel: (message?: string) => void;
};

export class Permissions {
  private readonly waiting = new Map<string, Waiting>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly repository: PermissionRepository,
    private readonly lifetimeMs = 120_000,
  ) {}

  async fileAccess() {
    return this.repository.fileAccess();
  }

  private async checkFile(path: string, operation: FileOperation, ancestors: readonly string[]) {
    const view = await this.repository.fileAccess();
    if (view.error) throw new HttpError(409, 'Repair settings.yaml before accessing files.');
    return {
      ...view,
      decision: fileDecision(view.policy, path, operation, ancestors),
    };
  }

  async saveFileAccess(
    policy: FileAccess,
    revision: string,
    confirmGlobal: boolean,
  ): Promise<void> {
    const checked = fileAccessSchema.parse(policy);
    resolveDirectoryRules(checked.directories);
    const view = await this.repository.fileAccess();
    if (requiresGlobalConfirmation(view.policy, checked, confirmGlobal))
      throw new HttpError(400, 'Confirm global host file access explicitly.');
    await this.repository.saveFileAccess(checked, revision);
    this.changed();
  }

  async authorizeFile(
    conversationId: string,
    callId: string,
    action: FileAction,
    ancestors: readonly string[],
    signal: AbortSignal,
  ): Promise<string> {
    const checked = fileActionSchema.parse(action);
    signal.throwIfAborted();
    const view = await this.checkFile(checked.path, checked.operation, ancestors);
    signal.throwIfAborted();
    if (view.decision === 'deny') throw new HttpError(403, 'Access denied by a directory rule.');
    if (view.decision === 'allow' && checked.operation !== 'delete') return view.revision;
    return this.wait(
      {
        ...checked,
        kind: 'file',
        id: randomUUID(),
        conversationId,
        callId,
        revision: view.revision,
        expiresAt: Date.now() + this.lifetimeMs,
      },
      signal,
    );
  }

  async assertFileRevision(revision: string): Promise<void> {
    const view = await this.repository.fileAccess();
    if (view.error || view.revision !== revision)
      throw new HttpError(409, 'File permissions or settings changed. Request the action again.');
  }

  pending(conversationId: string): PermissionRequest[] {
    return [
      ...this.waiting.values(),
    ]
      .map((item) => item.request)
      .filter((item) => item.conversationId === conversationId);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  async authorizeConfiguration(
    conversationId: string,
    callId: string,
    change: ConfigurationChange,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const view = await this.repository.view();
    if (view.error || view.revision !== change.revision)
      throw new HttpError(409, 'Settings changed or are invalid. Inspect settings again.');
    const scope: ConfigurationScope = {
      kind: 'configuration',
      conversationId,
      defaults: change.defaults,
      switchConversation: change.switchConversation,
    };
    const rule = view.rules.find((item) => permissionScopeKey(item) === permissionScopeKey(scope));
    signal.throwIfAborted();
    if (rule?.decision === 'deny')
      throw new HttpError(403, 'Access denied by a saved permission rule.');
    if (rule?.decision === 'allow') return view.revision;
    if (
      this.pending(conversationId).some((item) => 'kind' in item && item.kind === 'configuration')
    )
      throw new HttpError(409, 'A configuration approval is already pending.');
    return this.wait(
      {
        ...scope,
        id: randomUUID(),
        callId,
        revision: change.revision,
        expiresAt: Date.now() + this.lifetimeMs,
      },
      signal,
    );
  }

  async authorize(conversationId: string, url: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new Error('Use a valid HTTPS URL.');
    }
    if (target.protocol !== 'https:' || target.username || target.password)
      throw new Error('Only public HTTPS URLs without credentials are allowed.');
    target.hash = '';
    const rule = (await this.rules()).find(
      (item) => !('kind' in item) && item.origin === target.origin && item.method === 'GET',
    );
    signal.throwIfAborted();
    if (rule?.decision === 'allow') return;
    if (rule?.decision === 'deny') throw new Error('Access denied by a saved permission rule.');
    await this.wait(
      {
        id: randomUUID(),
        conversationId,
        url: target.href,
        origin: target.origin,
        method: 'GET',
        expiresAt: Date.now() + this.lifetimeMs,
      },
      signal,
    );
  }

  private wait(request: PermissionRequest, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (this.waiting.size >= 100) throw new HttpError(429, 'Too many pending approvals.');
    return new Promise<string>((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.waiting.delete(request.id);
        this.changed();
      };
      const cancel = (message = 'Permission request was cancelled or expired.') => {
        clean();
        reject(new HttpError(403, message));
      };
      const abort = () => cancel();
      const timer = setTimeout(abort, this.lifetimeMs);
      timer.unref();
      this.waiting.set(request.id, {
        request,
        signal,
        deciding: false,
        cancel,
        settle: (revision) => {
          clean();
          resolve(revision);
        },
      });
      signal.addEventListener('abort', abort, {
        once: true,
      });
      this.changed();
    });
  }

  async decide(id: string, choice: PermissionChoice, conversationId: string): Promise<void> {
    const item = this.waiting.get(id);
    if (
      !item ||
      item.deciding ||
      item.request.conversationId !== conversationId ||
      item.request.expiresAt <= Date.now()
    )
      throw new HttpError(409, 'This permission request is no longer active in this conversation.');
    if (
      'kind' in item.request &&
      item.request.kind === 'file' &&
      item.request.operation === 'delete' &&
      (choice === 'always' || choice === 'never')
    )
      throw new HttpError(
        400,
        'Deletion requires approval for each action. Choose Deny or This time.',
      );
    item.deciding = true;
    try {
      let revision = 'revision' in item.request ? item.request.revision : '';
      if (choice === 'always' || choice === 'never') {
        revision = await this.saveDecision(item, choice);
      }
      item.signal.throwIfAborted();
      if (this.waiting.get(id) !== item)
        throw new HttpError(409, 'This permission request has expired.');
      if (choice === 'once' || choice === 'always') item.settle(revision);
      else item.cancel('The user denied this request.');
    } catch (error) {
      item.cancel();
      throw error;
    }
  }

  private async saveDecision(item: Waiting, choice: 'always' | 'never'): Promise<string> {
    const request = item.request;
    if ('kind' in request && request.kind === 'file') {
      const access =
        choice === 'never'
          ? 'deny'
          : request.operation === 'read' || request.operation === 'list'
            ? 'read'
            : 'read-write';
      if (request.directory === '/' && access === 'read-write')
        throw new HttpError(403, 'Only Settings can enable global read/write access.');
      return this.repository.saveFileRule(
        {
          path: request.directory,
          access,
        },
        request.revision,
        item.signal,
      );
    }
    return this.repository.save(
      this.ruleFor(request, choice === 'always' ? 'allow' : 'deny'),
      'revision' in request ? request.revision : undefined,
      item.signal,
    );
  }

  private ruleFor(
    request: Exclude<
      PermissionRequest,
      {
        kind: 'file';
      }
    >,
    decision: 'allow' | 'deny',
  ): PermissionRule {
    if ('kind' in request)
      return {
        kind: 'configuration',
        conversationId: request.conversationId,
        defaults: request.defaults,
        switchConversation: request.switchConversation,
        decision,
      };
    return {
      origin: request.origin,
      method: request.method,
      decision,
    };
  }

  async rules(): Promise<PermissionRule[]> {
    return (await this.repository.view()).rules;
  }

  async revoke(origin: string): Promise<void> {
    await this.repository.remove(origin);
    this.changed();
  }

  close(): void {
    for (const item of [
      ...this.waiting.values(),
    ])
      item.cancel();
  }
}
