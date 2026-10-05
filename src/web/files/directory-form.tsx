import { useState } from 'react';
import { type DirectoryRule, directoryAccessSchema } from '../../server/permissions/contract.js';
import { SelectField } from '../components/select-field.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { Input } from '../components/upstream/shadcn-ui/components/ui/input.js';
import { Label } from '../components/upstream/shadcn-ui/components/ui/label.js';

export const accessOptions = [
  {
    value: 'read',
    label: 'Read only',
  },
  {
    value: 'read-write',
    label: 'Read and write',
  },
  {
    value: 'deny',
    label: 'No access',
  },
];

export function DirectoryForm({ add }: { add: (rule: DirectoryRule) => void }) {
  const [path, setPath] = useState('');
  const [access, setAccess] = useState<DirectoryRule['access']>('read');

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        add({
          path,
          access,
        });
      }}
    >
      <Label htmlFor="file-directory">Directory path</Label>
      <Input
        id="file-directory"
        required
        placeholder="/absolute/path/to/notes"
        value={path}
        onChange={(event) => setPath(event.target.value)}
      />
      <SelectField
        label="New directory access"
        value={access}
        options={accessOptions}
        onChange={(value) => setAccess(directoryAccessSchema.parse(value))}
      />
      <Button type="submit" className="w-fit">
        Add directory
      </Button>
    </form>
  );
}
