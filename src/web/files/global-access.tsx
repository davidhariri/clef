import { useState } from 'react';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/upstream/shadcn-ui/components/ui/dialog.js';

export function GlobalAccess({
  enabled,
  busy,
  change,
}: {
  enabled: boolean;
  busy: boolean;
  change: (enabled: boolean) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="grid gap-3 border-t pt-4">
      <h3 className="font-semibold text-destructive">Dangerous: global host access</h3>
      <p className="text-sm">Global access is {enabled ? 'on' : 'off'}.</p>
      <p className="text-sm text-muted-foreground">
        This permits reading and writing across the server's filesystem, including mounted
        directories. Directory restrictions still apply. Clef private files remain protected. Every
        deletion still needs approval.
      </p>
      <Button
        type="button"
        variant={enabled ? 'outline' : 'destructive'}
        disabled={busy}
        className="w-fit"
        onClick={() => {
          setError('');
          if (enabled)
            void change(false).catch((failure: unknown) =>
              setError(
                failure instanceof Error ? failure.message : 'Cannot disable global access.',
              ),
            );
          else setConfirming(true);
        }}
      >
        {enabled ? 'Disable global access' : 'Enable global access'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable global host file access?</DialogTitle>
            <DialogDescription>
              Clef could overwrite personal files or change startup programs. A code sandbox does
              not prevent this. In Docker or a VM, exposed host mounts are also accessible. Files
              read can be sent to your selected model provider.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                void change(true)
                  .then(() => setConfirming(false))
                  .catch((failure: unknown) =>
                    setError(
                      failure instanceof Error ? failure.message : 'Cannot enable global access.',
                    ),
                  );
              }}
            >
              I understand. Enable global access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
