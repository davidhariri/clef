import { matchesKey, type Terminal, Text, TuiMainScreen } from '@earendil-works/pi-tui';
import { ApiError, ClefClient, savedToken, saveToken, serverAddress } from '../client/index.js';
import { statusSchema } from '../server/access/contract.js';
import { Dialogs } from './components/dialogs.js';
import { muted, safeText } from './components/theme.js';
import { clefName } from './identity.js';

async function checkConnection(url: string, token: string, signal: AbortSignal) {
  const client = new ClefClient(url, token);
  const cancel = () => client.close();
  signal.addEventListener('abort', cancel, {
    once: true,
  });
  if (signal.aborted) cancel();
  try {
    await client.request('/api/status', statusSchema);
    return client;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

async function savedConnection(url: string, signal: AbortSignal) {
  const saved = await savedToken(url);
  if (saved) {
    try {
      return await checkConnection(url, saved, signal);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
  }
  return undefined;
}

export async function connectRemote(
  address: string,
  terminal: Terminal,
  signal: AbortSignal,
): Promise<ClefClient | undefined> {
  const url = serverAddress(address);
  const saved = await savedConnection(url, signal);
  if (saved) return saved;

  const stop = new AbortController();
  const combined = AbortSignal.any([
    signal,
    stop.signal,
  ]);
  const tui = new TuiMainScreen(terminal);
  const dialogs = new Dialogs(tui, combined);
  tui.addChild(new Text(muted(`${clefName} · ${safeText(url)}`), 1, 1));
  tui.addInputListener((data) => {
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'ctrl+d')) {
      stop.abort();
      return {
        consume: true,
      };
    }
    return undefined;
  });
  tui.start();
  try {
    let detail =
      'On the server host, open /settings → Client access → Add client. Paste that token here.';
    while (!combined.aborted) {
      const token = await dialogs.input('Client token', {
        secret: true,
        detail,
      });
      if (!token) return undefined;
      try {
        const client = await checkConnection(url, token, combined);
        await saveToken(url, token);
        return client;
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) throw error;
        detail = error.message;
      }
    }
    return undefined;
  } catch (error) {
    if (!combined.aborted) throw error;
    return undefined;
  } finally {
    tui.stop();
    await terminal.drainInput();
  }
}
