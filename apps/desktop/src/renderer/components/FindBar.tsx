import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Icon';

// Find in page, scoped to one pane (the chat, or the Case/Playbook panel).
// Matches are painted with the CSS Custom Highlight API, so the DOM React owns
// is never touched. Panes opt in with `data-find-scope="<label>"`.
export function FindBar({
  scope,
  focusToken,
  onClose,
}: {
  scope: HTMLElement;
  /** Changes on every ⌘F, so a second press refocuses and selects the query. */
  focusToken: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusToken]);

  // Re-run on content changes (streaming replies, edits) without scrolling.
  useEffect(() => {
    const run = () => setRanges(findRanges(scope, query));
    run();
    let frame = 0;
    const observer = new MutationObserver((records) => {
      if (records.every((r) => bar.current?.contains(r.target))) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    });
    observer.observe(scope, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scope, query]);

  const current = ranges.length ? Math.min(index, ranges.length - 1) : -1;

  useEffect(() => {
    CSS.highlights.set('find', new Highlight(...ranges));
    if (current >= 0)
      CSS.highlights.set('find-current', new Highlight(ranges[current]));
    else CSS.highlights.delete('find-current');
    return () => {
      CSS.highlights.delete('find');
      CSS.highlights.delete('find-current');
    };
  }, [ranges, current]);

  const go = (step: number) => {
    if (!ranges.length) return;
    const next = (current + step + ranges.length) % ranges.length;
    setIndex(next);
    reveal(ranges[next]);
  };

  return createPortal(
    <div
      ref={bar}
      data-find-bar
      role="search"
      className="no-drag absolute top-[58px] right-4 z-20 flex items-center gap-1 rounded-item bg-surface py-1 pr-1 pl-2.5 shadow-2"
    >
      <input
        ref={input}
        aria-label={`Find in ${scope.dataset.findScope}`}
        placeholder={`Find in ${scope.dataset.findScope}`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
          const first = findRanges(scope, e.target.value)[0];
          if (first) reveal(first);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        className="w-48 bg-transparent text-meta text-ink outline-none placeholder:text-ink-3"
      />
      <span
        role="status"
        className="min-w-10 text-right text-meta text-ink-3 tabular-nums"
      >
        {query && (ranges.length ? `${current + 1}/${ranges.length}` : '0/0')}
      </span>
      <IconButton
        name="up"
        label="Previous match (⇧↩)"
        onClick={() => go(-1)}
      />
      <IconButton name="down" label="Next match (↩)" onClick={() => go(1)} />
      <IconButton name="close" label="Close find (Esc)" onClick={onClose} />
    </div>,
    scope,
  );
}

const reveal = (range: Range) =>
  range.startContainer.parentElement?.scrollIntoView({ block: 'center' });

// ponytail: matches within single text nodes only, so a query spanning
// formatting (e.g. half-bold) is missed; join adjacent text nodes if that bites.
// Textarea contents (Playbook Markdown edit mode) aren't searched; preview/split are.
export function findRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle.trim()) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      return !parent ||
        parent.closest('[data-find-bar]') ||
        !parent.checkVisibility()
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const ranges: Range[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent!.toLowerCase();
    for (
      let at = text.indexOf(needle);
      at >= 0;
      at = text.indexOf(needle, at + needle.length)
    ) {
      const range = new Range();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}
