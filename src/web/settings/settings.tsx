import { SettingsIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { SignOut } from '../accounts/index.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/upstream/shadcn-ui/components/ui/dialog.js';
import { Separator } from '../components/upstream/shadcn-ui/components/ui/separator.js';
import { Connections, ModelDefaults } from '../models/index.js';

export function Settings({ refresh }: { refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const connected = useCallback(async () => {
    await refresh();
    setOpen(false);
  }, [
    refresh,
  ]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost">
          <SettingsIcon />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage model defaults and provider connections.</DialogDescription>
        </DialogHeader>
        <ModelDefaults saved={() => setOpen(false)} />
        <details>
          <summary className="mb-4 cursor-pointer text-sm">Manage connections</summary>
          <Connections refresh={connected} />
        </details>
        <Separator />
        <h3 className="font-medium">Tools</h3>
        <p className="text-sm text-muted-foreground">
          Code execution is not enabled in this build. The installed runtime needs an output limit
          before Clef can expose it safely.
        </p>
        <SignOut refresh={refresh} />
      </DialogContent>
    </Dialog>
  );
}
