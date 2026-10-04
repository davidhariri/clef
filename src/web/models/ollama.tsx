import { useState } from 'react';
import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { Input } from '../components/upstream/shadcn-ui/components/ui/input.js';
import { Label } from '../components/upstream/shadcn-ui/components/ui/label.js';
import { useAction } from '../platform/action.js';

export function Ollama({
  initialUrl,
  refresh,
}: {
  initialUrl: string;
  refresh: () => Promise<void>;
}) {
  const [url, setUrl] = useState(initialUrl);
  const action = useAction();

  return (
    <form
      className="grid gap-4"
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
        unauthenticated HTTP only on a trusted network, never on a public endpoint. Connect again to
        refresh installed models.
      </p>
      <Button type="submit" className="w-fit" disabled={action.busy}>
        Connect Ollama
      </Button>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </form>
  );
}
