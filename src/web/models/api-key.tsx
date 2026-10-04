import { useState } from 'react';
import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import { SelectField } from '../components/select-field.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { Input } from '../components/upstream/shadcn-ui/components/ui/input.js';
import { Label } from '../components/upstream/shadcn-ui/components/ui/label.js';
import { useAction } from '../platform/action.js';

const providers = [
  {
    value: 'openai',
    label: 'OpenAI API',
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
  },
];

export function ApiKey({ refresh }: { refresh: () => Promise<void> }) {
  const [provider, setProvider] = useState('openai');
  const [key, setKey] = useState('');
  const action = useAction();

  return (
    <details>
      <summary className="cursor-pointer text-sm">Use an API key instead</summary>
      <form
        className="mt-4 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            await request('/api/models/key', okSchema, {
              body: {
                provider,
                key,
              },
            });
            setKey('');
            await refresh();
          });
        }}
      >
        <SelectField label="Provider" value={provider} options={providers} onChange={setProvider} />
        <Label className="grid gap-2">
          API key
          <Input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            required
          />
        </Label>
        <Button type="submit" disabled={action.busy}>
          Connect provider
        </Button>
        {action.error && (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        )}
      </form>
    </details>
  );
}
