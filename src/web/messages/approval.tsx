import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import type { PermissionChoice, PermissionRequest } from '../../server/permissions/contract.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { useAction } from '../platform/action.js';

type ConfigurationRequest = Extract<
  PermissionRequest,
  {
    kind: 'configuration';
  }
>;
type FileRequest = Extract<
  PermissionRequest,
  {
    kind: 'file';
  }
>;

function ConfigurationDetails({ approval }: { approval: ConfigurationRequest }) {
  return (
    <>
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
    </>
  );
}

function FileDetails({ approval }: { approval: FileRequest }) {
  const deleting = approval.operation === 'delete';
  const reading = approval.operation === 'read' || approval.operation === 'list';
  return (
    <>
      <h2 className="font-medium">{deleting ? 'Delete this file?' : 'Allow file access?'}</h2>
      <p>Action: {approval.operation}</p>
      <p className="break-all">File path: {approval.path}</p>
      {approval.bytes !== undefined && <p>Write size: {approval.bytes} bytes</p>}
      {deleting ? (
        <p>
          This approves deletion of this file version only. Deletion cannot be undone. Future
          deletions need another approval.
        </p>
      ) : (
        <>
          <p className="break-all">Directory: {approval.directory}</p>
          <p>
            Requested access: {reading ? 'Read only' : 'Read and write'}, including subdirectories.
          </p>
          <p>
            This time permits only this action. Always saves the displayed directory access. Never
            blocks all file access to this directory, except for more-specific directory rules.
          </p>
        </>
      )}
      <p>File contents read by Clef can be sent to your selected model provider.</p>
    </>
  );
}

export function Approval({ approval }: { approval: PermissionRequest }) {
  const action = useAction();
  if (!('kind' in approval)) return null;
  const deleting = approval.kind === 'file' && approval.operation === 'delete';
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
    ...(deleting
      ? []
      : [
          {
            choice: 'always' as const,
            label: 'Always',
          },
          {
            choice: 'never' as const,
            label: 'Never',
          },
        ]),
  ];

  return (
    <section
      aria-label={approval.kind === 'file' ? 'File approval' : 'Configuration approval'}
      className="grid gap-2 border-t p-4 text-sm"
    >
      {approval.kind === 'file' ? (
        <FileDetails approval={approval} />
      ) : (
        <ConfigurationDetails approval={approval} />
      )}
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
