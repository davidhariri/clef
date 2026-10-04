import { useState } from 'react';
import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { Input } from '../components/upstream/shadcn-ui/components/ui/input.js';
import { Label } from '../components/upstream/shadcn-ui/components/ui/label.js';
import { useAction } from '../platform/action.js';

export function ApiKey({ provider, refresh }: { provider: string; refresh: () => Promise<void> }) {
  const [key, setKey] = useState('');
  const action = useAction();

  return (
    <form
      className="grid gap-4"
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
      <p className="text-sm text-muted-foreground">Stored keys are encrypted by Clef.</p>
      <Button type="submit" className="w-fit" disabled={action.busy}>
        Connect provider
      </Button>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </form>
  );
}
