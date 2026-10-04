import type { CredentialStore, Model, Models as PiModels } from '@earendil-works/pi-ai';
import { type ModelCatalog, type ModelSettings, thinkingSchema } from './contract.js';
import { ProviderLogin } from './login.js';
import type { ModelRepository } from './repository.js';

export function thinkingLevels(model: Model<string>): ModelSettings['thinkingLevel'][] {
  if (!model.reasoning)
    return [
      'off',
    ];

  return thinkingSchema.options.filter((level) => model.thinkingLevelMap?.[level] !== null);
}

export class Models {
  readonly login: ProviderLogin;

  constructor(
    readonly runtime: PiModels,
    private readonly repository: ModelRepository,
    private readonly credentials: CredentialStore,
  ) {
    this.login = new ProviderLogin(
      runtime,
      () => repository.deviceId(),
      (provider) => this.connected(provider),
    );
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
        connected: connected.has(provider.id),
      })),
      models: available.map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name,
        thinkingLevels: thinkingLevels(model),
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
    if (!model || !thinkingLevels(model).includes(settings.thinkingLevel))
      throw new Error('Choose an available model and thinking level.');

    await this.repository.saveDefaults(settings);
  }

  async connected(provider: string): Promise<void> {
    if (await this.repository.defaults()) return;

    const available = await this.runtime.getAvailable(provider);
    const model = available.find((item) => item.id === 'gpt-6-luna') ?? available[0];
    if (!model) throw new Error('The provider has no available chat models.');

    const levels = thinkingLevels(model);

    await this.saveDefaults({
      provider,
      modelId: model.id,
      thinkingLevel: levels.includes('medium') ? 'medium' : (levels[0] ?? 'off'),
    });
  }

  async connectKey(provider: string, key: string): Promise<void> {
    if (!this.runtime.getProvider(provider)?.auth.apiKey)
      throw new Error('Unknown API-key provider.');

    await this.credentials.modify(provider, async () => ({
      type: 'api_key',
      key,
    }));
    await this.connected(provider);
  }

  deviceId(): Promise<string> {
    return this.repository.deviceId();
  }
}
