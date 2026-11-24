import { useEffect, useState } from 'react';
import type {
  ApiOperationDraft,
  CatalogConnection,
} from '../../../contracts/catalog';
import { Button } from '../../components/Button';
import { Select } from '../../components/controls';
import {
  authKinds,
  blankRow,
  credential,
  type EndpointRow,
  MAX_OPERATIONS,
  MAX_OPERATIONS_JSON,
  operationsJson,
  rowsToOperations,
} from './customApiModel';
import { Card, Group, Note } from './parts';

const inputClass =
  'min-h-8 w-full rounded-item bg-surface px-2.5 py-1.5 text-body text-ink ring-1 ring-line outline-none focus-visible:ring-2 focus-visible:ring-busy';
const labelClass = 'flex flex-col gap-1 text-meta text-ink-2';
const sources = ['Import an OpenAPI spec', 'Add endpoints by hand'];
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const secretLabel: Record<string, string> = {
  'No authentication': '',
  'Bearer token': 'Token',
  'API key header': 'API key',
  'Basic auth': 'Username:password',
};

type Candidate = ApiOperationDraft & { on: boolean };

// The setup fields for "Your REST API". Reports the saved values (the same fields as always) and whether they are complete.
export function CustomApiSetup({
  busy,
  initialName,
  onChange,
}: {
  busy: boolean;
  initialName?: string;
  onChange: (values: Record<string, string>, blocker?: string) => void;
}) {
  const [name, setName] = useState(initialName ?? '');
  const [endpoint, setEndpoint] = useState('');
  const [auth, setAuth] = useState(authKinds[0]!);
  const [secret, setSecret] = useState('');
  const [headerName, setHeaderName] = useState('X-API-Key');
  const [source, setSource] = useState(sources[0]!);
  const [specUrl, setSpecUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [found, setFound] = useState<{
    title?: string;
    skipped: string[];
  }>();
  const [imported, setImported] = useState<Candidate[]>([]);
  const [rows, setRows] = useState<EndpointRow[]>([blankRow()]);
  const [raw, setRaw] = useState<string>();

  const manual = source === sources[1];
  const hand = rowsToOperations(rows);
  const chosen = manual ? hand.operations : imported.filter((op) => op.on);
  // Advanced: the JSON the form generates, editable. Once edited it replaces the endpoint list.
  const edited = manual && raw !== undefined;
  const json = edited ? raw : operationsJson(chosen);
  let count = chosen.length;
  let jsonError: string | undefined;
  if (edited)
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) count = value.length;
      else jsonError = 'Operations must be a JSON list.';
    } catch {
      jsonError = 'The JSON is not valid.';
    }
  const problem = manual
    ? edited
      ? jsonError
      : hand.error
    : chosen.length > MAX_OPERATIONS
      ? `Allow at most ${MAX_OPERATIONS} operations.`
      : undefined;
  const sizeError =
    json.length > MAX_OPERATIONS_JSON
      ? 'These operations are too large to save. Allow fewer.'
      : undefined;
  // Why Connect cannot go ahead yet, in the words shown to the user.
  const blocker =
    problem ??
    sizeError ??
    (count > MAX_OPERATIONS
      ? `Allow at most ${MAX_OPERATIONS} operations.`
      : count === 0
        ? manual
          ? 'Add at least one endpoint: fill in a path such as /customers.'
          : imported.length
            ? 'Tick at least one operation under “Allow”.'
            : 'Import a spec first, or switch to “Add endpoints by hand”.'
        : undefined);
  const none = auth === authKinds[0];
  const { header, key } = credential(auth, secret, headerName);

  useEffect(
    () =>
      onChange(
        { name, endpoint: endpoint.trim(), header, key, operations: json },
        blocker,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, endpoint, header, key, json, blocker],
  );

  const load = async (spec: { url?: string; text?: string }) => {
    setImporting(true);
    setImportError('');
    try {
      const reply = await window.supahelp.previewApiSpec({
        endpoint: endpoint.trim(),
        ...(secret.trim() ? { header, key } : {}),
        ...spec,
      });
      if (!reply.ok) {
        setImportError(reply.error ?? 'The spec could not be read.');
        return;
      }
      const { operations, skipped, title } = reply.value;
      let allowed = 0;
      setImported(
        operations.map((op) => ({
          ...op,
          on: op.readOnly && allowed++ < MAX_OPERATIONS,
        })),
      );
      setFound({ title, skipped });
      if (!operations.length)
        setImportError('No operations in this spec can be used here.');
    } catch {
      setImportError('The spec could not be read.');
    } finally {
      setImporting(false);
    }
  };
  const update = (index: number, patch: Partial<EndpointRow>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <>
      <label className={labelClass}>
        Name
        <input
          aria-label="Name"
          className={inputClass}
          autoComplete="off"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
      </label>
      <label className={labelClass}>
        API base address
        <input
          aria-label="API base address"
          className={inputClass}
          placeholder="https://api.example.com/v1"
          autoComplete="off"
          spellCheck={false}
          required
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          disabled={busy}
        />
      </label>
      <div className="flex flex-col gap-1 text-meta text-ink-2">
        Credential (optional)
        <div className="flex flex-wrap gap-2">
          <Select
            label="Credential type"
            options={authKinds}
            value={auth}
            onChange={setAuth}
            disabled={busy}
          />
          {auth === 'API key header' && (
            <input
              aria-label="Header name"
              className={`${inputClass} w-44`}
              autoComplete="off"
              spellCheck={false}
              required
              value={headerName}
              onChange={(event) => setHeaderName(event.target.value)}
              disabled={busy}
            />
          )}
          {!none && (
            <input
              aria-label={secretLabel[auth]}
              placeholder={secretLabel[auth]}
              type="password"
              className={`${inputClass} min-w-48 flex-1`}
              autoComplete="off"
              spellCheck={false}
              required
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              disabled={busy}
            />
          )}
        </div>
        <span>
          {none
            ? 'Choose a type only if the API needs a key or token.'
            : 'Sent only to the base address above.'}
        </span>
      </div>
      <div className="flex flex-col gap-2 text-meta text-ink-2">
        What can Supahelp call?
        <span className="self-start">
          <Select
            label="How to describe the API"
            options={sources}
            value={source}
            onChange={setSource}
            disabled={busy}
          />
        </span>
      </div>
      {!manual && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className={`${labelClass} min-w-56 flex-1`}>
              Spec address (optional)
              <input
                aria-label="Spec address"
                className={inputClass}
                placeholder="Leave empty to look for /openapi.json"
                autoComplete="off"
                spellCheck={false}
                value={specUrl}
                onChange={(event) => setSpecUrl(event.target.value)}
                disabled={busy || importing}
              />
            </label>
            <Button
              kind="secondary"
              disabled={busy || importing || !endpoint.trim()}
              onClick={() => void load({ url: specUrl.trim() || undefined })}
            >
              {importing ? 'Importing…' : 'Import spec'}
            </Button>
          </div>
          <label className={labelClass}>
            Or choose a JSON spec file
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Spec file"
              disabled={busy || importing || !endpoint.trim()}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                if (file.size > 2_000_000)
                  setImportError('The spec is larger than 2 MB.');
                else void load({ text: await file.text() });
              }}
            />
          </label>
          {importError && (
            <p role="alert" className="m-0 text-meta text-bad">
              {importError}
            </p>
          )}
          {!!imported.length && (
            <Group
              label={`${found?.title ?? 'Operations'} · ${chosen.length} of ${MAX_OPERATIONS} allowed`}
            >
              <Card>
                <div className="max-h-80 divide-y divide-line overflow-auto">
                  {imported.map((op, index) => (
                    <div
                      key={op.name}
                      className="flex items-start gap-2 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        aria-label={`Allow ${op.name}`}
                        className="mt-1"
                        checked={op.on}
                        disabled={
                          busy || (!op.on && chosen.length >= MAX_OPERATIONS)
                        }
                        onChange={(event) =>
                          setImported(
                            imported.map((item, i) =>
                              i === index
                                ? { ...item, on: event.target.checked }
                                : item,
                            ),
                          )
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-meta break-words">
                          {op.method} {op.path}
                        </div>
                        <div className="text-meta text-ink-2">
                          {op.description}
                        </div>
                      </div>
                      <label className="flex items-center gap-1 text-meta whitespace-nowrap">
                        <input
                          type="checkbox"
                          aria-label={`${op.name} is read only`}
                          checked={op.readOnly}
                          disabled={busy}
                          onChange={(event) =>
                            setImported(
                              imported.map((item, i) =>
                                i === index
                                  ? { ...item, readOnly: event.target.checked }
                                  : item,
                              ),
                            )
                          }
                        />
                        Read only
                      </label>
                    </div>
                  ))}
                </div>
              </Card>
              <Note>
                Only allowed operations become tools. Read only operations run
                without asking, so tick that only where the call has no side
                effects. Everything else asks for approval each time.
              </Note>
              {!!found?.skipped.length && (
                <details className="text-meta text-ink-2">
                  <summary className="cursor-pointer">
                    {found.skipped.length} could not be imported
                  </summary>
                  <ul className="m-0 mt-1 pl-5">
                    {found.skipped.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              )}
            </Group>
          )}
        </>
      )}
      {manual && (
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 rounded-item p-3 ring-1 ring-line"
            >
              <div className="flex gap-2">
                <Select
                  label={`Endpoint ${index + 1} method`}
                  options={methods}
                  value={row.method}
                  disabled={busy}
                  onChange={(method) =>
                    update(index, {
                      method: method as EndpointRow['method'],
                      readOnly: method === 'GET',
                    })
                  }
                />
                <input
                  aria-label={`Endpoint ${index + 1} path`}
                  className={`${inputClass} font-mono`}
                  placeholder="/customers/{id}"
                  autoComplete="off"
                  spellCheck={false}
                  value={row.path}
                  disabled={busy}
                  onChange={(event) =>
                    update(index, { path: event.target.value })
                  }
                />
              </div>
              <input
                aria-label={`Endpoint ${index + 1} description`}
                className={inputClass}
                placeholder="What it does, e.g. Read a customer"
                value={row.description}
                disabled={busy}
                onChange={(event) =>
                  update(index, { description: event.target.value })
                }
              />
              <input
                aria-label={`Endpoint ${index + 1} query fields`}
                className={inputClass}
                placeholder="Query fields, e.g. limit, status (optional)"
                autoComplete="off"
                spellCheck={false}
                value={row.query}
                disabled={busy}
                onChange={(event) =>
                  update(index, { query: event.target.value })
                }
              />
              {row.method !== 'GET' && (
                <input
                  aria-label={`Endpoint ${index + 1} body fields`}
                  className={inputClass}
                  placeholder="Body fields, e.g. name, email (optional)"
                  autoComplete="off"
                  spellCheck={false}
                  value={row.body}
                  disabled={busy}
                  onChange={(event) =>
                    update(index, { body: event.target.value })
                  }
                />
              )}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-meta">
                  <input
                    type="checkbox"
                    checked={row.readOnly}
                    disabled={busy}
                    onChange={(event) =>
                      update(index, { readOnly: event.target.checked })
                    }
                  />
                  Read only: runs without asking
                </label>
                {rows.length > 1 && (
                  <Button
                    kind="ghost"
                    disabled={busy}
                    onClick={() => setRows(rows.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
          {(problem ?? sizeError) && (
            <p role="alert" className="m-0 text-meta text-bad">
              {problem ?? sizeError}
            </p>
          )}
          <div>
            <Button
              kind="secondary"
              disabled={busy || rows.length >= MAX_OPERATIONS}
              onClick={() => setRows([...rows, blankRow()])}
            >
              Add endpoint
            </Button>
          </div>
          <details className="text-meta text-ink-2">
            <summary className="cursor-pointer">Advanced: edit as JSON</summary>
            <div className="mt-2 flex flex-col gap-2">
              <textarea
                aria-label="Operations JSON"
                className={`${inputClass} min-h-40 font-mono text-meta`}
                spellCheck={false}
                value={edited ? raw : operationsJson(hand.operations)}
                disabled={busy}
                onChange={(event) => setRaw(event.target.value)}
              />
              {edited && (
                <div>
                  <Button
                    kind="ghost"
                    disabled={busy}
                    onClick={() => setRaw(undefined)}
                  >
                    Use the endpoint list instead
                  </Button>
                </div>
              )}
            </div>
          </details>
        </div>
      )}
      {!manual && (problem ?? sizeError) && (
        <p role="alert" className="m-0 text-meta text-bad">
          {problem ?? sizeError}
        </p>
      )}
    </>
  );
}

// After connecting: send one declared read request to prove the address and credential work.
export function CustomApiTest({
  id,
  tools,
}: {
  id: string;
  tools: CatalogConnection['tools'];
}) {
  const reads = tools.filter((tool) => tool.readOnly);
  const [tool, setTool] = useState(reads[0]?.name ?? '');
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const selected = reads.find((item) => item.name === tool) ?? reads[0];
  if (!selected)
    return (
      <Group label="Test access">
        <Card>
          <p className="m-0 px-3.5 py-3 text-meta text-ink-2">
            Mark at least one operation read only to test it here.
          </p>
        </Card>
      </Group>
    );
  const required = Array.isArray(selected.inputSchema.required)
    ? (selected.inputSchema.required as string[])
    : [];
  return (
    <Group label="Test access">
      <Card>
        <form
          className="flex flex-col gap-3 px-3.5 py-3.5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setResult(undefined);
            try {
              const reply = await window.supahelp.testConnectionRead(
                id,
                selected.name,
                Object.fromEntries(required.map((n) => [n, args[n] ?? ''])),
              );
              setResult(
                reply.ok
                  ? { ok: true, text: reply.value.preview || '(empty reply)' }
                  : { ok: false, text: reply.error ?? 'The request failed.' },
              );
            } catch {
              setResult({ ok: false, text: 'The request failed.' });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Select
            label="Operation to test"
            options={reads.map((item) => item.name)}
            value={selected.name}
            onChange={(name) => {
              setTool(name);
              setArgs({});
              setResult(undefined);
            }}
            disabled={busy}
          />
          {required.map((field) => (
            <label key={field} className={labelClass}>
              {field}
              <input
                aria-label={field}
                className={inputClass}
                autoComplete="off"
                spellCheck={false}
                required
                value={args[field] ?? ''}
                onChange={(event) =>
                  setArgs({ ...args, [field]: event.target.value })
                }
                disabled={busy}
              />
            </label>
          ))}
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send test request'}
            </Button>
          </div>
          {result && (
            <pre
              role={result.ok ? 'status' : 'alert'}
              className={`m-0 max-h-60 overflow-auto rounded-item bg-canvas p-3 text-meta whitespace-pre-wrap break-words ${result.ok ? '' : 'text-bad'}`}
            >
              {result.text}
            </pre>
          )}
        </form>
      </Card>
    </Group>
  );
}
