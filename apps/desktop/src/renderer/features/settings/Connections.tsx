import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import {
  connectionCatalog,
  connectionGroups,
  type CatalogTool,
} from '../../fixtures/connections';
import { useAccount } from '../accounts/AccountProvider';
import { pickedTools } from '../onboarding/options';
import { LinearConnection } from './LinearConnection';
import { Card, More, Note, PageHeader, Pill, Tag, ToolTile } from './parts';
import { ServiceConnection } from './ServiceConnection';
import { useConnections } from './useConnections';
import { useLinear } from './useLinear';
import { useZendesk } from './useZendesk';
import { ZendeskConnection } from './ZendeskConnection';

type Status = 'connected' | 'reconnect' | 'connecting' | 'off';
const SHOW_FIRST = 6;

// Settings › Connections: your tools first; the full catalog opens from Add connection.
export function Connections() {
  const linear = useLinear().snapshot?.state;
  const zendeskSnapshot = useZendesk().snapshot;
  const zendesk = zendeskSnapshot?.state;
  const catalog = useConnections().snapshot;
  const [openId, setOpenId] = useState<string>();
  // Kept here so Back from a tool returns to the catalog when it was opened there.
  const [adding, setAdding] = useState(false);
  const live: Record<string, string | undefined> = {
    ...Object.fromEntries(
      catalog?.connections.map((item) => [item.id, item.state]) ?? [],
    ),
    linear,
    zendesk,
  };
  const statusOf = (id: string): Status => {
    const state = live[id];
    if (state === 'connected') return 'connected';
    if (state === 'error') return 'reconnect';
    if (state === 'connecting') return 'connecting';
    return 'off';
  };
  const unavailable = new Set(
    catalog?.connections.filter((c) => c.unavailable).map((c) => c.id),
  );
  if (zendeskSnapshot && !zendeskSnapshot.clientId) unavailable.add('zendesk');
  const blocked = (id: string) => {
    if (statusOf(id) !== 'off') return;
    if (!catalog) return 'Checking availability…';
    if (catalog.pendingReview?.includes(id)) return 'Pending provider review';
    if (unavailable.has(id)) return 'Unavailable in this build';
  };
  // The user's own MCP servers and APIs: one entry each, shaped like a catalog tool.
  const own: CatalogTool[] = (catalog?.connections ?? []).flatMap((c) => {
    const template = connectionCatalog.find((tool) => tool.id === c.instanceOf);
    if (!template) return [];
    const host = c.fields.find((f) => f.key === 'endpoint')?.value;
    return [
      {
        ...template,
        id: c.id,
        abbr: c.name.slice(0, 2).toUpperCase(),
        name: c.name,
        summary: host
          ? host.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '')
          : template.summary,
        madeBy: 'you',
      },
    ];
  });
  const open = [...connectionCatalog, ...own].find(
    (tool) => tool.id === openId,
  );
  return open ? (
    <ConnectionDetail
      tool={open}
      status={statusOf(open.id)}
      onBack={() => setOpenId(undefined)}
      onCreated={setOpenId}
    />
  ) : (
    <ConnectionBrowser
      own={own}
      statusOf={statusOf}
      blocked={blocked}
      onOpen={setOpenId}
      adding={adding}
      setAdding={setAdding}
    />
  );
}

