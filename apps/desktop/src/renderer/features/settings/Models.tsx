import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ModelsSettings,
  ProviderId,
  ProviderStatus,
  Reply,
} from '../../../contracts/chat';
import { Button } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { Select } from '../../components/controls';
import { useAccount } from '../accounts/AccountProvider';
import {
  Card,
  CopyText,
  Group,
  Note,
  PageHeader,
  Row,
  SetupGuide,
} from './parts';

const names = { claude: 'Claude', chatgpt: 'ChatGPT' };

// Steps for a computer that has no Claude Code or Codex yet.
function installSteps(id: ProviderId, windows: boolean): ReactNode[] {
  const open = windows
    ? 'Open PowerShell.'
    : 'Open Terminal (press ⌘ Space, type Terminal).';
  const cli = id === 'claude' ? 'Claude Code' : 'Codex';
  const command =
    id === 'claude'
      ? windows
        ? 'irm https://claude.ai/install.ps1 | iex'
        : 'curl -fsSL https://claude.ai/install.sh | bash'
      : windows
        ? 'npm install -g @openai/codex'
        : 'brew install --cask codex';
  return [
    open,
    <>
      Run this command:
      <CopyText text={command} />
      {id === 'chatgpt' && (
        <span className="mt-1 block">
          {windows
            ? 'Needs Node.js from nodejs.org.'
            : 'Needs Homebrew. Without it, install Node.js and run npm install -g @openai/codex.'}
        </span>
      )}
    </>,
    'Close and reopen Supahelp once it finishes, so it can find the new program.',
    `Come back here and press Check again. If ${cli} still isn't found, choose its executable.`,
  ];
}

function ProviderMenu({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      id={id}
      popover="auto"
      className="provider-menu min-w-[190px] rounded-card bg-surface p-1.5 text-ink shadow-2 ring-1 ring-line"
      onClick={(event) => {
        if ((event.target as Element).closest('button'))
          ref.current?.hidePopover();
      }}
    >
      {children}
    </div>
  );
}

