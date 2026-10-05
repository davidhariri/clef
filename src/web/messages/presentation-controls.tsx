import { type ComponentRenderProps, useBoundProp } from '@json-render/react';
import { useId } from 'react';
import type { z } from 'zod';
import type { uiComponents } from '../../server/messages/contract.js';
import { SelectField } from '../components/select-field.js';
import { Checkbox } from '../components/upstream/shadcn-ui/components/ui/checkbox.js';
import { Input } from '../components/upstream/shadcn-ui/components/ui/input.js';
import { Label } from '../components/upstream/shadcn-ui/components/ui/label.js';
import { Textarea } from '../components/upstream/shadcn-ui/components/ui/textarea.js';

export type UiProps<Name extends keyof typeof uiComponents> = ComponentRenderProps<
  z.infer<(typeof uiComponents)[Name]>
>;

export function UiInput({ element, bindings, loading }: UiProps<'Input'>) {
  const id = useId();
  const [value, setValue] = useBoundProp(element.props.value, bindings?.value);

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{element.props.label}</Label>
      <Input
        id={id}
        value={value ?? ''}
        onChange={(event) => setValue(event.target.value)}
        maxLength={4000}
        disabled={loading}
        autoComplete="off"
      />
    </div>
  );
}

export function UiTextarea({ element, bindings, loading }: UiProps<'Textarea'>) {
  const id = useId();
  const [value, setValue] = useBoundProp(element.props.value, bindings?.value);

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{element.props.label}</Label>
      <Textarea
        id={id}
        value={value ?? ''}
        onChange={(event) => setValue(event.target.value)}
        maxLength={4000}
        disabled={loading}
        autoComplete="off"
      />
    </div>
  );
}

export function UiSelect({ element, bindings, loading }: UiProps<'Select'>) {
  const [value, setValue] = useBoundProp(element.props.value, bindings?.value);

  return (
    <SelectField
      label={element.props.label}
      value={value ?? ''}
      options={element.props.options}
      onChange={setValue}
      disabled={loading ?? false}
    />
  );
}

export function UiCheckbox({ element, bindings, loading }: UiProps<'Checkbox'>) {
  const id = useId();
  const [checked, setChecked] = useBoundProp(element.props.checked, bindings?.checked);

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked ?? false}
        onCheckedChange={(value) => setChecked(value === true)}
        disabled={loading}
      />
      <Label htmlFor={id}>{element.props.label}</Label>
    </div>
  );
}
