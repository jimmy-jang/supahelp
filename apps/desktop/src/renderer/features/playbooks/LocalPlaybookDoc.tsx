import { formatDate, formatDateTime } from '../../app/formatDate';
import { useRef, useState } from 'react';
import { playbookMarkdown } from '../../../contracts/playbook-markdown';
import type { PlaybookRecord } from '../../../contracts/playbooks';
import { Button } from '../../components/Button';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { DocPanel, DocSection } from '../../components/DocPanel';
import { Icon, type IconName } from '../../components/Icon';
import { InlineTitle } from '../../components/InlineTitle';
import { Popover, menuRow } from '../../components/Popover';
import { MarkdownPreview } from './MarkdownPreview';
import { ScreenshotReview } from './ScreenshotReview';
import { usePlaybookEditor } from './usePlaybookEditor';
import type { usePlaybooks } from './usePlaybooks';

type Documents = ReturnType<typeof usePlaybooks>;
type View = 'edit' | 'split' | 'preview';
const LIMIT = 32000;
const field =
  'w-full rounded-item border border-line bg-surface p-2 text-body text-ink focus-visible:outline-2 focus-visible:outline-busy';
const iconButton =
  'no-drag grid size-7 flex-none place-items-center rounded-[7px] text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-busy';
// Insert bar snippets. Block snippets start on their own line; `back` puts the
// caret that many characters before the end of the inserted text.
const INSERTS: {
  icon: IconName;
  label: string;
  text: string;
  block?: boolean;
  back?: number;
}[] = [
  { icon: 'heading', label: 'Heading', text: '## ', block: true },
  { icon: 'list', label: 'List', text: '- ', block: true },
  { icon: 'task', label: 'Checklist', text: '- [ ] ', block: true },
  {
    icon: 'table',
    label: 'Table',
    text: '| Column | Column |\n|---|---|\n|  |  |\n',
    block: true,
  },
  {
    icon: 'code',
    label: 'Code block',
    text: '```\n\n```\n',
    block: true,
    back: 5,
  },
  { icon: 'link', label: 'Link', text: '[](https://)', back: 11 },
];
const STARTERS = [
  [
    'Problem → fix',
    '## What is this\n\n\n## How to spot it\n- \n\n## How to fix it\n1. \n',
  ],
  ['Checklist', '## Before you start\n- [ ] \n\n## Steps\n- [ ] \n'],
  ['Decision table', '| If the customer… | Then |\n|---|---|\n|  |  |\n'],
] as const;