function ConnectionBrowser({
  own,
  statusOf,
  blocked,
  onOpen,
  adding,
  setAdding,
}: {
  own: CatalogTool[];
  statusOf: (id: string) => Status;
  blocked: (id: string) => string | undefined;
  onOpen: (id: string) => void;
  adding: boolean;
  setAdding: (adding: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const matches = (tool: CatalogTool) => {
    const g = connectionGroups.find((x) => x.id === tool.group)!;
    return `${tool.name} ${tool.summary} ${tool.madeBy} ${g.title} ${tool.reads.join(' ')} ${tool.changes.join(' ')}`
      .toLowerCase()
      .includes(q);
  };
  const found = connectionCatalog.filter(
    (tool) => (group === 'all' || tool.group === group) && matches(tool),
  );
  const mine = [
    ...connectionCatalog.filter((tool) => statusOf(tool.id) !== 'off'),
    ...own,
  ].sort(
    (a, b) =>
      Number(statusOf(b.id) === 'reconnect') -
      Number(statusOf(a.id) === 'reconnect'),
  );
  // Tools picked during onboarding that are not connected yet.
  const answers = useAccount().snapshot.view?.onboarding;
  const picked = (answers ? pickedTools(answers) : []).flatMap((id) => {
    const tool =
      statusOf(id) === 'off' && connectionCatalog.find((t) => t.id === id);
    return tool ? [tool] : [];
  });
  // Nothing of yours yet: the catalog is the page.
  const browsing = adding || !(mine.length || picked.length);
  const fold = browsing && group === 'all' && !q;
  const sections = browsing
    ? connectionGroups.map((g) => ({
        ...g,
        hint: '',
        tools: found.filter((tool) => tool.group === g.id),
      }))
    : [
        ...(picked.length
          ? [
              {
                id: 'setup',
                title: 'From your setup',
                hint: 'Tools you said you use',
                tools: picked,
              },
            ]
          : []),
        ...(mine.length
          ? [{ id: 'mine', title: 'Connected', hint: '', tools: mine }]
          : []),
      ];
  const shown = sections.filter((s) => s.tools.length);

  return (
    <>
      <PageHeader
        title="Connections"
        description="Manage your connections. Only you can use them, in any workspace."
        action={
          adding ? (
            <Button kind="secondary" onClick={() => setAdding(false)}>
              Done
            </Button>
          ) : (
            !browsing && (
              <Button kind="secondary" onClick={() => setAdding(true)}>
                <Icon name="plus" size={14} />
                Add connection
              </Button>
            )
          )
        }
      />
      {browsing && (
        <div className="flex flex-col gap-3">
          <label className="flex h-[34px] items-center gap-2 rounded-item bg-field px-2.5 text-ink-3">
            <Icon name="search" size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools or what they do, like “refund”"
              aria-label="Search connections"
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
            />
          </label>
          <div
            role="group"
            aria-label="Show one group"
            className="flex flex-wrap gap-1.5"
          >
            {[
              { id: 'all', title: 'All' },
              ...connectionGroups.filter((g) =>
                connectionCatalog.some((tool) => tool.group === g.id),
              ),
            ].map((g) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={group === g.id}
                onClick={() => setGroup(g.id)}
                className={`rounded-chip px-2.5 py-0.5 text-meta ${group === g.id ? 'bg-ink text-on-ink' : 'bg-sunk text-ink-2 hover:text-ink'}`}
              >
                {g.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {shown.map((s) => {
        const reconnect = s.tools.filter(
          (tool) => statusOf(tool.id) === 'reconnect',
        ).length;
        const folded = fold && s.tools.length > SHOW_FIRST && !expanded[s.id];
        return (
          <section key={s.id} className="flex flex-col gap-2">
            <h2 className="m-0 flex items-baseline gap-1.5 px-0.5 text-meta font-normal text-ink-3">
              <span className="font-medium text-ink-2">{s.title}</span>
              <span className="text-[11px]">{s.tools.length}</span>
              {s.hint && <span className="text-[11px]">· {s.hint}</span>}
              {reconnect > 0 && (
                <span className="text-[11px] text-attn">
                  · {reconnect} need{reconnect === 1 ? 's' : ''} reconnecting
                </span>
              )}
              <span className="flex-1" />
              {folded && (
                <button
                  type="button"
                  onClick={() => setExpanded({ ...expanded, [s.id]: true })}
                  className="text-meta text-ink-2 hover:text-ink"
                >
                  Show all {s.tools.length} →
                </button>
              )}
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {(folded ? s.tools.slice(0, SHOW_FIRST) : s.tools).map((tool) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  status={statusOf(tool.id)}
                  blocked={blocked(tool.id)}
                  onOpen={() => onOpen(tool.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
      {browsing && !shown.length && (
        <div className="rounded-card bg-sunk p-7 text-center text-ink-2">
          No tool matches “{query.trim()}”. Try another name or group.
        </div>
      )}
    </>
  );
}

function StatusMark({ status }: { status: Status }) {
  if (status === 'connected') return <Pill tone="ok">Connected</Pill>;
  if (status === 'reconnect') return <Pill tone="attn">Reconnect</Pill>;
  if (status === 'connecting') return <Tag>Connecting…</Tag>;
  return (
    <span className="grid size-[26px] place-items-center rounded-[7px] bg-surface text-ink-2 shadow-1">
      <Icon name="plus" size={14} />
    </span>
  );
}

function ToolCard({
  tool,
  status,
  blocked,
  onOpen,
}: {
  tool: CatalogTool;
  status: Status;
  blocked?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-tool={tool.id}
      disabled={!!blocked}
      onClick={onOpen}
      className="flex items-start gap-3 rounded-card bg-sunk p-3 text-left enabled:hover:ring-1 enabled:hover:ring-line disabled:cursor-not-allowed disabled:text-ink-3"
    >
      <span className={blocked ? 'opacity-50 grayscale' : undefined}>
        <ToolTile
          id={tool.id}
          abbr={tool.abbr}
          needsYou={status === 'reconnect'}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{tool.name}</span>
        <span className="line-clamp-2 text-meta text-ink-2">
          {tool.summary}
        </span>
        <span className="block text-[11.5px] text-ink-3">
          {blocked ?? `by ${tool.madeBy}`}
        </span>
      </span>
      {!blocked && <StatusMark status={status} />}
    </button>
  );
}

function ConnectionDetail({
  tool,
  status,
  onBack,
  onCreated,
}: {
  tool: CatalogTool;
  status: Status;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    back.current?.closest('[data-settings-scroll]')?.scrollTo({ top: 0 });
    back.current?.focus({ preventScroll: true });
  }, [tool.id]);
  const group = connectionGroups.find((g) => g.id === tool.group)!;
  return (
    <>
      <button
        ref={back}
        type="button"
        onClick={onBack}
        className="-mb-2 inline-flex items-center gap-1 self-start rounded-chip text-ink-2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-busy"
      >
        <Icon name="back" size={14} />
        All connections
      </button>
      <div className="flex items-center gap-3.5 border-b border-line pb-[22px]">
        <ToolTile
          id={tool.id}
          abbr={tool.abbr}
          large
          needsYou={status === 'reconnect'}
        />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 flex items-center gap-2 text-heading font-semibold tracking-[-0.01em]">
            {tool.name}
            {status === 'connected' && <Pill tone="ok">Connected</Pill>}
            {status === 'reconnect' && (
              <Pill tone="attn">Needs reconnecting</Pill>
            )}
          </h1>
          <p className="mt-0.5 mb-0 text-ink-2">{tool.summary}</p>
        </div>
      </div>
      {tool.id === 'linear' ? (
        <LinearConnection tool={tool} />
      ) : tool.id === 'zendesk' ? (
        <ZendeskConnection tool={tool} />
      ) : (
        <ServiceConnection
          key={tool.id}
          id={tool.id}
          onCreated={onCreated}
          onRemoved={onBack}
        />
      )}
      <More label="About this connection">
        <Card>
          {[
            ['Made by', tool.madeBy],
            ['Group', group.title],
            ['How it connects', tool.connectsWith],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex min-h-[42px] items-center gap-3 px-3.5 py-2"
            >
              <span className="w-[150px] flex-none text-ink-3">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </Card>
        <Note>
          Your sign-in is saved encrypted on this computer. Disconnecting
          removes saved credentials and stops new tool calls. Submitted changes
          may still finish in {tool.name}.
        </Note>
      </More>
    </>
  );
}
