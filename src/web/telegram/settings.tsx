import { useCallback, useEffect, useState } from 'react';
import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import {
  type TelegramPairing,
  type TelegramStatus,
  telegramPairingSchema,
  telegramStatusSchema,
} from '../../server/telegram/contract.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { Input } from '../components/upstream/shadcn-ui/components/ui/input.js';
import { Label } from '../components/upstream/shadcn-ui/components/ui/label.js';
import { useAction } from '../platform/action.js';

export function TelegramSettings() {
  const [status, setStatus] = useState<TelegramStatus>();
  const [pairing, setPairing] = useState<TelegramPairing>();
  const action = useAction();
  const { setError } = action;
  const refresh = useCallback(async () => {
    setStatus(await request('/api/telegram', telegramStatusSchema));
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request('/api/telegram', telegramStatusSchema);
        if (active) setStatus(next);
      } catch {
        if (active) setError('Cannot load the Telegram connection.');
      } finally {
        if (active) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    setError,
  ]);

  return (
    <details>
      <summary className="cursor-pointer text-sm">Telegram</summary>
      <div className="mt-4 grid gap-4">
        <p className="text-sm text-muted-foreground">
          Text your agent from one paired Telegram account. Telegram shares your Clef conversation.
          Messages pass through Telegram and your selected model. Bot chats are not end-to-end
          encrypted. Voice notes, attachments, and groups are not supported.
        </p>
        {status?.state === 'disconnected' && (
          <ConnectTelegram
            connected={async (value) => {
              setPairing(value);
              await refresh();
            }}
          />
        )}
        {status?.username && <p className="text-sm">Bot: @{status.username}</p>}
        {status?.ownerId && <p className="text-sm">Paired Telegram account: {status.ownerId}</p>}
        {status?.state === 'pairing' && (
          <>
            {pairing && (
              <div className="grid gap-2">
                <a
                  className="text-sm underline"
                  href={pairing.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Telegram to pair
                </a>
                <p className="text-sm text-muted-foreground">
                  Press Start in Telegram. This private link expires in 10 minutes. Do not share it.
                </p>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={action.busy}
              onClick={() =>
                action.run(async () => {
                  setPairing(
                    await request('/api/telegram/pair', telegramPairingSchema, {
                      body: {},
                    }),
                  );
                })
              }
            >
              New pairing link
            </Button>
          </>
        )}
        {status && status.state !== 'disconnected' && (
          <Button
            type="button"
            variant="outline"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await request('/api/telegram/disconnect', okSchema, {
                  body: {},
                });
                setPairing(undefined);
                await refresh();
              })
            }
          >
            Disconnect Telegram
          </Button>
        )}
        {(action.error || status?.error) && (
          <p role="alert" className="text-sm text-destructive">
            {action.error || status?.error}
          </p>
        )}
      </div>
    </details>
  );
}

function ConnectTelegram({
  connected,
}: {
  connected: (pairing: TelegramPairing) => Promise<void>;
}) {
  const [token, setToken] = useState('');
  const action = useAction();

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        action.run(async () => {
          const pairing = await request('/api/telegram/connect', telegramPairingSchema, {
            body: {
              token,
            },
          });
          setToken('');
          await connected(pairing);
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Create a separate bot with{' '}
        <a className="underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">
          @BotFather
        </a>
        , then paste its token here. Clef stores the token encrypted. No public port is needed.
      </p>
      <Label className="grid gap-2">
        Telegram bot token
        <Input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          required
        />
      </Label>
      <Button type="submit" disabled={action.busy}>
        Connect Telegram
      </Button>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </form>
  );
}
