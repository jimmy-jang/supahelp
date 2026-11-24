import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type {
  Attachment,
  ChatOptions,
  ModelsSettings,
  Project,
} from '../../../contracts/chat';
import { useAccount } from '../accounts/AccountProvider';
import { isContextChanged } from '../accounts/snapshots';
import { Icon } from '../../components/Icon';
import { AttachmentPicker, type AttachProps } from './AttachChips';

export function ChatMenu({
  label,
  children,
  disabled,
}: {
  label: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}) {
  const id = useId().replaceAll(':', '');
  const anchor = `--chat-${id}`;
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        popoverTarget={id}
        style={{ anchorName: anchor } as CSSProperties}
        className="inline-flex max-w-[230px] items-center gap-1 rounded-chip px-2 py-1 hover:bg-hover disabled:opacity-40"
      >
        {label}
        <Icon name="down" size={12} />
      </button>
      <div
        id={id}
        ref={ref}
        popover="auto"
        style={{ positionAnchor: anchor } as CSSProperties}
        className="chat-menu rounded-card bg-surface p-1.5 text-ink shadow-2 ring-1 ring-line"
        onClick={(event) => {
          if ((event.target as Element).closest('button'))
            ref.current?.hidePopover();
        }}
      >
        {children}
      </div>
    </>
  );
}
const row =
  'flex w-full items-center gap-2 rounded-item px-2 py-1.5 text-left hover:bg-hover disabled:opacity-40';

