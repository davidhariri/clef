import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { request } from '../client/api.js';
import { type AppStatus, statusSchema } from '../server/accounts/contract.js';
import { AccountForm } from './accounts/index.js';
import { Page } from './components/page.js';
import { Chat } from './messages/index.js';
import { Connect } from './models/index.js';
import './globals.css';

function App() {
  const [status, setStatus] = useState<AppStatus>();
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setStatus(await request('/api/status', statusSchema));
  }, []);

  useEffect(() => {
    refresh().catch(() =>
      setError('Clef is unavailable. Check that the server is running, then reload.'),
    );
  }, [
    refresh,
  ]);

  if (error)
    return (
      <Page title="Cannot connect.">
        <p role="alert">{error}</p>
      </Page>
    );
  if (!status)
    return (
      <Page title="Loading">
        <p role="status">Connecting to Clef…</p>
      </Page>
    );
  if (status.phase === 'ready') return <Chat refresh={refresh} />;
  if (status.phase === 'connect') return <Connect refresh={refresh} />;

  return <AccountForm key={status.phase} status={status} refresh={refresh} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

createRoot(root).render(<App />);
