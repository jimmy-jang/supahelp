import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { caseAgent } from '../../../src/main/features/cases/agent.ts';
import { CaseService } from '../../../src/main/features/cases/service.ts';
import { CaseStore } from '../../../src/main/features/cases/store.ts';
import {
  caseEnvironment,
  caseOperation,
} from '../../support/case-environment.mjs';

test('chat searches legacy encrypted customers and tickets without a case attachment', async (t) => {
  const profile = mkdtempSync(join(tmpdir(), 'supahelp-customer-'));
  const file = join(profile, 'first.db');
  const store = new CaseStore(file);
  const { environment, switchContext, prompts } = caseEnvironment();
  const service = new CaseService(store, () => {}, environment);
  const operation = () => caseOperation(environment.context());
  t.after(() => {
    service.close();
    rmSync(profile, { recursive: true, force: true });
  });
  const caseId = await service.create(
    {
      id: randomUUID(),
      title: 'Test case',
      messages: [{ role: 'user', text: 'Zendesk ticket #123' }],
    },
    operation(),
  );
  const customer = {
    id: randomUUID(),
    name: 'Alex Example',
    reference: 'acct-17',
  };
  const encrypted = await environment.encryption.encryptString(
    JSON.stringify({ name: customer.name, reference: customer.reference }),
  );
  assert.deepEqual(await service.customers(operation()), {
    customers: [],
    links: [],
  });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE customers (id TEXT PRIMARY KEY, encrypted BLOB NOT NULL);
    CREATE TABLE case_customers (
      case_id TEXT PRIMARY KEY REFERENCES cases(id),
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE
    );
  `);
  db.prepare('INSERT INTO customers (id, encrypted) VALUES (?, ?)').run(
    customer.id,
    encrypted,
  );
  db.prepare(
    'INSERT INTO case_customers (case_id, customer_id) VALUES (?, ?)',
  ).run(caseId, customer.id);
  db.close();
  const agent = caseAgent(service, 'unattached-chat', operation());
  assert.equal(
    agent.tools.find(({ name }) => name === 'search_references').annotations
      .readOnlyHint,
    true,
  );
  const search = async (kind, query) => {
    const result = await agent.call('search_references', { kind, query });
    assert.equal(result.isError, undefined, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  assert.deepEqual(await search('customer', '  ACCT-17  '), {
    customers: [{ name: customer.name, reference: customer.reference }],
    cases: [],
  });
  assert.deepEqual(await search('customer', 'unknown'), {
    customers: [],
    cases: [],
  });
  assert.deepEqual(await search('ticket', '#123'), {
    cases: [{ number: 1, title: 'Test case', ticket: 'ZD #123' }],
  });
  const blank = await agent.call('search_references', {
    kind: 'customer',
    query: ' ',
  });
  assert.equal(blank.isError, true);
  assert.deepEqual(await service.customers(operation()), {
    customers: [customer],
    links: [{ caseId, customerId: customer.id }],
  });
  assert.equal(service.read(caseId, operation()).customer.name, '');
  assert.ok(prompts.every((prompt) => !prompt.includes(customer.name)));
  assert.ok(!Buffer.from(encrypted).includes(customer.name));

  const stale = operation();
  switchContext({
    ...environment.context(),
    generation: 2,
    accountId: randomUUID(),
  });
  await service.activate(join(profile, 'second.db'));
  await service.prepare(operation());
  await assert.rejects(service.customers(stale), /case-context/);
  assert.deepEqual(await service.customers(operation()), {
    customers: [],
    links: [],
  });
  assert.equal(
    (await agent.call('search_references', { kind: 'customer', query: 'Alex' }))
      .isError,
    true,
  );
  assert.deepEqual(
    await service.searchReferences('customer', 'Alex', operation()),
    { customers: [], cases: [] },
  );

  switchContext({ ...stale.context, generation: 3 });
  await service.activate(join(profile, 'first.db'));
  await service.prepare(operation());
  assert.deepEqual((await service.customers(operation())).customers, [
    customer,
  ]);
  assert.deepEqual((await service.customers(operation())).links, [
    { caseId, customerId: customer.id },
  ]);
});
