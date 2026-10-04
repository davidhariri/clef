import { useState } from 'react';

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function run(work: () => Promise<void>): void {
    setBusy(true);
    setError('');
    void (async () => {
      try {
        await work();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'The request failed.');
      } finally {
        setBusy(false);
      }
    })();
  }
  return {
    busy,
    error,
    run,
    setError,
  };
}
