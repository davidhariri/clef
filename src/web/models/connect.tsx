import { Page } from '../components/page.js';
import { ApiKey } from './api-key.js';
import { Ollama } from './ollama.js';
import { ProviderLogin } from './provider-login.js';

export function Connections({ refresh }: { refresh: () => Promise<void> }) {
  return (
    <section aria-label="Provider connections" className="grid gap-5">
      <ProviderLogin refresh={refresh} />
      <ApiKey refresh={refresh} />
      <Ollama refresh={refresh} />
      <p className="text-sm text-muted-foreground">
        Your selected provider receives the conversation sent to its model. ChatGPT subscription
        access and OpenAI API billing are separate.
      </p>
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
