import { useState } from 'react';
import type { Reply } from '../../../contracts/chat';
import type { ConnectionAction } from '../../../contracts/connections';
import { Button } from '../../components/Button';
import { actionFields, toolTitle, type ActionField } from './action-fields';

function Fields({ fields }: { fields: ActionField[] }) {
  return (
    <dl className="m-0 flex flex-col gap-2.5">
      {fields.map((f) => (
        <div key={f.label} className="flex flex-col gap-1">
          <dt className="text-label text-ink-3">{f.label}</dt>
          <dd className="m-0 min-w-0 select-text">
            {f.fields ? (
              <div className="border-l border-line pl-3">
                <Fields fields={f.fields} />
              </div>
            ) : f.items ? (
              <ul className="m-0 list-disc pl-4">
                {f.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : f.long ? (
              <p className="m-0 max-h-48 overflow-auto rounded-item bg-canvas p-3 whitespace-pre-wrap break-words">
                {f.text}
              </p>
            ) : (
              <span className="break-words">{f.text}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ConnectionReceipts({
  name,
  actions,
  onDecision,
}: {
  name: string;
  actions: ConnectionAction[];
  onDecision: (
    id: string,
    decision: 'approve' | 'deny' | 'checked',
  ) => Promise<Reply<void>>;
}) {
  const [error, setError] = useState<string>();
  const decide = async (
    id: string,
    decision: 'approve' | 'deny' | 'checked',
  ) => {
    setError(undefined);
    try {
      const result = await onDecision(id, decision);
      if (!result.ok) setError(result.error);
    } catch {
      setError(
        'The decision could not be delivered. Check the action status before trying again.',
      );
    }
  };
  if (!actions.length) return null;
  return (
    <section aria-label={`${name} actions`} className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="m-0 text-bad">
          {error}
        </p>
      )}
      {actions.map((action) => (
        <div
          key={action.id}
          className="flex flex-col gap-2.5 rounded-card bg-surface px-3.5 py-3 shadow-1"
        >
          <div className="flex items-center gap-2">
            <b>{toolTitle(action.tool)}</b>
            <span
              role="status"
              className={
                ['pending', 'unknown'].includes(action.status)
                  ? 'text-attn'
                  : 'text-ink-3'
              }
            >
              {
                {
                  pending: 'Needs approval',
                  running: 'Running',
                  verified: 'Verified',
                  returned: 'Done',
                  failed: 'Failed',
                  unknown: 'Outcome unknown',
                  cancelled: 'Cancelled',
                  reviewed: 'Checked by you',
                }[action.status]
              }
            </span>
          </div>
          <p className="m-0 text-meta text-ink-2">
            {[name, action.account].filter(Boolean).join(' · ')}
          </p>
          <Fields fields={actionFields(action.tool, action.arguments)} />
          <details className="text-meta text-ink-3">
            <summary className="cursor-pointer">Technical details</summary>
            <pre className="mt-2 mb-0 max-h-64 overflow-auto rounded-item bg-canvas p-3 font-mono whitespace-pre-wrap break-words select-text">
              {JSON.stringify(action.arguments, null, 2)}
            </pre>
          </details>
          {action.message && (
            <p className="m-0 text-meta text-ink-2">{action.message}</p>
          )}
          {action.status === 'pending' && (
            <div className="flex gap-2">
              <Button onClick={() => decide(action.id, 'approve')}>
                Approve {name} action
              </Button>
              <Button
                kind="secondary"
                onClick={() => decide(action.id, 'deny')}
              >
                Cancel action
              </Button>
            </div>
          )}
          {action.status === 'unknown' && (
            <Button
              kind="secondary"
              onClick={() => decide(action.id, 'checked')}
            >
              I’ve checked the outcome in {name}
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