function MenuAction({
  icon,
  children,
  onClick,
  disabled,
  destructive,
}: {
  icon: IconName;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-item px-2 py-1.5 text-left hover:bg-hover disabled:opacity-40 ${destructive ? 'text-bad' : ''}`}
    >
      <Icon name={icon} size={14} />
      {children}
    </button>
  );
}

export function Models() {
  const { isCurrent } = useAccount();
  const [settings, setSettings] = useState<ModelsSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [details, setDetails] = useState<ProviderId>();
  const [authentication, setAuthentication] = useState('API key');
  const [apiKey, setApiKey] = useState('');
  const pending = useRef(false);
  useEffect(() => {
    setApiKey('');
    setAuthentication('API key');
  }, [details]);

  const check = useCallback(async () => {
    if (pending.current) return;
    if (!window.supahelp) {
      setError('Open the desktop app to connect your providers.');
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const result = await window.supahelp.getModelsSettings();
      if (result.ok && isCurrent(result.value.context)) {
        setSettings(result.value);
        setError(undefined);
      } else if (!result.ok) setError(result.error);
    } catch {
      setError('Connections could not be checked. Try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [isCurrent]);

  useEffect(() => {
    void check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [check]);

  const act = async (
    action: () => Promise<Reply<unknown>>,
    message?: string,
  ) => {
    if (pending.current || !window.supahelp) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await action();
      if (!result.ok) setError(result.error);
      else {
        setNotice(message);
        const updated = await window.supahelp.getModelsSettings();
        if (updated.ok && isCurrent(updated.value.context))
          setSettings(updated.value);
        else if (!updated.ok) setError(updated.error);
      }
    } catch {
      setError('The connection could not be updated. Try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const signIn = (id: ProviderId) =>
    void act(
      () => window.supahelp.connectProvider(id),
      id === 'chatgpt'
        ? 'Finish signing in with ChatGPT in your browser. Return here to check the connection.'
        : 'If a sign-in window opens, finish it there and return here.',
    );
  const connect = (id: ProviderId) => setDetails(id);
  const providers: ProviderStatus[] =
    settings?.providers ??
    (['claude', 'chatgpt'] as const).map((id) => ({
      id,
      state: 'signed-out',
      message: 'Checking connection…',
    }));
  const selected = settings?.models.find(
    (model) =>
      model.provider === settings.selected.provider &&
      model.model === settings.selected.model,
  );
  const choices =
    settings?.models.filter((model) =>
      settings.providers.some(
        (provider) =>
          provider.id === model.provider && provider.state === 'ready',
      ),
    ) ?? [];
  if (selected && !choices.includes(selected)) choices.unshift(selected);
  const detail = providers.find((provider) => provider.id === details);

  return (
    <>
      <PageHeader
        title="Models"
        description="Connect your own Anthropic or OpenAI account on this computer."
      />
      <Group label="Providers">
        <Card>
          {providers.map((provider) => (
            <Row
              key={provider.id}
              title={names[provider.id]}
              description={
                provider.state === 'ready'
                  ? provider.authentication === 'api-key'
                    ? 'API key · Paid API usage'
                    : 'Subscription · Provider plan usage'
                  : provider.state === 'missing'
                    ? 'Installation needed'
                    : 'Not connected'
              }
              lead={
                <span className="grid size-4 place-items-center text-ink-2">
                  <Icon name={provider.id} size={18} />
                </span>
              }
            >
              {provider.state !== 'ready' && (
                <Button
                  kind="secondary"
                  disabled={busy || !settings}
                  onClick={() => setDetails(provider.id)}
                >
                  Set up
                </Button>
              )}
              <span
                title={provider.message}
                aria-label={`${names[provider.id]}: ${provider.state === 'ready' ? 'Connected' : 'Not connected'}`}
                className={`size-2 flex-none rounded-full ${provider.state === 'ready' ? 'bg-ok' : 'ring-[1.5px] ring-ink-3'}`}
              />
              <button
                type="button"
                popoverTarget={`provider-${provider.id}`}
                disabled={busy || !settings}
                aria-label={`${names[provider.id]} options`}
                className={`provider-anchor-${provider.id} grid size-7 place-items-center rounded-item text-ink-2 hover:bg-hover disabled:opacity-40`}
              >
                <Icon name="more" />
              </button>
              <ProviderMenu id={`provider-${provider.id}`}>
                <MenuAction
                  icon="refresh"
                  disabled={busy}
                  onClick={() => connect(provider.id)}
                >
                  {provider.state === 'ready'
                    ? 'Change connection'
                    : 'Set up connection'}
                </MenuAction>
                <MenuAction
                  icon="check"
                  disabled={busy}
                  onClick={() => void check()}
                >
                  Check connection
                </MenuAction>
                <MenuAction icon="gear" onClick={() => setDetails(provider.id)}>
                  Connection details
                </MenuAction>
                {provider.state === 'ready' && (
                  <MenuAction
                    icon="out"
                    destructive
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        window.supahelp.disconnectProvider(provider.id),
                      )
                    }
                  >
                    Disconnect
                  </MenuAction>
                )}
              </ProviderMenu>
            </Row>
          ))}
          <button
            type="button"
            popoverTarget="connect-provider"
            disabled={busy || !settings}
            className="provider-anchor-connect flex min-h-[42px] items-center gap-3 px-3.5 text-left text-ink-2 hover:bg-hover disabled:opacity-40"
          >
            <Icon name="plus" size={15} />
            Connect
          </button>
          <ProviderMenu id="connect-provider">
            {providers.map((provider) => (
              <MenuAction
                key={provider.id}
                icon={provider.id}
                disabled={busy || provider.state === 'ready'}
                onClick={() => connect(provider.id)}
              >
                {names[provider.id]}
                {provider.state === 'ready' ? ' · Connected' : ''}
              </MenuAction>
            ))}
          </ProviderMenu>
        </Card>
      </Group>
      {choices.length > 0 && (
        <Group label="Task models">
          <Card>
            <Row
              title="Default model"
              description="Used for new chats. Existing chats keep their model."
            >
              <Select
                label="Model for new chats"
                options={
                  choices.length
                    ? choices.map((model) => model.label)
                    : ['Connect a provider']
                }
                value={selected?.label ?? 'Connect a provider'}
                disabled={busy}
                onChange={(label) => {
                  const model = choices.find(
                    (choice) => choice.label === label,
                  );
                  if (model)
                    void act(() =>
                      window.supahelp.setDefaultModel({
                        provider: model.provider,
                        model: model.model,
                      }),
                    );
                }}
              />
            </Row>
          </Card>
        </Group>
      )}
      {detail && (
        <Group
          label={`${names[detail.id]} connection`}
          aside={
            <button
              type="button"
              onClick={() => setDetails(undefined)}
              className="text-ink-2 hover:text-ink"
            >
              Close
            </button>
          }
        >
          <Card>
            <Row
              title="Authentication and billing"
              description="Changing the method stops active chats. No automatic billing fallback."
            >
              <Select
                label="Authentication and billing"
                options={
                  detail.id === 'claude'
                    ? ['API key', 'Claude subscription']
                    : ['API key', 'ChatGPT subscription']
                }
                value={authentication}
                onChange={(value) => {
                  setAuthentication(value);
                  setApiKey('');
                }}
                disabled={busy}
              />
            </Row>
            {authentication === 'API key' && (
              <Row
                title="Personal API key"
                description={`Billed to your ${detail.id === 'claude' ? 'Anthropic' : 'OpenAI'} API account. Stored encrypted on this computer; never synced.`}
              >
                <input
                  aria-label="Personal API key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  disabled={busy}
                  onChange={(event) => setApiKey(event.target.value)}
                  className="h-7 w-52 rounded-item bg-surface px-2.5 text-ink ring-1 ring-line focus-visible:ring-2 focus-visible:ring-busy"
                />
              </Row>
            )}
            <Row
              title={
                authentication === 'API key'
                  ? 'Paid API usage'
                  : `${names[detail.id]} subscription usage`
              }
              description={
                authentication === 'API key'
                  ? 'Chats, masking checks and document drafts incur API charges. Set usage limits with your provider. Saving a key does not verify its balance or model access.'
                  : detail.id === 'claude'
                    ? 'Claude Code manages your sign-in through Anthropic. Chats, masking checks and document drafts use your own subscription limits.'
                    : 'Native Codex subscription login is allowed for local or open-source apps. OpenAI does not permit this mechanism for commercial or hosted services.'
              }
            >
              <Button
                kind="secondary"
                disabled={busy || (authentication === 'API key' && !apiKey)}
                onClick={() => {
                  if (authentication !== 'API key') {
                    signIn(detail.id);
                    return;
                  }
                  const key = apiKey;
                  setApiKey('');
                  void act(
                    () => window.supahelp.setProviderApiKey(detail.id, key),
                    'API key saved. Usage is billed to your API account.',
                  );
                }}
              >
                {authentication === 'API key'
                  ? 'Save API key'
                  : `Continue with ${names[detail.id]}`}
              </Button>
            </Row>
            <Row
              title={detail.email ?? names[detail.id]}
              description={detail.message}
            >
              <Button
                kind="secondary"
                disabled={busy}
                onClick={() => void check()}
              >
                Check again
              </Button>
            </Row>
            {detail.plan && <Row title="Plan" description={detail.plan} />}
            <Row
              title="Disconnect"
              description="Stops active chats and removes the saved key or cancels pending Codex sign-in."
            >
              <Button
                kind="secondary"
                disabled={busy}
                onClick={() => {
                  setApiKey('');
                  void act(() => window.supahelp.disconnectProvider(detail.id));
                }}
              >
                Disconnect
              </Button>
            </Row>
            <Row
              title={detail.id === 'claude' ? 'Claude Code' : 'Codex'}
              description={detail.executable ?? 'No installation found'}
            >
              <Button
                kind="secondary"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    window.supahelp.chooseProviderExecutable(detail.id),
                  )
                }
              >
                Choose executable
              </Button>
            </Row>
            <Row
              title={
                detail.version ? `Version ${detail.version}` : 'Installation'
              }
            >
              <Button
                kind="ghost"
                disabled={busy}
                onClick={() =>
                  void act(() => window.supahelp.openProviderInstall(detail.id))
                }
              >
                Install instructions
              </Button>
            </Row>
            {detail.state === 'missing' && (
              <div className="px-3.5 py-2.5">
                <SetupGuide
                  steps={installSteps(
                    detail.id,
                    navigator.platform.startsWith('Win'),
                  )}
                />
              </div>
            )}
          </Card>
          <Note>
            Disconnect removes the saved API key or signs out the Supahelp Codex
            connection. It does not revoke a key at the provider. Cancel setup
            by closing these details.
            {detail.id === 'claude' &&
              ' Claude Code owns subscription sign-in. Disconnecting here leaves your independent Claude Code sign-in unchanged.'}
          </Note>
        </Group>
      )}
      {error && (
        <p role="alert" className="m-0 text-bad">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="m-0 text-ink-2">
          {notice}
        </p>
      )}
    </>
  );
}
