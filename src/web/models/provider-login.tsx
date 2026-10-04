import { useEffect, useState } from 'react';
import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import { type LoginState, loginStateSchema } from '../../server/models/contract.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { Input } from '../components/upstream/shadcn-ui/components/ui/input.js';
import { Label } from '../components/upstream/shadcn-ui/components/ui/label.js';
import { useAction } from '../platform/action.js';

export function ProviderLogin({ refresh }: { refresh: () => Promise<void> }) {
  const [login, setLogin] = useState<LoginState>();
  const [answer, setAnswer] = useState('');
  const { run, busy, error, setError } = useAction();
  const loginId = login?.id;

  useEffect(() => {
    if (!loginId) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    function fail(failure: unknown) {
      if (active) setError(failure instanceof Error ? failure.message : 'Sign-in failed.');
    }

    async function update(state: LoginState) {
      if (!active) return;

      setLogin(state);
      if (state.state === 'done') {
        await refresh();
        setLogin(undefined);
        setAnswer('');
        return;
      }
      if (state.state === 'failed') return;

      timer = setTimeout(poll, 400);
    }

    function poll() {
      void request(`/api/models/login/${loginId}`, loginStateSchema).then(update).catch(fail);
    }

    poll();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    loginId,
    refresh,
    setError,
  ]);

  return (
    <div className="grid gap-4">
      {!login && (
        <Button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setLogin(
                await request('/api/models/login', loginStateSchema, {
                  body: {
                    provider: 'openai',
                  },
                }),
              );
            })
          }
        >
          Sign in with ChatGPT
        </Button>
      )}
      {login && (
        <>
          <p className="text-sm">{login.message}</p>
          {login.url && (
            <Button asChild>
              <a href={login.url} target="_blank" rel="noreferrer">
                Open provider sign-in
              </a>
            </Button>
          )}
          {login.prompt && (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  await request(`/api/models/login/${login.id}`, okSchema, {
                    body: {
                      answer,
                    },
                  });
                  setAnswer('');
                });
              }}
            >
              <p className="text-sm text-muted-foreground">{login.prompt}</p>
              <Label className="grid gap-2">
                Sign-in response
                <Input
                  value={answer}
                  autoComplete="off"
                  onChange={(event) => setAnswer(event.target.value)}
                  required
                />
              </Label>
              <Button type="submit" disabled={busy}>
                Complete sign-in
              </Button>
            </form>
          )}
          {login.state === 'failed' && (
            <Button type="button" onClick={() => setLogin(undefined)}>
              Try again
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
