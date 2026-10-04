import {
  type CredentialStore,
  getSupportedThinkingLevels,
  type MutableModels,
} from '@earendil-works/pi-ai';
import { HttpError } from '../platform/http.js';
import type { Settings } from '../settings/index.js';
import type { ModelCatalog, ModelConfiguration, ModelSettings } from './contract.js';
import { ProviderLogin } from './login.js';
import { discoverOllama, ollamaProvider, ollamaUrl } from './ollama.js';
import type { ModelRepository } from './repository.js';

export class Models {
  readonly login: ProviderLogin;
  private ollamaServerUrl: string | undefined;
  private ollamaError: string | undefined;
  private ollamaReady: Promise<void> = Promise.resolve();

  constructor(
    readonly runtime: MutableModels,
    private readonly repository: ModelRepository,
    private readonly credentials: CredentialStore,
    private readonly settings: Settings,
  ) {
    this.login = new ProviderLogin(
      runtime,
      () => repository.deviceId(),
      (provider) => this.connected(provider),
    );
  }

  private refreshOllama(configuration: ModelConfiguration): Promise<void> {
    const url = configuration.connections.find((item) => 'url' in item)?.url;
    if (url === this.ollamaServerUrl) return this.ollamaReady;

    this.ollamaServerUrl = url;
    this.ollamaError = undefined;
    this.runtime.setProvider(ollamaProvider());
    const pending = url
      ? discoverOllama(url).then(
          (models) => {
            if (this.ollamaReady === pending) this.runtime.setProvider(ollamaProvider(models));
          },
          (error: unknown) => {
            if (!(error instanceof HttpError)) throw error;
            if (this.ollamaReady === pending) this.ollamaError = error.message;
          },
        )
      : Promise.resolve();
    this.ollamaReady = pending;
    return pending;
  }

  async catalog(): Promise<ModelCatalog> {
    const view = await this.settings.view();
    await this.refreshOllama(view.active.models);
    const available = await this.runtime.getAvailable();
    const connected = new Set(available.map((model) => model.provider));

    return {
      revision: view.revision,
      configurationError: view.error,
      defaults: view.active.models.defaults,
      providers: this.runtime.getProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        oauth: provider.auth.oauth !== undefined,
        connected: provider.id === 'ollama' ? this.ollamaServerUrl !== undefined : connected.has(provider.id),
        url: provider.id === 'ollama' ? this.ollamaServerUrl : undefined,
        error: provider.id === 'ollama' ? this.ollamaError : undefined,
      })),
      models: available.map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name,
        thinkingLevels: getSupportedThinkingLevels(model),
      })),
    };
  }

  async defaults(): Promise<ModelSettings> {
    const view = await this.settings.view();
    await this.refreshOllama(view.active.models);
    if (!view.active.models.defaults) throw new Error('Connect a model provider first.');

    return view.active.models.defaults;
  }

  async validateConfiguration(configuration: ModelConfiguration): Promise<void> {
    const seen = new Set<string>();
    for (const connection of configuration.connections) {
      if (!this.runtime.getProvider(connection.provider) || seen.has(connection.provider))
        throw new HttpError(400, 'Use each known provider at most once.');
      if ('url' in connection) {
        if (ollamaUrl(connection.url) !== connection.url)
          throw new HttpError(400, 'Use the canonical Ollama server URL.');
      } else if (connection.provider === 'ollama' || connection.secretRef !== `provider:${connection.provider}`) {
        throw new HttpError(400, 'Use the bound provider:<id> secret reference for cloud providers and a server URL for Ollama.');
      }
      seen.add(connection.provider);
    }
    const selection = configuration.defaults;
    if (!selection) return;
    if (!seen.has(selection.provider)) throw new HttpError(400, 'The default model needs a provider connection.');
    if (selection.provider === 'ollama') return;

    const model = this.runtime.getModels(selection.provider).find((item) => item.id === selection.modelId);
    if (!model || !getSupportedThinkingLevels(model).includes(selection.thinkingLevel))
      throw new HttpError(400, 'Choose a known model and supported thinking level.');
  }

  async validateSelection(selection: ModelSettings): Promise<void> {
    const view = await this.settings.view();
    await this.refreshOllama(view.active.models);
    const model = (await this.runtime.getAvailable(selection.provider)).find((item) => item.id === selection.modelId);
    if (!model || !getSupportedThinkingLevels(model).includes(selection.thinkingLevel))
      throw new HttpError(400, 'Choose an available model and thinking level.');
  }

  async saveDefaults(selection: ModelSettings, revision?: string, signal?: AbortSignal): Promise<void> {
    await this.validateSelection(selection);
    const view = await this.settings.view();
    await this.settings.update(revision ?? view.revision, (document) => {
      document.models.defaults = selection;
      if (!document.models.connections.some((item) => item.provider === selection.provider))
        document.models.connections.push({ provider: selection.provider, secretRef: `provider:${selection.provider}` });
    }, signal);
  }

  async connected(provider: string): Promise<void> {
    const view = await this.settings.view();
    if (view.active.models.defaults) {
      if (!view.active.models.connections.some((item) => item.provider === provider))
        await this.settings.update(view.revision, (document) => {
          document.models.connections.push({ provider, secretRef: `provider:${provider}` });
        });
      return;
    }

    const available = await this.runtime.getAvailable(provider);
    const model = available.find((item) => item.id === 'gpt-6-luna') ?? available[0];
    if (!model) throw new Error('The provider has no available chat models.');
    const levels = getSupportedThinkingLevels(model);
    await this.saveDefaults({
      provider, modelId: model.id,
      thinkingLevel: levels.includes('medium') ? 'medium' : (levels[0] ?? 'off'),
    });
  }

  async connectKey(provider: string, key: string): Promise<void> {
    if (provider === 'ollama') throw new HttpError(400, 'Ollama uses a server URL, not an API key.');
    if (!this.runtime.getProvider(provider)?.auth.apiKey) throw new Error('Unknown API-key provider.');
    await this.credentials.modify(provider, async () => ({ type: 'api_key', key }));
    await this.connected(provider);
  }

  async connectOllama(input: string): Promise<void> {
    const url = ollamaUrl(input);
    const models = await discoverOllama(url);
    const view = await this.settings.view();
    await this.settings.update(view.revision, (document) => {
      document.models.connections = document.models.connections.filter((item) => item.provider !== 'ollama');
      document.models.connections.push({ provider: 'ollama', url });
    });
    this.ollamaReady = Promise.resolve();
    this.runtime.setProvider(ollamaProvider(models));
    this.ollamaServerUrl = url;
    this.ollamaError = undefined;
    await this.connected('ollama');
  }

  deviceId(): Promise<string> {
    return this.repository.deviceId();
  }
}
