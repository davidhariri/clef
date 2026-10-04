import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import type { PermissionChoice, PermissionRequest } from '../../server/permissions/contract.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { useAction } from '../platform/action.js';

export function Approval({ approval }: { approval: PermissionRequest }) {
  const action = useAction();
  if (!('kind' in approval)) return null;
  const choices: {
    choice: PermissionChoice;
    label: string;
  }[] = [
    {
      choice: 'deny',
      label: 'Deny',
    },
    {
      choice: 'once',
      label: 'This time',
    },
    {
      choice: 'always',
      label: 'Always',
    },
    {
      choice: 'never',
      label: 'Never',
    },
  ];

  return (
    <section aria-label="Configuration approval" className="grid gap-2 border-t p-4 text-sm">
      <h2 className="font-medium">Change model defaults?</h2>
      <p>
        Provider: {approval.defaults.provider}. Model: {approval.defaults.modelId}. Thinking:{' '}
        {approval.defaults.thinkingLevel}.
      </p>
      <p>
        {approval.switchConversation
          ? 'Also switch this reply at its next model request.'
          : 'Do not switch this reply. Saved defaults apply to your next message.'}
      </p>
      <p>Conversation: {approval.conversationId}</p>
      <p className="break-all">Requested revision: {approval.revision}</p>
      <p>
        Always and Never apply only to this conversation, this exact model and thinking level, and
        this switch option. The selected provider receives this conversation when it is used.
      </p>
      <div className="flex flex-wrap gap-2">
        {choices.map(({ choice, label }) => (
          <Button
            key={choice}
            variant="outline"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await request(`/api/conversation/permissions/${approval.id}`, okSchema, {
                  body: {
                    choice,
                  },
                });
              })
            }
          >
            {label}
          </Button>
        ))}
      </div>
      {action.error && (
        <p role="alert" className="text-destructive">
          {action.error}
        </p>
      )}
    </section>
  );
}
