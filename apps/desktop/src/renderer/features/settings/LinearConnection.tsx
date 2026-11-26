import { useState } from 'react';
import { Button } from '../../components/Button';
import { Select } from '../../components/controls';
import type { CatalogTool } from '../../fixtures/connections';
import { Abilities, abilitiesFrom, Card, Group, Note, Row, Tag } from './parts';
import { useLinear } from './useLinear';

// Linear's detail page body: sign-in or account, then what it can read and change.
export function LinearConnection({ tool }: { tool: CatalogTool }) {
  const { snapshot, error, setError } = useLinear();
  const [access, setAccess] = useState('Read only');
  const [busy, setBusy] = useState(false);
  const connected = snapshot?.state === 'connected';
  const connecting = snapshot?.state === 'connecting';
  const connect = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await window.supahelp.connectLinear(
        access === 'Read only' ? 'read' : 'write',
      );
      if (!result.ok) setError(result.error);
    } catch {
      setError('Linear could not connect. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setError(undefined);
    try {
      const result = await window.supahelp.disconnectLinear();
      if (!result.ok) setError(result.error);
    } catch {
      setError('Linear could not disconnect. Try again.');
    }
  };
  return (
    <>
      {error && (
        <p role="alert" className="m-0 text-bad">
          {error}
        </p>
      )}
      <Group label="Your connection">
        <Card>
          {connected && (
            <Row
              title="Signed in"
              description={snapshot.account ?? 'Your Linear account'}
            >
              <Tag>
                {snapshot.access === 'read' ? 'Read only' : 'Read + changes'}
              </Tag>
              <Button kind="ghost" onClick={disconnect}>
                Disconnect Linear
              </Button>
            </Row>
          )}
          {connecting && (
            <Row title="Finish sign-in in your browser…">
              <Button kind="secondary" onClick={disconnect}>
                Cancel sign-in
              </Button>
            </Row>
          )}
          {!connected && !connecting && (
            <>
              <Row
                title={
                  snapshot?.state === 'error'
                    ? 'Sign in again to keep using Linear'
                    : 'Sign in with Linear'
                }
                description="Opens Linear in your browser. Choose the workspace there."
              >
                <Button disabled={!snapshot || busy} onClick={connect}>
                  {snapshot?.state === 'error'
                    ? 'Reconnect Linear'
                    : 'Connect Linear'}
                </Button>
              </Row>
              <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <Select
                  label="Linear access"
                  options={['Read only', 'Read + changes']}
                  value={access}
                  onChange={setAccess}
                  disabled={busy}
                />
                <span className="text-meta text-ink-3">
                  Changes always ask you first.
                </span>
              </div>
            </>
          )}
          {snapshot?.message && (
            <p role="status" className="m-0 px-3.5 py-3 text-meta text-ink-2">
              {snapshot.message}
            </p>
          )}
        </Card>
      </Group>
      {connected ? (
        <Abilities
          name="Linear"
          reads={abilitiesFrom(snapshot.tools, true)}
          changes={abilitiesFrom(snapshot.tools, false)}
        >
          <Note>
            Access follows the Linear account and workspace you authorized.
            Private teams and admin restrictions still apply. To change access
            or workspace, disconnect and connect again.
          </Note>
        </Abilities>
      ) : (
        <Abilities
          name="Linear"
          reads={tool.reads.map((label) => ({ label }))}
          changes={tool.changes.map((label) => ({ label }))}
        />
      )}
    </>
  );
}
