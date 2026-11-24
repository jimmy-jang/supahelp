import { useEffect, useState } from 'react';
import type { ScreenshotPreview } from '../../../contracts/playbooks';
import { useAccount } from '../accounts/AccountProvider';
// Loaded screenshots by book+id so remounts (mode switch, split view) paint
// instantly instead of flashing "Loading screenshot…".
const cache = new Map<string, ScreenshotPreview>();

export function StoredScreenshot({ book, id }: { book: string; id: string }) {
  const { snapshot: account, isCurrent } = useAccount();
  const key = `${account.context.generation}:${book}:${id}`;
  const [shot, setShot] = useState<ScreenshotPreview | undefined>(() =>
    cache.get(key),
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    if (cache.has(key)) return;
    let active = true;
    void window.supahelp
      .getPlaybookScreenshot({
        context: account.context,
        id: book,
        screenshotId: id,
      })
      .then((r) => {
        if (active && isCurrent(account.context)) {
          if (r.ok) {
            cache.set(key, r.value);
            setShot(r.value);
          } else setError(true);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [book, id, account.context.generation]);
  return shot ? (
    <figure className="m-0 rounded-item bg-sunk p-2">
      <img
        className="max-h-60 max-w-full"
        src={shot.data}
        alt="Reviewed Playbook screenshot"
      />
      <figcaption className="text-meta text-ink-3">
        Confirmed no customer data
      </figcaption>
    </figure>
  ) : error ? (
    <p role="alert">Screenshot unavailable. Replace it before publishing.</p>
  ) : (
    <p>Loading screenshot…</p>
  );
}
