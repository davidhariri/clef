import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { Checkbox } from '../components/upstream/shadcn-ui/components/ui/checkbox.js';
import { Input } from '../components/upstream/shadcn-ui/components/ui/input.js';
import { Label } from '../components/upstream/shadcn-ui/components/ui/label.js';
import { useAction } from '../platform/action.js';

export function KeyFields({
  value,
  onChange,
  setup,
  saved,
  onSaved,
}: {
  value: string;
  onChange: (value: string) => void;
  setup: boolean;
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const action = useAction();

  function change(key: string) {
    onChange(key);
    onSaved(false);
  }

  function generate() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

    change(key);
  }

  return (
    <>
      <Label className="grid gap-2">
        Encryption key
        <Input
          value={value}
          onChange={(event) => change(event.target.value)}
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
          required
        />
      </Label>
      {setup && (
        <>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={generate}>
              Generate key
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!value || action.busy}
              onClick={() => action.run(() => navigator.clipboard.writeText(value))}
            >
              Copy key
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Save this key outside Clef. It protects your provider credentials and is needed for
            recovery.
          </p>
          <Label>
            <Checkbox checked={saved} onCheckedChange={(checked) => onSaved(checked === true)} />I
            saved my recovery key
          </Label>
        </>
      )}
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </>
  );
}
