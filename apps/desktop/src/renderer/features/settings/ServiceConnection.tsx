import { useEffect, useRef, useState } from 'react';
import type { CatalogConnection } from '../../../contracts/catalog';
import { Button } from '../../components/Button';
import { Select } from '../../components/controls';
import { useAccount } from '../accounts/AccountProvider';
import { CatalogActions } from '../chat/CatalogActions';
import { CustomApiSetup, CustomApiTest } from './CustomApi';
import {
  Abilities,
  abilitiesFrom,
  Card,
  CopyText,
  Group,
  Note,
  Row,
  sentences,
  SetupGuide,
  Tag,
} from './parts';
import { useConnections } from './useConnections';

const inputClass =
  'min-h-8 w-full rounded-item bg-surface px-2.5 py-1.5 text-body text-ink ring-1 ring-line outline-none focus-visible:ring-2 focus-visible:ring-busy';
const newId = (template: string) =>
  `${template}-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
// With an own OAuth app these three matter; otherwise the defaults are used.
const advancedKeys = ['clientId', 'clientSecret', 'redirectUri'];

// `custom-mcp` / `custom-api` are add forms: connecting creates a new `<template>-<id>` connection.
export function ServiceConnection({
  id,
  onCreated,
  onRemoved,
}: {
  id: string;
  onCreated?: (id: string) => void;
  onRemoved?: () => void;
}) {
  const { snapshot, error, setError } = useConnections();
  const account = useAccount();
  const connection = snapshot?.connections.find((item) => item.id === id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [access, setAccess] = useState('Read + changes');
  const [busy, setBusy] = useState(false);
  const [returnUrl, setReturnUrl] = useState('');
  const creating = useRef<string | undefined>(undefined);
  // "Your REST API" builds its own values from the form; ready means they are complete.
  const custom = useRef<Record<string, string>>({});
  const [customBlocker, setCustomBlocker] = useState<string>();
  const isNew = id === 'custom-mcp' || id === 'custom-api';
  const isCustomApi =
    id === 'custom-api' || connection?.instanceOf === 'custom-api';
  const connected = connection?.state === 'connected';
  const connecting = connection?.state === 'connecting';
  const needsSignIn =
    connection?.requiresSupahelpAccount && !account.snapshot.view?.account;
  useEffect(() => {
    if (
      creating.current &&
      snapshot?.connections.some((item) => item.id === creating.current)
    )
      onCreated?.(creating.current);
  }, [snapshot, onCreated]);
  const run = async (
    operation: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setError(undefined);
    try {
      const reply = await operation();
      if (!reply.ok) setError(reply.error);
    } catch {
      setError('The request failed. Check the connection and action status.');
    }
  };
  const connect = async (item: CatalogConnection) => {
    setBusy(true);
    setError(undefined);
    const target = isNew ? newId(id) : id;
    if (isNew) creating.current = target;
    const setup = {
      id: target,
      access: access === 'Read only' ? ('read' as const) : ('write' as const),
      values: isCustomApi
        ? custom.current
        : Object.fromEntries(
            item.fields.map((field) => [
              field.key,
              values[field.key] ?? field.value ?? field.choices?.[0] ?? '',
            ]),
          ),
    };
    const request = window.supahelp.connectConnection(setup);
    setValues({});
    try {
      const reply = await request;
      if (!reply.ok) setError(reply.error);
      else if (isNew) onCreated?.(target);
    } catch {
      setError('This service could not connect.');
    } finally {
      setBusy(false);
    }
  };
  if (!connection) return <Note>{error || 'Loading connection setup…'}</Note>;
  const redirect = connection.fields.find(
    (field) => field.key === 'redirectUri',
  )?.value;
  const renderField = (field: CatalogConnection['fields'][number]) => (
    <label key={field.key} className="flex flex-col gap-1 text-meta text-ink-2">
      {field.label}
      {field.optional ? ' (optional)' : ''}
      {field.choices ? (
        <span className="self-start">
          <Select
            label={field.label}
            options={field.choices}
            value={values[field.key] ?? field.value ?? field.choices[0] ?? ''}
            disabled={busy}
            onChange={(value) =>
              setValues({
                ...values,
                [field.key]: value,
              })
            }
          />
        </span>
      ) : field.multiline ? (
        <textarea
          aria-label={field.label}
          className={`${inputClass} min-h-40 font-mono text-meta`}
          required={!field.optional}
          value={values[field.key] ?? field.value ?? ''}
          onChange={(event) =>
            setValues({
              ...values,
              [field.key]: event.target.value,
            })
          }
          disabled={busy}
        />
      ) : (
        <input
          aria-label={field.label}
          type={field.secret ? 'password' : 'text'}
          className={inputClass}
          autoComplete="off"
          spellCheck={false}
          required={!field.optional}
          value={values[field.key] ?? field.value ?? ''}
          onChange={(event) =>
            setValues({
              ...values,
              [field.key]: event.target.value,
            })
          }
          disabled={busy}
        />
      )}
    </label>
  );
  const manualSetup = connection.fields.some((field) =>
    [
      'key',
      'endpoint',
      'operations',
      'site',
      'orgId',
      'channels',
      'teamId',
    ].includes(field.key),
  );
  return (
    <>
      <Group label="Your connection">
        <Card>
          {(error || connection.message) && (
            <p
              role={error ? 'alert' : 'status'}
              className={`m-0 px-3.5 py-3 text-meta ${error ? 'text-bad' : 'text-ink-2'}`}
            >
              {error || connection.message}
            </p>
          )}
          {connected && (
            <Row
              title={connection.account || 'Connected'}
              description="Your provider permissions still apply. Supahelp also enforces the access shown here."
            >
              <Tag>
                {connection.access === 'read' ? 'Read only' : 'Read + changes'}
              </Tag>
              <Button
                kind="ghost"
                onClick={() =>
                  run(() => window.supahelp.disconnectConnection(id))
                }
              >
                Disconnect {connection.name}
              </Button>
            </Row>
          )}
          {connecting && (
            <>
              <Row title="Finish sign-in in your browser…">
                <Button
                  kind="secondary"
                  onClick={() =>
                    run(() => window.supahelp.disconnectConnection(id))
                  }
                >
                  Cancel sign-in
                </Button>
              </Row>
              {connection.verificationCode && (
                <Row
                  title="Enter this code on GitHub"
                  description="Approve the connection in the browser window that opened."
                >
                  <CopyText text={connection.verificationCode} />
                </Row>
              )}
              {connection.manualReturn && (
                <form
                  className="flex flex-col gap-3 px-3.5 pb-3.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = returnUrl;
                    setReturnUrl('');
                    void run(() =>
                      window.supahelp.finishConnectionSignIn(id, value),
                    );
                  }}
                >
                  <label className="flex flex-col gap-1 text-meta text-ink-2">
                    Complete return address from your browser
                    <input
                      type="password"
                      autoComplete="off"
                      className={inputClass}
                      value={returnUrl}
                      onChange={(event) => setReturnUrl(event.target.value)}
                    />
                  </label>
                  <Note>
                    Copy the full address after consent, even if the local HTTPS
                    page cannot load. Supahelp checks that this response belongs
                    to your pending sign-in.
                  </Note>
                  <Button type="submit" disabled={!returnUrl.trim()}>
                    Finish sign-in
                  </Button>
                </form>
              )}
            </>
          )}
          {!connected && !connecting && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (isCustomApi && customBlocker) setError(customBlocker);
                else if (!needsSignIn) void connect(connection);
              }}
              className="flex flex-col gap-3 px-3.5 py-3.5"
            >
              {connection.requiresSupahelpAccount && (
                <>
                  <Note>
                    This connection uses Supahelp’s authorization service. A
                    free Supahelp account is required. No paid plan is needed.
                  </Note>
                  <Note>
                    Authorization tokens pass through Supahelp during sign-in
                    and refresh and are stored encrypted on this computer.
                  </Note>
                  {needsSignIn && (
                    <>
                      {(account.error || account.snapshot.error) && (
                        <p role="alert" className="m-0 text-meta text-bad">
                          {account.error || account.snapshot.error?.message}
                        </p>
                      )}
                      <div>
                        {account.snapshot.status === 'signing-in' ? (
                          <>
                            <Note>
                              Finish signing in in your browser, then connect
                              this service.
                            </Note>
                            <Button
                              type="button"
                              kind="secondary"
                              onClick={() =>
                                void account.run(() =>
                                  window.supahelp.cancelAccountSignIn(),
                                )
                              }
                            >
                              Cancel Supahelp sign-in
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            disabled={
                              account.busy ||
                              account.snapshot.error?.code === 'not-configured'
                            }
                            onClick={() =>
                              void account.run(() =>
                                window.supahelp.signInAccount(),
                              )
                            }
                          >
                            Sign in to Supahelp
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
              {!manualSetup && <Note>{connection.instructions}</Note>}
              {manualSetup && (
                <SetupGuide
                  steps={[
                    ...sentences(connection.instructions),
                    ...(redirect
                      ? [
                          <>
                            Return address to register:
                            <CopyText text={redirect} />
                          </>,
                        ]
                      : []),
                    <button
                      type="button"
                      className="text-ink underline underline-offset-2"
                      onClick={() =>
                        run(() => window.supahelp.openConnectionGuide(id))
                      }
                    >
                      Open {connection.name}’s setup guide
                    </button>,
                  ]}
                />
              )}
              {isCustomApi ? (
                <CustomApiSetup
                  busy={busy}
                  initialName={
                    connection.instanceOf ? connection.name : undefined
                  }
                  onChange={(next, blocker) => {
                    custom.current = next;
                    setCustomBlocker(blocker);
                  }}
                />
              ) : (
                connection.fields
                  .filter((field) => !advancedKeys.includes(field.key))
                  .map(renderField)
              )}
              {connection.fields.some((field) =>
                advancedKeys.includes(field.key),
              ) && (
                <details>
                  <summary className="cursor-pointer text-meta text-ink-2">
                    Advanced: sign in with your own OAuth app
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    {connection.fields
                      .filter((field) => advancedKeys.includes(field.key))
                      .map(renderField)}
                  </div>
                </details>
              )}
              <div className="flex flex-col items-start gap-3">
                {!connection.readOnly && (
                  <Select
                    label={`${connection.name} access`}
                    options={['Read only', 'Read + changes']}
                    value={access}
                    onChange={setAccess}
                    disabled={busy}
                  />
                )}
                <Button type="submit" disabled={busy || !!needsSignIn}>
                  {connection.state === 'error'
                    ? `Reconnect ${connection.name}`
                    : `Connect ${connection.name}`}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </Group>
      {connected && (
        <Abilities
          name={connection.name}
          reads={abilitiesFrom(connection.tools, true)}
          changes={abilitiesFrom(connection.tools, false)}
        />
      )}
      {connected && connection.instanceOf === 'custom-api' && (
        <CustomApiTest key={id} id={id} tools={connection.tools} />
      )}
      {connected && id === 'custom-mcp' && (
        <Group label="Review read-only tools">
          <Card>
            <p className="m-0 px-3.5 py-3 text-meta text-ink-2">
              Review each input schema before allowing this tool to run without
              approval. A changed schema requires another review.
            </p>
            {connection.tools.map((tool) => (
              <details key={tool.name} className="px-3.5 py-2">
                <summary className="cursor-pointer font-mono text-meta">
                  {tool.name}
                </summary>
                <pre className="max-h-60 overflow-auto rounded-item bg-canvas p-3 text-meta whitespace-pre-wrap break-words">
                  {JSON.stringify(tool.inputSchema, null, 2)}
                </pre>
                <label className="flex items-center gap-2 py-2 text-meta">
                  <input
                    type="checkbox"
                    checked={tool.readOnly}
                    onChange={(event) => {
                      const reads = connection.tools
                        .filter((candidate) =>
                          candidate.name === tool.name
                            ? event.target.checked
                            : candidate.readOnly,
                        )
                        .map((candidate) => ({
                          name: candidate.name,
                          fingerprint: candidate.fingerprint,
                        }));
                      void run(() =>
                        window.supahelp.reviewConnectionReads(id, reads),
                      );
                    }}
                  />
                  I reviewed this schema and trust this tool as read only
                </label>
              </details>
            ))}
          </Card>
        </Group>
      )}
      {connection.instanceOf && (
        <Group label="Remove">
          <Card>
            <Row
              title={`Remove ${connection.name}`}
              description="Disconnects it and deletes its saved settings and action receipts from this computer."
            >
              <Button
                kind="ghost"
                onClick={async () => {
                  const reply = await window.supahelp.removeConnection(id);
                  if (reply.ok) onRemoved?.();
                  else setError(reply.error);
                }}
              >
                Remove
              </Button>
            </Row>
          </Card>
        </Group>
      )}
      <CatalogActions connectionId={id} />
    </>
  );
}
