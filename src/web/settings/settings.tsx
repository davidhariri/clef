import { SettingsIcon } from 'lucide-react';
import { useState } from 'react';
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
import { FileAccessSettings } from '../files/index.js';
import { Connections, ModelDefaults } from '../models/index.js';

const groups = [
  {
    label: 'Models',
    sections: [
      'Default model',
      'Connections',
    ],
  },
  {
    label: 'System',
    sections: [
      'File access',
      'Tools',
    ],
  },
  {
    label: 'Personal',
    sections: [
      'Account',
    ],
  },
] as const;

type Section = (typeof groups)[number]['sections'][number];

export function Settings({ refresh }: { refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('Default model');

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setSection('Default model');
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost">
          <SettingsIcon />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(42rem,calc(100svh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-5 pr-12 text-left">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Manage model defaults, provider connections, tools, and your account.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label="Settings sections"
            className="flex shrink-0 flex-wrap gap-1 border-b bg-muted/50 p-3 sm:w-52 sm:flex-col sm:gap-6 sm:border-r sm:border-b-0 sm:p-4"
          >
            {groups.map((group) => (
              <div key={group.label} className="flex gap-1 sm:grid">
                <h2 className="sr-only px-3 pb-2 text-xs font-medium text-muted-foreground sm:not-sr-only">
                  {group.label}
                </h2>
                {group.sections.map((name) => (
                  <Button
                    key={name}
                    type="button"
                    variant={section === name ? 'secondary' : 'ghost'}
                    aria-current={section === name ? 'page' : undefined}
                    className="justify-start"
                    onClick={() => setSection(name)}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            ))}
          </nav>
          <section
            aria-label={section}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6 sm:p-8"
          >
            {section === 'Default model' && (
              <ModelDefaults connections={() => setSection('Connections')} />
            )}
            {section === 'Connections' && <Connections refresh={refresh} />}
            {section === 'File access' && <FileAccessSettings />}
            {section === 'Tools' && (
              <div className="grid gap-4">
                <h2 className="text-xl font-semibold">Tools</h2>
                <dl className="flex items-center justify-between gap-4 border-y py-4 text-sm">
                  <dt>Code execution</dt>
                  <dd className="text-muted-foreground">Not enabled</dd>
                </dl>
                <p className="text-sm text-muted-foreground">
                  The installed runtime needs an output limit before Clef can expose code execution
                  safely. This is a build limit, not a setting you can turn on.
                </p>
              </div>
            )}
            {section === 'Account' && (
              <div className="grid gap-4">
                <h2 className="text-xl font-semibold">Account</h2>
                <p className="text-sm text-muted-foreground">Manage your Clef browser session.</p>
                <SignOut refresh={refresh} />
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
