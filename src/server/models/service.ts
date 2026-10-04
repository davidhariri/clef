import {
  type CredentialStore,
  getSupportedThinkingLevels,
  type MutableModels,
} from '@earendil-works/pi-ai';
import { HttpError } from '../platform/http.js';
import type { ModelCatalog, ModelSettings } from './contract.js';
import { ProviderLogin } from './login.js';
import { discoverOllama, ollamaProvider, ollamaUrl } from './ollama.js';
import type { ModelRepository } from './repository.js';

export class Models {
  readonly login: ProviderLogin;
  private ollamaServerUrl: string | undefined;
  private ollamaError: string | undefined;

  constructor(
    readonly runtime: MutableModels,
    private readonly repository: ModelRepository,
    private readonly credentials: CredentialStore,
  ) {
    this.login = new ProviderLogin(
      runtime,
      () => repository.deviceId(),
      (provider) => this.connected(provider),
    );
  }

  async restore(): Promise<void> {
    this.ollamaServerUrl = await this.repository.ollamaUrl();
    if (!this.ollamaServerUrl) return;

    try {
      const models = await discoverOllama(this.ollamaServerUrl);
      this.runtime.setProvider(ollamaProvider(models));
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      this.ollamaError = error.message;
    }
  }

  async catalog(): Promise<ModelCatalog> {
    const available = await this.runtime.getAvailable();
    const connected = new Set(available.map((model) => model.provider));

    return {
      defaults: await this.repository.defaults(),
      providers: this.runtime.getProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        oauth: provider.auth.oauth !== undefined,
        connected:
          provider.id === 'ollama'
            ? this.ollamaServerUrl !== undefined
            : connected.has(provider.id),
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
    const settings = await this.repository.defaults();
    if (!settings) throw new Error('Connect a model provider first.');

    return settings;
  }

  async saveDefaults(settings: ModelSettings): Promise<void> {
    const model = (await this.runtime.getAvailable(settings.provider)).find(
      (item) => item.id === settings.modelId,
    );
    if (!model || !getSupportedThinkingLevels(model).includes(settings.thinkingLevel))
      throw new HttpError(400, 'Choose an available model and thinking level.');

    await this.repository.saveDefaults(settings);
  }

  async connected(provider: string): Promise<void> {
    if (await this.repository.defaults()) return;

    const available = await this.runtime.getAvailable(provider);
    const model = available.find((item) => item.id === 'gpt-6-luna') ?? available[0];
    if (!model) throw new Error('The provider has no available chat models.');

    const levels = getSupportedThinkingLevels(model);

    await this.saveDefaults({
      provider,
      modelId: model.id,
      thinkingLevel: levels.includes('medium') ? 'medium' : (levels[0] ?? 'off'),
    });
  }

  async connectKey(provider: string, key: string): Promise<void> {
    if (provider === 'ollama')
      throw new HttpError(400, 'Ollama uses a server URL, not an API key.');
    if (!this.runtime.getProvider(provider)?.auth.apiKey)
      throw new Error('Unknown API-key provider.');

    await this.credentials.modify(provider, async () => ({
      type: 'api_key',
      key,
    }));
    await this.connected(provider);
  }

  async connectOllama(input: string): Promise<void> {
    const url = ollamaUrl(input);
    const models = await discoverOllama(url);
    await this.repository.saveOllamaUrl(url);
    this.runtime.setProvider(ollamaProvider(models));
    this.ollamaServerUrl = url;
    this.ollamaError = undefined;
    await this.connected('ollama');
  }

  deviceId(): Promise<string> {
    return this.repository.deviceId();
  }
}
