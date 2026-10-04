import { useEffect, useState } from 'react';
import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import {
  catalogSchema,
  type ModelCatalog,
  type ModelSettings,
  thinkingSchema,
} from '../../server/models/contract.js';
import { SelectField } from '../components/select-field.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { useAction } from '../platform/action.js';

export function ModelDefaults({ connections }: { connections: () => void }) {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [selection, setSelection] = useState<ModelSettings>();
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const { setError } = action;

  useEffect(() => {
    let active = true;

    request('/api/models', catalogSchema)
      .then((value) => {
        if (!active) return;

        setCatalog(value);
        if (value.defaults) setSelection(value.defaults);
      })
      .catch(() => {
        if (active) setError('Cannot load model settings.');
      });

    return () => {
      active = false;
    };
  }, [
    setError,
  ]);

  const models = catalog?.models.filter((model) => model.provider === selection?.provider) ?? [];
  const selectedModel = models.find((model) => model.id === selection?.modelId);
  const providerError = catalog?.providers.find(
    (provider) => provider.id === selection?.provider,
  )?.error;

  function changeSelection(value: ModelSettings) {
    setSaved(false);
    setSelection(value);
  }

  function selectModel(model: ModelCatalog['models'][number] | undefined) {
    if (!model) return;

    changeSelection({
      provider: model.provider,
      modelId: model.id,
      thinkingLevel: model.thinkingLevels[0] ?? 'off',
    });
  }

  return (
    <section className="grid gap-4" aria-label="Model defaults">
      <h2 className="text-xl font-semibold">Default model</h2>
      <p className="text-sm text-muted-foreground">
        Choose the model Clef uses for your next message.
      </p>
      <Button type="button" variant="link" className="w-fit p-0" onClick={connections}>
        Manage connections
      </Button>
      {!catalog && !action.error && <p role="status">Loading model settings…</p>}
      {catalog?.configurationError && (
        <p role="alert" className="text-sm text-destructive">
          {catalog.configurationError}
        </p>
      )}
      {catalog?.providers
        .filter((provider) => provider.error)
        .map((provider) => (
          <p key={provider.id} role="alert" className="text-sm text-destructive">
            {provider.error}
          </p>
        ))}
      {catalog && selection && !selectedModel && !providerError && (
        <p role="alert" className="text-sm text-destructive">
          The selected model is unavailable. Connect its server or choose another model.
        </p>
      )}
      {selection && (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(false);
            action.run(async () => {
              await request('/api/models/default', okSchema, {
                body: {
                  ...selection,
                  revision: catalog?.revision,
                },
                method: 'PUT',
              });
              setCatalog(await request('/api/models', catalogSchema));
              setSaved(true);
            });
          }}
        >
          <SelectField
            label="Provider"
            value={selection.provider}
            options={
              catalog?.providers
                .filter((provider) => provider.connected)
                .map((provider) => ({
                  value: provider.id,
                  label: provider.name,
                })) ?? []
            }
            onChange={(provider) =>
              selectModel(catalog?.models.find((model) => model.provider === provider))
            }
          />
          <SelectField
            label="Model"
            value={selection.modelId}
            options={models.map((model) => ({
              value: model.id,
              label: model.name,
            }))}
            onChange={(id) => selectModel(models.find((model) => model.id === id))}
          />
          <SelectField
            label="Thinking"
            value={selection.thinkingLevel}
            options={
              selectedModel?.thinkingLevels.map((level) => ({
                value: level,
                label: level,
              })) ?? []
            }
            onChange={(value) =>
              changeSelection({
                ...selection,
                thinkingLevel: thinkingSchema.parse(value),
              })
            }
          />
          <p className="text-sm text-muted-foreground">
            {selection.provider === 'ollama'
              ? 'Your configured Ollama server receives the conversation sent to this model.'
              : 'The selected provider receives the conversation sent to this model.'}{' '}
            An active reply keeps its current model.
          </p>
          <div className="border-t pt-5">
            <Button type="submit" disabled={action.busy || !selectedModel}>
              Save defaults
            </Button>
          </div>
        </form>
      )}
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          Defaults saved. Applies to your next message.
        </p>
      )}
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </section>
  );
}
