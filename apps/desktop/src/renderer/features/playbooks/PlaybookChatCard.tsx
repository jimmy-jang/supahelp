import { useState } from 'react';
import type {
  PlaybookChatAction,
  ScreenshotPreview,
} from '../../../contracts/playbooks';
import { Button } from '../../components/Button';
import { useAccount } from '../accounts/AccountProvider';
import { ScreenshotReview } from './ScreenshotReview';

const labels: Record<PlaybookChatAction['kind'], string> = {
  saved: 'Open draft',
  open: 'Open Playbook',
  publish: 'Publish draft',
  discard: 'Discard draft',
  delete: 'Delete Playbook',
  export: 'Export Markdown',
  copy: 'Copy Markdown',
  screenshot: 'Choose screenshot',
};
const effects = {
  publish: 'The saved draft will become the published version.',
  discard:
    'The saved draft will be discarded. Any published version will remain available.',
  delete: 'The Playbook and all its versions will be deleted.',
};
const completed = {
  publish: 'Playbook published',
  discard: 'Draft discarded',
  delete: 'Playbook deleted',
  export: 'Markdown exported',
  copy: 'Markdown copied',
  screenshot: 'Screenshot inserted into the draft',
};

export function PlaybookChatCard({
  action,
  chatId,
  busy,
  onOpen,
}: {
  action: PlaybookChatAction;
  chatId: string;
  busy: boolean;
  onOpen(id: string): Promise<boolean>;
}) {
  const { snapshot: account, isCurrent } = useAccount();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [shot, setShot] = useState<ScreenshotPreview>();
  const { context } = account;
  const { kind, playbookId: id, requestId, title } = action;
  const run = async (cancel = false, screenshotId?: string) => {
    const result = await window.supahelp.runPlaybookChatAction({
      context,
      chatId,
      requestId,
      cancel,
      screenshotId,
    });
    if (!isCurrent(context)) return;
    if (!result.ok) throw Error(result.error);
    return result.value;
  };
  const perform = async (work: () => Promise<void>) => {
    if (pending || busy) return;
    setPending(true);
    setError('');
    try {
      await work();
    } catch (error) {
      if (isCurrent(context))
        setError(
          error instanceof Error
            ? error.message
            : 'The Playbook action could not finish.',
        );
    } finally {
      if (isCurrent(context)) setPending(false);
    }
  };
  const reviewScreenshot = (confirm: boolean) =>
    void perform(async () => {
      if (!shot) return;
      await run(!confirm, shot.id);
      setShot(undefined);
    });

  return (
    <section
      aria-label="Playbook action"
      className="flex flex-col gap-2.5 rounded-card bg-surface px-3.5 py-3 shadow-1"
    >
      <b>{title}</b>
      {action.completed && kind !== 'open' && kind !== 'saved' && (
        <p role="status" className="m-0 text-ink-2">
          {completed[kind]}
        </p>
      )}
      {kind === 'saved' && <p className="m-0 text-ink-2">Draft saved</p>}
      {!action.completed &&
        (kind === 'publish' || kind === 'discard' || kind === 'delete') && (
          <p className="m-0 text-ink-2">{effects[kind]}</p>
        )}
      {error && (
        <p role="alert" className="m-0 text-bad">
          {error}
        </p>
      )}
      {action.completed ? null : shot ? (
        <ScreenshotReview
          inline
          shot={shot}
          busy={pending || busy}
          onConfirm={() => reviewScreenshot(true)}
          onCancel={() => reviewScreenshot(false)}
        />
      ) : (
        <div className="flex gap-1.5">
          <Button
            disabled={pending || busy}
            onClick={() =>
              void perform(async () => {
                if (
                  (kind === 'open' || kind === 'saved') &&
                  !(await onOpen(id))
                )
                  return;
                const result = await run();
                if (result && result !== true) setShot(result);
              })
            }
          >
            {labels[kind]}
          </Button>
          {kind !== 'saved' && (
            <Button
              kind="ghost"
              disabled={pending || busy}
              onClick={() =>
                void perform(async () => {
                  await run(true);
                })
              }
            >
              Cancel
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
