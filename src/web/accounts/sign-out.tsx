import { request } from '../../client/api.js';
import { okSchema } from '../../server/accounts/contract.js';
import { Button } from '../components/upstream/shadcn-ui/components/ui/button.js';
import { useAction } from '../platform/action.js';

export function SignOut({ refresh }: { refresh: () => Promise<void> }) {
  const action = useAction();

  return (
    <div className="grid gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={action.busy}
        onClick={() =>
          action.run(async () => {
            await request('/api/logout', okSchema, {
              body: {},
            });
            await refresh();
          })
        }
      >
        Sign out
      </Button>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </div>
  );
}
