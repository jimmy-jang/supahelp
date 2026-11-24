import { useEffect, useRef, useState, type ReactNode } from 'react';
import { parseCaseLink } from '../../../contracts/case-links';
import type { Attachment, ChatOptions } from '../../../contracts/chat';
import { Icon } from '../../components/Icon';
import { useAccount } from '../accounts/AccountProvider';
import { CASE_DRAG_TYPE, type Case, type Target } from '../cases/types';
import type { Playbook } from '../playbooks/types';
import {
  AttachedChips,
  AttachMenu,
  RepoChip,
  type AttachProps,
} from './AttachChips';
import { ChatControls } from './ChatControls';

export function Composer({
  value,
  onChange,
  onSend,
  large,
  placeholder,
  busy = false,
  disabled = false,
  onStop,
  preview = false,
  options: initialOptions,
  attach,
  menu,
  attachedCase,
  attachedPlaybooks = [],
  onOpenAttached,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (
    options: ChatOptions,
    attachments: string[],
  ) => void | Promise<boolean>;
  large?: boolean;
  placeholder: string;
  busy?: boolean;
  disabled?: boolean;
  onStop?: () => void;
  preview?: boolean;
  options?: ChatOptions;
  attach?: AttachProps;
  menu?: AttachProps;
  attachedCase?: Case;
  attachedPlaybooks?: Playbook[];
  onOpenAttached?: (t: Target) => void;
}) {
  const { snapshot: account } = useAccount();
  const [options, setOptions] = useState<ChatOptions>(
    initialOptions ?? { confirmation: 'ask' },
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const filesRef = useRef(attachments);
  filesRef.current = attachments;
  useEffect(
    () => () => {
      void window.supahelp?.discardAttachments(
        filesRef.current.map((file) => file.id),
        account.context,
      );
    },
    [],
  );
  const submit = () => {
    const ids = attachments.map((file) => file.id);
    void Promise.resolve(onSend(options, ids)).then((accepted) => {
      if (accepted !== false)
        setAttachments((current) =>
          current.filter((file) => !ids.includes(file.id)),
        );
    });
  };
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);
  const ready =
    (value.trim().length > 0 || attachments.length > 0) && !busy && !disabled;

  return (
    <div
      className="flex w-full max-w-[680px] flex-col gap-3 rounded-composer bg-surface pt-3.5 pr-3 pb-2.5 pl-4 shadow-2"
      onDragOver={(e) => {
        if (attach && e.dataTransfer.types.includes(CASE_DRAG_TYPE))
          e.preventDefault();
      }}
      onDrop={(e) => {
        const caseId = e.dataTransfer.getData(CASE_DRAG_TYPE);
        if (attach && caseId) {
          e.preventDefault();
          attach.onAttach({ caseId });
        }
      }}
    >
      {attach && (
        <AttachedChips
          {...attach}
          onOpen={onOpenAttached}
          disabled={busy || disabled}
        />
      )}
      {(attachedCase || attachedPlaybooks.length > 0) && (
        <AttachedChips
          attached={{
            caseId: attachedCase?.id,
            playbookIds: attachedPlaybooks.map((p) => p.id),
          }}
          cases={attachedCase ? [attachedCase] : []}
          playbooks={attachedPlaybooks}
          onOpen={onOpenAttached}
          onDetach={menu?.onDetach}
          disabled={busy || disabled}
        />
      )}
      {!!attachments.length && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((file) => (
            <span
              key={file.id}
              className="flex items-center gap-1 rounded-chip bg-sunk px-2 py-1 text-meta"
            >
              {file.name}
              <button
                type="button"
                disabled={busy || disabled}
                aria-label={`Remove ${file.name}`}
                onClick={() => {
                  void window.supahelp.discardAttachments(
                    [file.id],
                    account.context,
                  );
                  setAttachments((current) =>
                    current.filter((item) => item.id !== file.id),
                  );
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        autoFocus
        rows={large ? 2 : 1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const sharedId = parseCaseLink(
            e.clipboardData.getData('text').trim(),
          );
          if (sharedId) {
            e.preventDefault();
            void window.supahelp.openCaseLink({
              context: account.context,
              id: sharedId,
            });
            return;
          }
          // Example links remain confined to preview chats.
          if (!preview) return;
          const n = e.clipboardData
            .getData('text')
            .trim()
            .match(/^supahelp:\/\/case\/(\d+)$/)?.[1];
          const kase = attach?.cases.find((c) => String(c.number) === n);
          if (attach && kase) {
            e.preventDefault();
            attach.onAttach({ caseId: kase.id });
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (ready) submit();
          }
        }}
        className={`resize-none bg-transparent text-ink outline-none placeholder:text-ink-3 ${large ? 'text-[14px]' : ''}`}
      />
      <div className="flex flex-wrap items-center gap-1 text-[11.5px] text-ink-2">
        {preview ? (
          <>
            {attach && <AttachMenu {...attach} />}
            <Chip>Ask before every action</Chip>
            <RepoChip />
            <span className="flex-1" />
            <Chip>
              <Icon name="claude" size={14} />
              Claude Sonnet 5.5
            </Chip>
          </>
        ) : (
          <ChatControls
            options={options}
            onChange={setOptions}
            attachments={attachments}
            onAttachments={setAttachments}
            attach={menu ?? attach}
            disabled={busy || disabled}
          />
        )}
        <button
          type="button"
          aria-label={busy ? 'Stop reply' : 'Send'}
          disabled={busy ? !onStop : !ready}
          onClick={busy ? onStop : submit}
          className="ml-1 grid size-7 place-items-center rounded-full bg-ink text-on-ink disabled:opacity-25"
        >
          {busy ? (
            <span className="size-2.5 rounded-[2px] bg-current" />
          ) : (
            <Icon name="up" size={14} />
          )}
        </button>
      </div>
    </div>
  );
}

// Errors that a Models settings change fixes get a link there.

function Chip({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-chip px-2 py-[3px] hover:bg-hover"
    >
      {children}
      <Icon name="down" size={12} />
    </button>
  );
}
