import { useState } from 'react';
import type { FileApproval } from '../../../contracts/chat';
import { Button } from '../../components/Button';
import { useAccount } from '../accounts/AccountProvider';

const block =
  'm-0 max-h-64 overflow-auto rounded-item bg-canvas p-3 font-mono text-meta whitespace-pre-wrap break-words select-text';

export function FileApprovalCard({
  approval,
  chatId,
}: {
  approval: FileApproval;
  chatId: string;
}) {
  const { snapshot: account, isCurrent } = useAccount();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { context } = account;
  const answer = async (approved: boolean) => {
    if (pending) return;
    setPending(true);
    setError('');
    const result = await window.supahelp.answerFileApproval(
      { chatId, requestId: approval.requestId, approved },
      context,
    );
    if (!isCurrent(context)) return;
    setPending(false);
    if (!result.ok) setError(result.error);
  };
  return (
    <section
      aria-label="File change approval"
      className="flex flex-col gap-2.5 rounded-card bg-surface px-3.5 py-3 shadow-1"
    >
      <div className="flex items-center gap-2">
        <b>
          {approval.tool === 'Write' ? 'Write file' : 'Edit file'} ·{' '}
          <span className="font-mono text-meta">{approval.path}</span>
        </b>
        <span role="status" className="text-attn">
          Needs approval
        </span>
      </div>
      {approval.before !== undefined && (
        <>
          <p className="m-0 text-meta text-ink-2">Replace</p>
          <pre className={block}>{approval.before}</pre>
          <p className="m-0 text-meta text-ink-2">With</p>
        </>
      )}
      <pre className={block}>{approval.after}</pre>
      {error && (
        <p role="alert" className="m-0 text-bad">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => void answer(true)}>
          Approve change
        </Button>
        <Button
          kind="secondary"
          disabled={pending}
          onClick={() => void answer(false)}
        >
          Decline
        </Button>
      </div>
    </section>
  );
}