export function ChatControls({
  options,
  onChange,
  attachments,
  onAttachments,
  disabled,
  attach,
}: {
  attach?: AttachProps;
  options: ChatOptions;
  onChange: (value: ChatOptions) => void;
  attachments: Attachment[];
  onAttachments: (value: Attachment[]) => void;
  disabled: boolean;
}) {
  const { snapshot: account, isCurrent } = useAccount();
  const [settings, setSettings] = useState<ModelsSettings>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    let active = true;
    if (!window.supahelp) return;
    void Promise.all([
      window.supahelp.getModelsSettings(),
      window.supahelp.getProjects(account.context),
    ])
      .then(([models, folders]) => {
        if (!active) return;
        if (models.ok) {
          setError(undefined);
          setSettings(models.value);
          if (!options.selection) {
            const selected = models.value.models.find(
              (model) =>
                model.provider === models.value.selected.provider &&
                model.model === models.value.selected.model,
            );
            change.current({
              ...options,
              selection: models.value.selected,
              effort: selected?.efforts?.includes('medium')
                ? 'medium'
                : selected?.efforts?.[0],
            });
          }
        } else if (!isContextChanged(models.error)) setError(models.error);
        if (folders.ok) setProjects(folders.value);
      })
      .catch(() => {
        if (active) setError('Could not load chat settings.');
      });
    return () => {
      active = false;
    };
    // Main rejects reads while signing in; status flips to 'ready' without a new
    // generation, so reload on status too or the composer never gets its models.
  }, [account.context.generation, account.status]);
  const selection = options.selection ?? settings?.selected;
  const selected = settings?.models.find(
    (model) =>
      model.provider === selection?.provider && model.model === selection.model,
  );
  const chooseFiles = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await window.supahelp.chooseAttachments(account.context);
      if (!isCurrent(account.context)) return;
      if (!result.ok) setError(result.error);
      else if (attachments.length + result.value.length > 5) {
        void window.supahelp.discardAttachments(
          result.value.map((file) => file.id),
          account.context,
        );
        setError('Attach up to five files per message.');
      } else onAttachments([...attachments, ...result.value]);
    } catch {
      setError('Could not open files.');
    } finally {
      setLoading(false);
    }
  };
  const chooseProject = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await window.supahelp.chooseProject(account.context);
      if (!isCurrent(account.context)) return;
      if (!result.ok) setError(result.error);
      else if (result.value) {
        const project = result.value;
        setProjects((current) => [
          ...current.filter((item) => item.path !== project.path),
          project,
        ]);
        onChange({ ...options, project: project.path });
      }
    } catch {
      setError('Could not connect this folder.');
    } finally {
      setLoading(false);
    }
  };
  const locked = disabled || loading;
  return (
    <>
      <ChatMenu
        disabled={locked}
        label={
          <>
            <Icon name="plus" size={15} />
            <span className="sr-only">Attach files</span>
          </>
        }
      >
        <button
          type="button"
          className={row}
          onClick={() => void chooseFiles()}
        >
          <Icon name="note" />
          Upload photos &amp; files
        </button>
        {attach && <AttachmentPicker {...attach} disabled={locked} />}
      </ChatMenu>
      <ChatMenu
        disabled={locked}
        label={
          <>
            <Icon name="shield" size={13} />
            {options.confirmation === 'skip'
              ? 'Skip confirmation'
              : 'Ask first'}
          </>
        }
      >
        {(['ask', 'skip'] as const).map((value) => (
          <button
            type="button"
            key={value}
            className={row}
            onClick={() => onChange({ ...options, confirmation: value })}
          >
            {value === 'ask' ? 'Ask first' : 'Skip confirmation'}
            {(options.confirmation ?? 'ask') === value && (
              <Icon name="check" size={13} />
            )}
          </button>
        ))}
        <p className="m-1 max-w-[220px] text-meta text-ink-3">
          Applies to provider permissions. Action tools are currently disabled.
        </p>
      </ChatMenu>
      <ChatMenu
        disabled={locked}
        label={
          <>
            <Icon name="folder" size={13} />
            <span className="max-w-[110px] truncate">
              {projects.find((item) => item.path === options.project)?.name ??
                'Project'}
            </span>
          </>
        }
      >
        <div className="px-2 py-1 text-meta text-ink-3">Projects</div>
        <button
          type="button"
          className={row}
          onClick={() => void chooseProject()}
        >
          <Icon name="folder" />
          Use an existing folder
        </button>
        {projects.map((project) => (
          <button
            type="button"
            key={project.path}
            title={project.path}
            className={row}
            onClick={() => onChange({ ...options, project: project.path })}
          >
            <span className="max-w-[210px] truncate">{project.name}</span>
            {project.path === options.project && (
              <Icon name="check" size={13} />
            )}
          </button>
        ))}
        {options.project && (
          <button
            type="button"
            className={row}
            onClick={() => onChange({ ...options, project: undefined })}
          >
            No project
          </button>
        )}
      </ChatMenu>
      <span className="flex-1" />
      <ChatMenu
        disabled={locked}
        label={
          <>
            {selection && <Icon name={selection.provider} size={14} />}
            <span className="truncate">
              {selected?.label ?? selection?.model ?? 'Select model'}
            </span>
          </>
        }
      >
        <input
          aria-label="Search models"
          placeholder="Search models"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="m-1 w-[220px] rounded-item bg-sunk px-2 py-1.5 outline-none"
        />
        <div className="max-h-[270px] overflow-y-auto">
          {(['claude', 'chatgpt'] as const).map((provider) => (
            <div
              key={provider}
              className="border-t border-line pt-1 first:border-0"
            >
              <div className="flex items-center gap-2 px-2 py-1 text-meta text-ink-3">
                <Icon name={provider} size={14} />
                {provider === 'claude' ? 'Claude' : 'ChatGPT'}
              </div>
              {!settings?.models.some(
                (model) => model.provider === provider,
              ) && (
                <p className="m-0 px-2 py-1 text-meta text-ink-3">
                  Connect in Settings → Models
                </p>
              )}
              {settings?.models
                .filter(
                  (model) =>
                    model.provider === provider &&
                    model.label.toLowerCase().includes(query.toLowerCase()),
                )
                .map((model) => (
                  <button
                    type="button"
                    key={model.model}
                    className={row}
                    onClick={() =>
                      onChange({
                        ...options,
                        selection: { provider, model: model.model },
                        effort: model.efforts?.includes('medium')
                          ? 'medium'
                          : model.efforts?.[0],
                      })
                    }
                  >
                    {model.label}
                    {selection?.provider === provider &&
                      selection.model === model.model && (
                        <Icon name="check" size={13} />
                      )}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </ChatMenu>
      {!!selected?.efforts?.length && (
        <ChatMenu
          disabled={locked}
          label={
            <span className="capitalize">
              {options.effort ?? selected.efforts[0]}
            </span>
          }
        >
          {selected.efforts.map((effort) => (
            <button
              type="button"
              key={effort}
              className={`${row} capitalize`}
              onClick={() => onChange({ ...options, effort })}
            >
              {effort}
              {options.effort === effort && <Icon name="check" size={13} />}
            </button>
          ))}
        </ChatMenu>
      )}
      {error && (
        <p role="alert" className="m-0 basis-full px-2 text-bad">
          {error}
        </p>
      )}
    </>
  );
}
