import { randomUUID } from 'node:crypto';
import type { AuthEvent, AuthPrompt, Models } from '@earendil-works/pi-ai';
import type { LoginState } from './contract.js';

type Flow = {
  view: LoginState;
  abort: AbortController;
  task: Promise<void>;
  answer?: (value: string) => void;
};

export class ProviderLogin {
  private flow: Flow | undefined;
  constructor(
    private readonly runtime: Models,
    private readonly deviceId: () => Promise<string>,
    private readonly connected: (provider: string) => Promise<void>,
  ) {}

  async start(provider: string): Promise<LoginState> {
    if (
      this.flow &&
      [
        'working',
        'waiting',
      ].includes(this.flow.view.state)
    )
      throw new Error('A provider sign-in is already active.');
    if (!this.runtime.getProvider(provider)?.auth.oauth)
      throw new Error('This provider does not support sign-in.');
    const deviceId = await this.deviceId();
    const flow: Flow = {
      view: {
        id: randomUUID(),
        state: 'working',
        message: 'Starting sign-in…',
        choices: [],
      },
      abort: new AbortController(),
      task: Promise.resolve(),
    };
    this.flow = flow;
    const signal = AbortSignal.any([
      flow.abort.signal,
      AbortSignal.timeout(300_000),
    ]);
    flow.task = this.runtime
      .login(
        provider,
        'oauth',
        {
          signal,
          notify: (event) => this.notify(flow, event),
          prompt: (prompt) => this.prompt(flow, prompt, signal),
        },
        {
          getDeviceId: () => deviceId,
        },
      )
      .then(async () => {
        await this.connected(provider);
        flow.view = {
          id: flow.view.id,
          state: 'done',
          message: 'Connected.',
          choices: [],
        };
      })
      .catch(() => {
        flow.view = {
          id: flow.view.id,
          state: 'failed',
          message:
            'Sign-in failed or expired. Try again. Close any other provider sign-in window first.',
          choices: [],
        };
      });
    return flow.view;
  }

  state(id: string): LoginState {
    if (this.flow?.view.id !== id) throw new Error('This sign-in is no longer active.');
    return this.flow.view;
  }
  answer(id: string, value: string): void {
    if (this.flow?.view.id !== id || !this.flow.answer)
      throw new Error('This sign-in has no pending input.');
    this.flow.answer(value);
  }
  async close(): Promise<void> {
    this.flow?.abort.abort();
    await this.flow?.task;
  }

  private notify(flow: Flow, event: AuthEvent): void {
    if (event.type === 'auth_url')
      flow.view = {
        ...flow.view,
        url: event.url,
        message: event.instructions ?? 'Continue in the provider window.',
      };
    else if (event.type === 'device_code')
      flow.view = {
        ...flow.view,
        url: event.verificationUri,
        message: `Enter code ${event.userCode} in the provider window.`,
      };
    else
      flow.view = {
        ...flow.view,
        message: event.message,
      };
  }

  private prompt(flow: Flow, prompt: AuthPrompt, loginSignal: AbortSignal): Promise<string> {
    const signal = prompt.signal
      ? AbortSignal.any([
          loginSignal,
          prompt.signal,
        ])
      : loginSignal;
    signal.throwIfAborted();
    flow.view = {
      ...flow.view,
      state: 'waiting',
      prompt: prompt.message,
      choices:
        prompt.type === 'select'
          ? [
              ...prompt.options,
            ]
          : [],
    };
    return new Promise((resolve, reject) => {
      const clean = () => {
        signal.removeEventListener('abort', abort);
        delete flow.answer;
        const { prompt: _prompt, ...view } = flow.view;
        flow.view = {
          ...view,
          state: 'working',
          choices: [],
        };
      };
      const abort = () => {
        clean();
        reject(new Error('Sign-in cancelled'));
      };
      flow.answer = (value) => {
        clean();
        resolve(value);
      };
      signal.addEventListener('abort', abort, {
        once: true,
      });
    });
  }
}
