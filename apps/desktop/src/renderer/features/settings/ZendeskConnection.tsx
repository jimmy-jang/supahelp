import { useState } from 'react';
import { Button } from '../../components/Button';
import { Select } from '../../components/controls';
import type { CatalogTool } from '../../fixtures/connections';
import { Abilities, abilitiesFrom, Card, Group, Note, Row, Tag } from './parts';
import { useZendesk } from './useZendesk';

// Zendesk's detail page body: workspace sign-in or account, then what it can read and change.
export function ZendeskConnection({ tool }: { tool: CatalogTool }) {
  const { snapshot, error, setError } = useZendesk();
  const [site, setSite] = useState<string>();
  const [access, setAccess] = useState('Read only');
  const [busy, setBusy] = useState(false);
  const connected = snapshot?.state === 'connected';
  const connecting = snapshot?.state === 'connecting';
  const connect = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await window.supahelp.connectZendesk({
        site: (site ?? snapshot?.site ?? '').trim(),
        access: access === 'Read only' ? 'read' : 'write',
      });
      if (!result.ok) setError(result.error);
    } catch {
      setError('Zendesk could not connect. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    try {
      const result = await window.supahelp.disconnectZendesk();
      if (!result.ok) setError(result.error);
    } catch {
      setError('Zendesk could not disconnect. Try again.');
    }
  };
  const inputClass =
    'h-8 w-full rounded-item bg-surface px-2.5 text-body text-ink ring-1 ring-line outline-none focus-visible:ring-2 focus-visible:ring-busy';
  return (
    <>
      <Group label="Your connection">
        <Card>
          {connected && (
            <>
              <Row
                title="Signed in"
                description={`${snapshot.site ?? ''}${snapshot.account ? ` · ${snapshot.account} (${snapshot.role})` : ''}`}
              >
                <Tag>
                  {snapshot.access === 'read' ? 'Read only' : 'Read + changes'}
                </Tag>
                <Button kind="ghost" onClick={disconnect}>
                  Disconnect Zendesk
                </Button>
              </Row>
            </>
          )}
          {connecting && (
            <Row title="Finish sign-in in your browser…">
              <Button kind="secondary" onClick={disconnect}>
                Cancel Zendesk sign-in
              </Button>
            </Row>
          )}
          {error && (
            <p role="alert" className="m-0 px-3.5 py-2 text-bad">
              {error}
            </p>
          )}
          {snapshot?.message && (
            <p role="status" className="m-0 px-3.5 py-2 text-ink-2">
              {snapshot.message}
            </p>
          )}
          {!connected && !connecting && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
              className="flex flex-col gap-3 px-3.5 py-3.5"
            >
              <label className="flex flex-col gap-1 text-meta text-ink-2">
                Zendesk workspace
                <input
                  className={inputClass}
                  aria-label="Zendesk workspace"
                  placeholder="your-team.zendesk.com"
                  autoComplete="off"
                  value={site ?? snapshot?.site ?? ''}
                  onChange={(event) => setSite(event.target.value)}
                  disabled={busy}
                />
              </label>
              <Note>
                In Zendesk, open the Products menu and select Admin Center. Find
                your subdomain on its home page and enter it as
                your-subdomain.zendesk.com. Sign in with Zendesk in your
                browser. Your agent permissions apply. Your organization may
                need to approve Supahelp’s app.
              </Note>
              <div className="flex flex-col items-start gap-3">
                <Select
                  label="Zendesk access"
                  options={['Read only', 'Read + changes']}
                  value={access}
                  onChange={setAccess}
                  disabled={busy}
                />
                <Button
                  type="submit"
                  disabled={
                    !snapshot || busy || !(site ?? snapshot?.site ?? '').trim()
                  }
                >
                  {snapshot?.state === 'error'
                    ? 'Reconnect Zendesk'
                    : 'Connect Zendesk'}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </Group>
      {connected ? (
        <Abilities
          name="Zendesk"
          reads={abilitiesFrom(snapshot.tools, true)}
          changes={abilitiesFrom(snapshot.tools, false)}
        >
          <Note>
            Your Zendesk role and ticket access still apply. Public replies can
            notify customers; internal notes stay internal.
          </Note>
          <Group label="Permissions granted">
            <span className="px-0.5 font-mono text-[11px] text-ink-3">
              {snapshot.scopes.join(', ')}
            </span>
          </Group>
        </Abilities>
      ) : (
        <Abilities
          name="Zendesk"
          reads={tool.reads.map((label) => ({ label }))}
          changes={tool.changes.map((label) => ({ label }))}
        />
      )}
    </>
  );
}
