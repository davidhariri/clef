import { useEffect, useState } from 'react';
import { request } from '../../client/api.js';
import { type FileAccessView, fileAccessViewSchema } from '../../server/files/contract.js';
import { directoryAccessSchema, type FileAccess } from '../../server/permissions/contract.js';
import { SelectField } from '../components/select-field.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { useAction } from '../platform/action.js';
import { accessOptions, DirectoryForm } from './directory-form.js';
import { GlobalAccess } from './global-access.js';

export function FileAccessSettings() {
  const [view, setView] = useState<FileAccessView>();
  const [saving, setSaving] = useState(false);
  const action = useAction();
  const { setError } = action;

  useEffect(() => {
    let active = true;
    request('/api/files/access', fileAccessViewSchema)
      .then((value) => {
        if (active) setView(value);
      })
      .catch(() => {
        if (active) setError('Cannot load file access.');
      });
    return () => {
      active = false;
    };
  }, [
    setError,
  ]);

  async function save(policy: FileAccess, confirmGlobal = false): Promise<void> {
    if (!view) return;
    setSaving(true);
    try {
      setView(
        await request('/api/files/access', fileAccessViewSchema, {
          method: 'PUT',
          body: {
            revision: view.revision,
            policy,
            confirmGlobal,
          },
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <h2 className="text-xl font-semibold">File access</h2>
      <p className="text-sm text-muted-foreground">
        Directory access includes subdirectories. The most specific directory rule applies. Read and
        write permits creation and updates, including overwriting contents. Every deletion needs
        approval; moves are unavailable. Use No access to block inherited access. Changes save
        immediately.
      </p>
      <p className="text-sm text-muted-foreground">
        File contents read by Clef can be sent to your selected model provider.
      </p>
      {!view && !action.error && <p role="status">Loading file access…</p>}
      {(action.error || view?.error) && (
        <p role="alert" className="text-sm text-destructive">
          {action.error || view?.error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={saving || action.busy}
        onClick={() =>
          action.run(async () => {
            setView(await request('/api/files/access', fileAccessViewSchema));
          })
        }
      >
        Refresh access
      </Button>
      {view && (
        <fieldset
          className="grid min-w-0 gap-4"
          disabled={saving || action.busy || Boolean(view.error)}
        >
          <ul className="grid gap-4">
            {view.policy.directories.map((rule) => (
              <li key={rule.path} className="grid min-w-0 gap-2 border-b pb-4">
                <p className="break-all font-mono text-sm">{rule.path}</p>
                {rule.path === view.workspace && (
                  <p className="text-sm text-muted-foreground">Workspace</p>
                )}
                <SelectField
                  label={`Access for ${rule.path}`}
                  value={rule.access}
                  options={accessOptions}
                  onChange={(value) =>
                    action.run(() =>
                      save({
                        ...view.policy,
                        directories: view.policy.directories.map((item) =>
                          item.path === rule.path
                            ? {
                                ...item,
                                access: directoryAccessSchema.parse(value),
                              }
                            : item,
                        ),
                      }),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  aria-label={`Remove rule for ${rule.path}`}
                  onClick={() =>
                    action.run(() =>
                      save({
                        ...view.policy,
                        directories: view.policy.directories.filter(
                          (item) => item.path !== rule.path,
                        ),
                      }),
                    )
                  }
                >
                  Remove rule
                </Button>
              </li>
            ))}
          </ul>
          <DirectoryForm
            add={(rule) =>
              action.run(() =>
                save({
                  ...view.policy,
                  directories: [
                    ...view.policy.directories,
                    rule,
                  ],
                }),
              )
            }
          />
          <GlobalAccess
            enabled={view.policy.global}
            busy={saving || action.busy}
            change={(enabled) =>
              save(
                {
                  ...view.policy,
                  global: enabled,
                },
                enabled,
              )
            }
          />
        </fieldset>
      )}
    </div>
  );
}
