import type { ScreenshotPreview } from '../../../contracts/playbooks';
import { Button } from '../../components/Button';

// Screenshot review as a sheet over the panel. Insert is the confirmation.
export function ScreenshotReview({
  shot,
  busy,
  inline,
  onConfirm,
  onCancel,
}: {
  shot: ScreenshotPreview;
  busy: boolean;
  inline?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <section
      aria-label="Review screenshot"
      className={
        inline
          ? 'flex flex-col rounded-item border border-line'
          : 'absolute inset-x-0 top-[52px] bottom-0 z-[5] flex flex-col bg-surface'
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pt-1 pb-6">
        <h2 className="m-0 mt-1 text-title font-semibold">Review screenshot</h2>
        <div className="my-3 rounded-item bg-sunk p-4">
          <img
            className="mx-auto block max-h-[360px] max-w-full rounded-[4px] shadow-1"
            src={shot.data}
            alt="Screenshot awaiting review"
            draggable={false}
          />
        </div>
        <p className="m-0 text-meta text-ink-3">
          {shot.width} × {shot.height} pixels · imported image is held in memory
          until you insert it
        </p>
      </div>
      <div className="flex h-[52px] flex-none items-center gap-2 border-t border-line pr-3 pl-7">
        <span className="text-meta text-ink-3">
          Inserts into the Playbook body
        </span>
        <span className="flex-1" />
        <Button kind="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={onConfirm}>
          Insert screenshot
        </Button>
      </div>
    </section>
  );
}
