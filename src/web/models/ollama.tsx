import { useEffect, useState } from 'react';
import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import { catalogSchema } from '../../server/models/contract.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { Input } from '../components/upstream/shadcn-ui/components/ui/input.js';
import { Label } from '../components/upstream/shadcn-ui/components/ui/label.js';
import { useAction } from '../platform/action.js';

export function Ollama({ refresh }: { refresh: () => Promise<void> }) {
  const [url, setUrl] = useState('http://localhost:11434');
  const action = useAction();
  const { setError } = action;
  useEffect(() => {
    let active = true;
    request('/api/models', catalogSchema)
      .then((catalog) => {
        const stored = catalog.providers.find((provider) => provider.id === 'ollama')?.url;
        if (active && stored) setUrl(stored);
      })
      .catch(() => {
        if (active) setError('Cannot load the Ollama connection.');
      });
    return () => {
      active = false;
    };
  }, [
    setError,
  ]);

  return (
    <details>
      <summary className="cursor-pointer text-sm">Use local Ollama</summary>
      <form
        className="mt-4 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          action.run(async () => {
            await request('/api/models/ollama', okSchema, {
              body: {
                url,
              },
            });
            await refresh();
          });
        }}
      >
        <Label className="grid gap-2">
          Ollama server URL
          <Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} required />
        </Label>
        <p className="text-sm text-muted-foreground">
          The Clef server connects to this URL, not your browser. No API key is needed. Use
          unauthenticated HTTP only on a trusted network, never on a public endpoint. Connect again
          to refresh installed models. Model defaults apply to new conversations only.
        </p>
        <Button type="submit" disabled={action.busy}>
          Connect Ollama
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
