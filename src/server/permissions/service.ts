import { randomUUID } from 'node:crypto';
import type { PermissionChoice, PermissionRequest, PermissionRule } from './contract.js';
import type { PermissionRepository } from './repository.js';

type Waiting = {
  request: PermissionRequest;
  settle: (allow: boolean) => void;
  cancel: () => void;
};

export class Permissions {
  private readonly waiting = new Map<string, Waiting>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly repository: PermissionRepository,
    private readonly lifetimeMs = 120_000,
  ) {}

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
      (item) => item.origin === target.origin && item.method === 'GET',
    );
    signal.throwIfAborted();
    if (rule?.decision === 'allow') return;
    if (rule?.decision === 'deny') throw new Error('Access denied by a saved permission rule.');
    await new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      const clean = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        this.waiting.delete(id);
        this.changed();
      };
      const cancel = () => {
        clean();
        reject(new Error('Permission request was cancelled or expired.'));
      };
      const timer = setTimeout(cancel, this.lifetimeMs);
      timer.unref();
      this.waiting.set(id, {
        request: {
          id,
          conversationId,
          url: target.href,
          origin: target.origin,
          method: 'GET',
          expiresAt: Date.now() + this.lifetimeMs,
        },
        cancel,
        settle: (allow) => {
          clean();
          if (allow) resolve();
          else reject(new Error('The user denied this request.'));
        },
      });
      signal.addEventListener('abort', cancel, {
        once: true,
      });
      this.changed();
    });
    signal.throwIfAborted();
  }

  async decide(id: string, choice: PermissionChoice): Promise<void> {
    const item = this.waiting.get(id);
    if (!item || item.request.expiresAt <= Date.now())
      throw new Error('This permission request is no longer active.');
    this.waiting.delete(id);
    try {
      if (choice === 'always' || choice === 'never')
        await this.repository.save({
          origin: item.request.origin,
          method: 'GET',
          decision: choice === 'always' ? 'allow' : 'deny',
        });
      item.settle(choice === 'once' || choice === 'always');
    } catch (error) {
      item.cancel();
      throw error;
    }
  }

  rules(): Promise<PermissionRule[]> {
    return this.repository.rules();
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
