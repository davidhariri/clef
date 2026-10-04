import { ArrowLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { request } from '../../client/api.js';
import { catalogSchema, type ModelCatalog } from '../../server/models/contract.js';
import { Page } from '../components/page.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { Separator } from '../components/upstream/shadcn-ui/components/ui/separator.js';
import { ApiKey } from './api-key.js';
import { Ollama } from './ollama.js';
import { ProviderLogin } from './provider-login.js';

const connections = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'ChatGPT subscription or API key',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local or private server',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'API key',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'API key',
  },
] as const;

type Connection = (typeof connections)[number];

function connectionStatus(provider: ModelCatalog['providers'][number]) {
  if (provider.error) return 'Needs attention';

  return provider.connected ? 'Connected' : 'Not connected';
}

function ConnectionForm({
  connection,
  provider,
  refresh,
}: {
  connection: Connection;
  provider: ModelCatalog['providers'][number];
  refresh: () => Promise<void>;
}) {
  if (connection.id === 'ollama') {
    return (
      <Ollama
        key={provider.url}
        initialUrl={provider.url ?? 'http://localhost:11434'}
        refresh={refresh}
      />
    );
  }

  return (
    <div className="grid gap-5">
      {connection.id === 'openai' && provider.oauth && (
        <>
          <h3 className="font-medium">ChatGPT subscription</h3>
          <ProviderLogin refresh={refresh} />
          <Separator />
          <h3 className="font-medium">OpenAI API</h3>
          <p className="text-sm text-muted-foreground">
            ChatGPT subscription access and OpenAI API billing are separate. Connecting either
            method replaces this OpenAI connection.
          </p>
        </>
      )}
      <ApiKey provider={connection.id} refresh={refresh} />
      <p className="text-sm text-muted-foreground">
        The selected provider receives the conversation sent to its model.
      </p>
    </div>
  );
}

export function Connections({ refresh }: { refresh: () => Promise<void> }) {
  const id = useId();
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [selected, setSelected] = useState<Connection>();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async () => {
    setCatalog(await request('/api/models', catalogSchema));
  }, []);
  const connected = useCallback(async () => {
    await load();
    await refresh();
    setSaved(true);
  }, [
    load,
    refresh,
  ]);

  useEffect(() => {
    load().catch(() => setError('Cannot load provider connections.'));
  }, [
    load,
  ]);

  useEffect(() => {
    if (selected) heading.current?.focus();
  }, [
    selected,
  ]);

  const provider = catalog?.providers.find((value) => value.id === selected?.id);

  return (
    <section
      aria-label="Provider connections"
      className="grid gap-5"
      onChange={() => setSaved(false)}
      onSubmitCapture={() => setSaved(false)}
    >
      {selected && provider ? (
        <>
          <Button
            type="button"
            variant="ghost"
            className="w-fit"
            onClick={() => {
              setSelected(undefined);
              setSaved(false);
            }}
          >
            <ArrowLeftIcon />
            All connections
          </Button>
          <div className="grid gap-2">
            <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">
              {selected.name}
            </h2>
            <p className="text-sm text-muted-foreground">{selected.description}</p>
            <p className="text-sm">{connectionStatus(provider)}</p>
          </div>
          {provider.error && (
            <p role="alert" className="text-sm text-destructive">
              {provider.error}
            </p>
          )}
          <ConnectionForm
            key={selected.id}
            connection={selected}
            provider={provider}
            refresh={connected}
          />
          <p className="text-sm text-muted-foreground">
            Connecting a provider does not change an existing default model.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-xl font-semibold">Connections</h2>
          <p className="text-sm text-muted-foreground">
            Select a provider to view or change its connection.
          </p>
          {catalog && (
            <div className="divide-y border-y">
              {connections.map((connection) => {
                const available = catalog.providers.find((value) => value.id === connection.id);
                if (!available) return null;

                return (
                  <Button
                    key={connection.id}
                    type="button"
                    variant="ghost"
                    aria-label={connection.name}
                    aria-describedby={`${id}-${connection.id}`}
                    className="h-auto w-full justify-between gap-4 rounded-none px-2 py-4 text-left whitespace-normal"
                    onClick={() => {
                      setSelected(connection);
                      setSaved(false);
                    }}
                  >
                    <span className="grid gap-1">
                      <span>{connection.name}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {connection.description}
                      </span>
                    </span>
                    <span
                      id={`${id}-${connection.id}`}
                      className="ml-auto text-right text-xs font-normal text-muted-foreground"
                    >
                      {connectionStatus(available)}
                    </span>
                    <ChevronRightIcon className="shrink-0" />
                  </Button>
                );
              })}
            </div>
          )}
        </>
      )}
      {!catalog && !error && <p role="status">Loading connections…</p>}
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          Connection saved.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

export function Connect({ refresh }: { refresh: () => Promise<void> }) {
  return (
    <Page title="Connect a model">
      <Connections refresh={refresh} />
    </Page>
  );
}
