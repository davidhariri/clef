import { useState } from 'react';
import { request } from '../../client/api.js';
import { type AppStatus, okSchema } from '../../server/accounts/contract.js';
import { Page } from '../components/page.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { Input } from '../components/upstream/shadcn-ui/components/ui/input.js';
import { Label } from '../components/upstream/shadcn-ui/components/ui/label.js';
import { useAction } from '../platform/action.js';
import { KeyFields } from './key-fields.js';

export function AccountForm({
  status,
  refresh,
}: {
  status: AppStatus;
  refresh: () => Promise<void>;
}) {
  const setup = status.phase === 'setup';
  const recovery = status.phase === 'locked';
  const [username, setUsername] = useState(status.hostname);
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const title = setup ? 'Create your account' : recovery ? 'Unlock your connections.' : 'Sign in';

  async function submit() {
    if (recovery) {
      await request('/api/credentials/recover', okSchema, {
        body: {
          key,
        },
      });
    } else if (setup) {
      const token = new URLSearchParams(location.hash.slice(1)).get('setup') ?? '';

      await request('/api/setup', okSchema, {
        body: {
          username,
          password,
          key,
        },
        headers: {
          'x-clef-setup': token,
        },
      });
      history.replaceState(null, '', '/');
    } else {
      await request('/api/login', okSchema, {
        body: {
          username,
          password,
        },
      });
    }

    setKey('');
    setPassword('');
    await refresh();
  }

  return (
    <Page title={title}>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          action.run(submit);
        }}
      >
        {recovery && (
          <p className="text-sm text-muted-foreground">
            Use your saved encryption key. Your password is separate.
          </p>
        )}
        {!recovery && (
          <>
            <Label className="grid gap-2">
              Username
              <Input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </Label>
            <Label className="grid gap-2">
              Password
              <Input
                type="password"
                autoComplete={setup ? 'new-password' : 'current-password'}
                minLength={setup ? 12 : 1}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Label>
          </>
        )}
        {(setup || recovery) && (
          <KeyFields value={key} onChange={setKey} setup={setup} saved={saved} onSaved={setSaved} />
        )}
        {action.error && (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        )}
        <Button type="submit" disabled={action.busy || (setup && !saved)}>
          {setup ? 'Create account' : recovery ? 'Unlock' : 'Sign in'}
        </Button>
      </form>
    </Page>
  );
}