export function LocalPlaybookDoc({
  playbook: p,
  documents,
  expanded,
  onExpand,
  onClose,
  guard,
  removed,
}: {
  playbook: PlaybookRecord;
  documents: Documents;
  expanded: boolean;
  onExpand(): void;
  onClose(): void;
  guard: React.RefObject<() => Promise<boolean>>;
  removed: boolean;
}) {
  const confirm = useConfirmation();
  const {
    saved,
    content,
    setContent,
    setTitleDraft,
    editing,
    setEditing,
    review,
    setReview,
    base,
    setBase,
    titleDirty,
    dirty,
    busy,
    conflict,
    leaveState,
    unchanged,
    save,
  } = usePlaybookEditor(p, documents, removed, guard, confirm);
  const [view, setView] = useState<View>('edit');
  const [compare, setCompare] = useState(false);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState(false);
  const source = useRef<HTMLTextAreaElement>(null);
  const sourceDisabled = busy || !!review;
  const setMarkdown = (markdown: string) => {
    setContent({ ...content, markdown });
    setNotice('');
  };
  const insert = ({ text, block, back = 0 }: (typeof INSERTS)[number]) => {
    const el = source.current;
    if (!el || el.disabled) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const before = value.slice(0, a);
    const selected = value.slice(a, b);
    const lead = block && before && !before.endsWith('\n') ? '\n' : '';
    // A link wraps the selected text and puts the caret in the URL.
    const piece =
      lead +
      (text.startsWith('[') && selected ? `[${selected}](https://)` : text);
    const next = before + piece + value.slice(b);
    if (next.length > LIMIT) return;
    setMarkdown(next);
    const caret =
      a + piece.length - (text.startsWith('[') && selected ? 1 : back);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };
  const addScreenshot = () =>
    void documents
      .run('choosePlaybookScreenshot', { id: p.id })
      .then((shot) => {
        if (shot) setReview({ shot });
      });
  const publish = () =>
    void documents.run('publishPlaybook', { id: p.id, version: p.version });
  const discard = async () => {
    const state = leaveState.current;
    if (
      (await confirm({
        title: 'Discard this Playbook draft?',
        description:
          'The saved draft and any unsaved edits will be discarded. The published version, if any, will stay as it is.',
        action: 'Discard draft',
        danger: true,
      })) &&
      unchanged(state)
    )
      void documents
        .run('discardPlaybookDraft', { id: p.id, version: p.version })
        .then((discarded) => {
          if (discarded) {
            const next = p.published ?? saved;
            setContent(next);
            setBase({ version: p.version, content: next });
            setEditing(false);
          }
        });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(playbookMarkdown(content));
      setNotice('Markdown copied.');
    } catch {
      setNotice('Markdown could not be copied. Try again.');
    }
  };
  const exportFile = () =>
    void documents
      .run('exportPlaybook', { id: p.id, version: base.version })
      .then((done) => {
        if (done) setNotice('Playbook exported.');
      });

  // Side by side only fits when expanded; the side panel falls back to Edit.
  const mode: View = !editing
    ? 'preview'
    : view === 'split' && !expanded
      ? 'edit'
      : view;
  const canScreenshot = !(busy || dirty || conflict || !!review || !p.draft);
  const canPublish = !(
    busy ||
    dirty ||
    conflict ||
    !!review ||
    !p.draft ||
    !content.markdown.trim()
  );
  const canSave = !(
    busy ||
    !!review ||
    conflict ||
    !content.title.trim() ||
    !dirty
  );

  const header = (
    <>
      <Icon name="book" />
      <b className="font-medium">Playbook</b>
      {p.draft ? (
        <Tag tone="draft">Draft</Tag>
      ) : p.published ? (
        <Tag tone="published">Published</Tag>
      ) : null}
      {(p.workspaceId === 'personal' || p.draft) && (
        <span
          className="inline-flex items-center gap-1 text-label whitespace-nowrap text-ink-3"
          title={
            p.workspaceId === 'personal'
              ? 'Personal Playbook. Nothing syncs.'
              : 'Drafts stay private on this computer.'
          }
        >
          <Icon name="lock" size={11} />
          {p.workspaceId === 'personal' ? 'On this computer' : 'Private draft'}
        </span>
      )}
    </>
  );

  const actions = (
    <>
      {editing ? (
        <div
          role="group"
          aria-label="Document view"
          className="no-drag mr-1 inline-flex rounded-item bg-sunk p-0.5"
        >
          {(
            [
              ['edit', 'Edit'],
              ...(expanded ? ([['split', 'Side by side']] as const) : []),
              ['preview', 'Preview'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              disabled={busy || !!review}
              onClick={() => setView(key)}
              className={`h-6 rounded-[6px] px-2.5 text-meta whitespace-nowrap focus-visible:outline-2 focus-visible:outline-busy ${mode === key ? 'bg-surface font-medium text-ink shadow-1' : 'text-ink-2 hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : (
        <span className="mr-1">
          <Button
            kind="secondary"
            disabled={busy || conflict || titleDirty}
            onClick={() => {
              setTitleDraft(undefined);
              setEditing(true);
            }}
          >
            <Icon name="edit" size={13} />
            Edit
          </Button>
        </span>
      )}
      <Popover
        label={<Icon name="more" />}
        title="More"
        buttonClass="grid size-7 flex-none place-items-center rounded-[7px] text-ink-2 hover:bg-hover hover:text-ink"
        area="bottom span-left"
        className="w-[236px]"
      >
        <button
          type="button"
          className={menuRow}
          disabled={busy || !!review}
          onClick={() => void copy()}
        >
          <Icon name="copy" size={15} />
          Copy Markdown
        </button>
        <button
          type="button"
          className={`${menuRow} disabled:text-ink-3`}
          disabled={busy || dirty || conflict || !!review}
          title={dirty ? 'Save the draft first' : undefined}
          onClick={exportFile}
        >
          <Icon name="download" size={15} />
          Export .md
        </button>
        <div className="mx-1 my-1 h-px bg-line" />
        <button
          type="button"
          className={menuRow}
          aria-pressed={history}
          onClick={() => setHistory(!history)}
        >
          <Icon name="history" size={15} />
          {history ? 'Hide version history' : 'Version history'}
        </button>
        {editing && p.draft && (
          <>
            <div className="mx-1 my-1 h-px bg-line" />
            <button
              type="button"
              className={`${menuRow} text-bad disabled:opacity-45`}
              disabled={busy || !!review || conflict}
              onClick={() => void discard()}
            >
              <Icon name="trash" size={15} />
              Discard draft
            </button>
          </>
        )}
      </Popover>
    </>
  );

  const sourceArea = (extra = '') => (
    <textarea
      ref={source}
      aria-label="Playbook Markdown"
      className={`min-h-[360px] w-full flex-1 resize-none bg-transparent py-3.5 font-mono text-[12.5px] leading-[1.75] text-ink outline-none placeholder:font-sans placeholder:text-body placeholder:text-ink-3 disabled:opacity-60 ${extra}`}
      maxLength={LIMIT}
      disabled={sourceDisabled}
      spellCheck={false}
      placeholder="Write steps, paste Markdown, or start from a shape below."
      value={content.markdown}
      onChange={(e) => setMarkdown(e.target.value)}
    />
  );

  const insertBar = (
    <div
      role="toolbar"
      aria-label="Insert"
      className="sticky top-0 z-[1] -mx-1 flex items-center gap-0.5 border-b border-line bg-surface py-1.5"
    >
      {INSERTS.map((item) => (
        <button
          key={item.label}
          type="button"
          title={item.label}
          aria-label={`Insert ${item.label.toLowerCase()}`}
          disabled={sourceDisabled || mode === 'preview'}
          onClick={() => insert(item)}
          className={iconButton}
        >
          <Icon name={item.icon} size={15} />
        </button>
      ))}
      <span className="mx-1.5 h-4 w-px bg-line" />
      <button
        type="button"
        disabled={!canScreenshot}
        title={
          canScreenshot
            ? 'Add a reviewed screenshot'
            : dirty
              ? 'Save the draft first'
              : undefined
        }
        onClick={addScreenshot}
        className="no-drag inline-flex h-7 items-center gap-1.5 rounded-item px-2 text-meta text-ink-2 hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-busy"
      >
        <Icon name="img" size={15} />
        Screenshot
      </button>
      <span className="ml-auto inline-flex items-center gap-1 text-label text-ink-3">
        <Icon name="md" size={14} />
        Markdown
      </span>
    </div>
  );

  const conflictBanner = conflict && (
    <div
      role="alert"
      className="mt-1 mb-3 flex items-start gap-2.5 rounded-item bg-sunk px-3 py-2.5 text-[12.5px]"
    >
      <span className="mt-px text-ink-2">
        <Icon name="alert" size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 mb-2">
          <b className="font-medium">
            {removed
              ? 'This Playbook was removed.'
              : 'This Playbook was saved somewhere else.'}
          </b>{' '}
          Your unsaved edits are still below.
        </p>
        {!removed && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              kind="secondary"
              aria-expanded={compare}
              onClick={() => setCompare(!compare)}
            >
              {compare ? 'Hide newer version' : 'Compare'}
            </Button>
            <Button
              kind="ghost"
              disabled={busy}
              onClick={() => {
                setContent(saved);
                setBase({ version: p.version, content: saved });
                setEditing(!!p.draft);
                setCompare(false);
              }}
            >
              Load the newer version
            </Button>
          </div>
        )}
        {!removed && compare && (
          <div className="mt-2 rounded-item bg-surface px-3 py-2">
            <p className="m-0 mb-1 font-medium">{saved.title}</p>
            <MarkdownPreview book={p.id} markdown={saved.markdown} />
          </div>
        )}
      </div>
    </div>
  );

  const meta = (
    <p className="m-0 mt-0.5 mb-3 text-meta text-ink-3">
      You ·{' '}
      {p.publishedAt
        ? `Published ${formatDate(p.publishedAt)}`
        : 'Not published'}{' '}
      ·{' '}
      {p.published
        ? 'Published text can be attached to chats'
        : 'Only published text can be attached to chats'}
    </p>
  );

  const status = busy ? (
    <span
      role="status"
      className="flex items-center gap-1.5 text-meta text-ink-2"
    >
      Working…
      <button
        type="button"
        className="rounded-[5px] px-1 text-ink hover:bg-hover"
        onClick={documents.cancel}
      >
        Cancel
      </button>
    </span>
  ) : notice ? (
    <span role="status" className="text-meta text-ink-2">
      {notice}
    </span>
  ) : editing ? (
    <span className="flex items-center gap-1.5 text-meta whitespace-nowrap text-ink-2">
      <span
        className={`size-1.5 rounded-full ${dirty ? 'bg-ink' : 'bg-ink-3'}`}
      />
      {dirty ? 'Unsaved changes' : p.draft ? 'Draft saved' : 'Not saved'}
    </span>
  ) : null;

  const footer =
    editing || status || documents.error ? (
      <>
        {documents.error && (
          <p role="alert" className="m-0 px-7 pt-2 text-meta text-bad">
            {documents.error}
          </p>
        )}
        <div className="flex h-[52px] items-center gap-2 pr-3 pl-7">
          {status}
          {editing && (
            <span className="font-mono text-[11px] text-ink-3 tabular-nums">
              {content.markdown.length.toLocaleString()} / 32,000
            </span>
          )}
          <span className="flex-1" />
          {editing && (
            <>
              <Button
                kind={dirty ? 'primary' : 'secondary'}
                disabled={!canSave}
                onClick={() => void save()}
              >
                Save draft
              </Button>
              <Button
                kind={dirty ? 'secondary' : 'primary'}
                disabled={!canPublish}
                onClick={publish}
              >
                Publish
              </Button>
            </>
          )}
        </div>
      </>
    ) : undefined;

  return (
    <DocPanel
      label={`Playbook: ${saved.title}`}
      expanded={expanded}
      onExpand={onExpand}
      onClose={onClose}
      header={header}
      actions={actions}
      footer={footer}
      fill={editing && mode !== 'preview'}
      wide={mode === 'split'}
    >
      {conflictBanner}
      <h1 className="m-0 text-heading leading-[1.3] font-semibold tracking-[-0.01em]">
        {editing ? (
          <input
            aria-label="Playbook title"
            className={`${field} font-semibold`}
            maxLength={120}
            disabled={busy || !!review}
            value={content.title}
            onChange={(e) => setContent({ ...content, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                if (canSave)
                  void save({ ...content, title: content.title.trim() });
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setContent({ ...content, title: base.content.title });
              }
            }}
          />
        ) : (
          <InlineTitle
            label="Playbook title"
            value={content.title}
            disabled={busy || !!review || conflict}
            onDraftChange={setTitleDraft}
            onSave={async (title) => {
              const savedTitle = await save({ ...content, title });
              if (savedTitle === undefined)
                throw Error(
                  'The title could not be saved. Your edits are kept.',
                );
              return savedTitle;
            }}
          />
        )}
      </h1>
      {meta}
      {editing && mode !== 'preview' && insertBar}
      {editing && mode === 'edit' && !content.markdown && (
        <div className="flex flex-wrap items-center gap-2 pt-3">
          <span className="text-meta text-ink-3">Start from</span>
          {STARTERS.map(([label, text]) => (
            <button
              key={label}
              type="button"
              disabled={sourceDisabled}
              onClick={() => {
                setMarkdown(text);
                requestAnimationFrame(() => source.current?.focus());
              }}
              className="rounded-full bg-surface px-2.5 py-1 text-meta text-ink-2 shadow-1 hover:text-ink disabled:opacity-45"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {mode === 'edit' && sourceArea()}
      {mode === 'split' && (
        <div className="-mx-7 grid min-h-0 flex-1 grid-cols-2">
          <div className="flex min-w-0 flex-col px-7">
            <p className="m-0 pt-2.5 text-label text-ink-3">Markdown</p>
            {sourceArea('pt-1.5')}
          </div>
          <div className="min-w-0 border-l border-line px-7 pb-8">
            <p className="m-0 pt-2.5 pb-1.5 text-label text-ink-3">Preview</p>
            {content.markdown ? (
              <MarkdownPreview book={p.id} markdown={content.markdown} />
            ) : (
              <p className="text-ink-3">Nothing to preview yet.</p>
            )}
          </div>
        </div>
      )}
      {mode === 'preview' &&
        (content.markdown ? (
          <div className="pt-1">
            <MarkdownPreview book={p.id} markdown={content.markdown} />
          </div>
        ) : (
          <p className="py-8 text-body text-ink-3">
            This Playbook is empty.
            {editing ? ' Switch to Edit to start writing.' : ''}
          </p>
        ))}
      {history && (
        <DocSection title="Published history">
          {p.history?.length ? (
            p.history.map((h) => (
              <details key={h.at}>
                <summary>
                  {formatDateTime(h.at)} · {h.content.title}
                </summary>
                <MarkdownPreview book={p.id} markdown={h.content.markdown} />
              </details>
            ))
          ) : (
            <p>No earlier published version.</p>
          )}
        </DocSection>
      )}
      {review && (
        <ScreenshotReview
          shot={review.shot}
          busy={busy}
          onConfirm={() =>
            void documents
              .run('confirmPlaybookScreenshot', {
                id: p.id,
                version: p.version,
                screenshotId: review.shot.id,
              })
              .then((p) => {
                if (p) setReview(undefined);
              })
          }
          onCancel={() =>
            void documents
              .run('removePlaybookScreenshot', {
                id: p.id,
                version: p.version,
                screenshotId: review.shot.id,
              })
              .then(() => setReview(undefined))
          }
        />
      )}
    </DocPanel>
  );
}

function Tag({
  tone,
  children,
}: {
  tone: 'draft' | 'published';
  children: string;
}) {
  return (
    <span
      className={`inline-flex flex-none items-center gap-1.5 rounded-full py-px pr-2 pl-1.5 text-[11px] font-medium whitespace-nowrap ${tone === 'published' ? 'bg-ok-soft text-ok' : 'bg-sunk text-ink-2'}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
