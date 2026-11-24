process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const assert = require('node:assert/strict');
const { app, nativeTheme } = require('electron');
const { mkdtempSync, rmSync, chmodSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { tmpdir } = require('node:os');
const root = resolve(__dirname, '../..');
const profile = mkdtempSync(join(tmpdir(), 'linear-ui-'));
app.setPath('userData', profile);
const timeout = setTimeout(() => {
  console.error('Linear UI E2E timed out');
  app.exit(1);
}, 60000);
app.whenReady().then(async () => {
  let fixture;
  let zendesk;
  let customApi;
  let running;
  try {
    const { linearFixture } = await import(
      pathToFileURL(join(root, 'tests/support/linear-server.mjs')).href
    );
    fixture = await linearFixture();
    const { zendeskFixture } = await import(
      pathToFileURL(join(root, 'tests/support/zendesk-server.mjs')).href
    );
    zendesk = await zendeskFixture();
    const executable = join(root, 'tests/support/linear-codex.mjs');
    chmodSync(executable, 0o700);
    writeFileSync(
      join(profile, 'models.json'),
      JSON.stringify({
        selected: { provider: 'chatgpt', model: 'fixture-model' },
      }),
    );
    running = await require(join(tmpdir(), 'supahelp-linear-e2e/app.cjs')).boot(
      profile,
      join(
        root,
        `out/Supahelp-${process.platform}-${process.arch}/Supahelp.app/Contents/Resources/app.asar`,
      ),
      executable,
      fixture.endpoint,
      (url) => fixture.authorize(url),
      zendesk.origin,
      (url) => zendesk.authorize(url),
    );
    const evaluate = (expression) =>
      running.window.webContents.executeJavaScript(expression);
    const waitFor = async (expression) => {
      for (let i = 0; i < 200; i++) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error(`Timed out: ${expression}`);
    };
    const click = (text) =>
      evaluate(
        `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    const openTool = async (id) => {
      // Once something is connected, the catalog sits behind Add connection.
      await evaluate(
        `void (document.querySelector('[data-tool="${id}"]') || [...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Add connection')?.click())`,
      );
      await waitFor(`!!document.querySelector('[data-tool="${id}"]')`);
      await evaluate(`document.querySelector('[data-tool="${id}"]').click()`);
    };
    const input = (label, value) =>
      evaluate(
        `(() => { const el=document.querySelector('input[aria-label="${label}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`,
      );
    await waitFor(
      `!!window.supahelp && [...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Workspace settings')`,
    );
    await evaluate(
      'window.dispatchEvent(new KeyboardEvent("keydown", {key:",",metaKey:true}))',
    );
    await waitFor(
      `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Connections')`,
    );
    await click('Connections');
    const definitions = (await evaluate('window.supahelp.getConnections()'))
      .value.connections;
    for (const definition of definitions) {
      if (definition.unavailable) continue;
      const search =
        definition.id === 'custom-mcp'
          ? 'MCP server'
          : definition.id === 'custom-api'
            ? 'REST API'
            : definition.name;
      await input('Search connections', search);
      await openTool(definition.id);
      await waitFor(
        `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()===${JSON.stringify(`Connect ${definition.name}`)})`,
      );
      assert.equal(
        await evaluate(
          `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(`Connect ${definition.name}`)}).disabled`,
        ),
        !!definition.requiresSupahelpAccount,
        `${definition.name}: only hosted connections require Supahelp sign-in`,
      );
      if (!definition.id.startsWith('custom-')) {
        assert.equal(
          definition.fields.some((field) =>
            ['clientId', 'clientSecret', 'redirectUri'].includes(field.key),
          ),
          false,
          `${definition.name}: developer setup must not be customer-facing`,
        );
      }
      if (['google-drive', 'github-issues'].includes(definition.id)) {
        assert.deepEqual(definition.fields, []);
        assert.equal(
          await evaluate(
            `!!document.querySelector('input[aria-label*="client"], input[aria-label*="token"]')`,
          ),
          false,
        );
        assert.equal(
          await evaluate(
            `document.body.innerText.includes('Sign in with ${definition.id === 'google-drive' ? 'Google' : 'GitHub'} in your browser')`,
          ),
          true,
        );
      }
      if (definition.id === 'custom-api')
        // Its setup form is not one input per stored field: the credential is optional and typed once.
        for (const label of ['Name', 'API base address'])
          assert.equal(
            await evaluate(
              `!!document.querySelector('input[aria-label=${JSON.stringify(label)}]')`,
            ),
            true,
            `${definition.name}: ${label}`,
          );
      for (const field of definition.id === 'custom-api'
        ? []
        : definition.fields) {
        assert.equal(
          await evaluate(
            `!!document.querySelector('[aria-label=${JSON.stringify(field.label)}]')`,
          ),
          true,
          `${definition.name}: ${field.label}`,
        );
        if (field.secret)
          assert.equal(
            await evaluate(
              `document.querySelector('[aria-label=${JSON.stringify(field.label)}]').type`,
            ),
            'password',
          );
      }
      if (definition.id === 'stripe') {
        const arrowOffset = await evaluate(
          `(() => {const select=document.querySelector('select[aria-label="Stripe environment"]');return Math.abs(select.nextElementSibling.getBoundingClientRect().right-select.getBoundingClientRect().right);})()`,
        );
        assert.ok(
          arrowOffset < 20,
          'The environment selector arrow stays inside its control',
        );
        for (const appearance of ['light', 'dark']) {
          nativeTheme.themeSource = appearance;
          await new Promise((resolve) => setTimeout(resolve, 100));
          writeFileSync(
            join(tmpdir(), `stripe-setup-${appearance}.png`),
            (await running.window.webContents.capturePage()).toPNG(),
          );
        }
      }
      await click('All connections');
    }
    console.log(
      'PASS: All 31 new provider setup forms render from main-owned definitions with secret inputs protected',
    );
    await input('Search connections', 'zendesk');
    await waitFor(`document.querySelectorAll('[data-tool]').length === 1`);
    assert.equal(
      await evaluate(`document.querySelector('[data-tool]').dataset.tool`),
      'zendesk',
    );
    await click('Issue tracking');
    await waitFor(`document.body.textContent.includes('No tool matches')`);
    assert.equal(
      await evaluate(
        `document.body.textContent.includes('You can still connect it')`,
      ),
      false,
    );
    await click('All');
    await input('Search connections', '');
    await waitFor(`!!document.querySelector('[data-tool="linear"]')`);
    for (const appearance of ['light', 'dark']) {
      nativeTheme.themeSource = appearance;
      await new Promise((resolve) => setTimeout(resolve, 150));
      writeFileSync(
        join(tmpdir(), `connections-browser-${appearance}.png`),
        (await running.window.webContents.capturePage()).toPNG(),
      );
    }
    await openTool('intercom');
    await waitFor(
      `!!document.querySelector('select[aria-label="Account region"]')`,
    );
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Connect Intercom').disabled`,
      ),
      true,
    );
    assert.equal(
      await evaluate(
        `!!document.querySelector('input[aria-label="OAuth app client secret"], input[aria-label="OAuth app client ID"]')`,
      ),
      false,
    );
    for (const appearance of ['light', 'dark']) {
      nativeTheme.themeSource = appearance;
      await new Promise((resolve) => setTimeout(resolve, 100));
      writeFileSync(
        join(tmpdir(), `managed-oauth-${appearance}.png`),
        (await running.window.webContents.capturePage()).toPNG(),
      );
    }
    const reopenIntercom = async () => {
      await evaluate(
        'window.dispatchEvent(new KeyboardEvent("keydown", {key:",",metaKey:true}))',
      );
      await waitFor(
        `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Connections')`,
      );
      await click('Connections');
      await openTool('intercom');
    };
    await click('Sign in to Supahelp');
    await waitFor(
      `window.supahelp.getAccount().then(reply => reply.value.status === 'signing-in')`,
    );
    await reopenIntercom();
    await waitFor(
      `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Cancel Supahelp sign-in')`,
    );
    await click('Cancel Supahelp sign-in');
    await waitFor(
      `window.supahelp.getAccount().then(reply => reply.value.status === 'signed-out')`,
    );
    assert.equal(running.catalogConsents(), 0);
    await running.setAccount('account-one');
    await waitFor(
      `window.supahelp.getAccount().then(reply => reply.value.context.accountId === 'account-one')`,
    );
    await reopenIntercom();
    await waitFor(
      `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Connect Intercom' && !button.disabled)`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('select[aria-label="Account region"]').value`,
      ),
      'US',
    );
    await click('Connect Intercom');
    await waitFor(`!!document.querySelector('[role="alert"]')`);
    assert.doesNotMatch(
      await evaluate(`document.querySelector('[role="alert"]').textContent`),
      /Check Account region/,
    );
    await running.setAccount('account-two');
    await waitFor(
      `window.supahelp.getAccount().then(reply => reply.value.context.accountId === 'account-two')`,
    );
    assert.equal(running.catalogConsents(), 0);
    await running.setAccount();
    await waitFor(
      `window.supahelp.getAccount().then(reply => reply.value.status === 'signed-out')`,
    );
    await reopenIntercom();
    console.log(
      'PASS: Free account sign-in, cancellation and account changes never start provider consent automatically',
    );
    await click('All connections');
    await openTool('linear');
    await waitFor(
      `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Connect Linear' && !button.disabled)`,
    );
    assert.equal(await evaluate('typeof window.require'), 'undefined');
    await evaluate(
      `(() => { const el=document.querySelector('select[aria-label="Linear access"]'); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(el,'Read + changes'); el.dispatchEvent(new Event('change',{bubbles:true})); })()`,
    );
    await click('Connect Linear');
    await waitFor(`document.body.textContent.includes('Disconnect Linear')`);
    await waitFor(
      `document.body.textContent.includes('always asks you first') && !!document.querySelector('code')`,
    );
    for (const appearance of ['light', 'dark']) {
      nativeTheme.themeSource = appearance;
      await new Promise((resolve) => setTimeout(resolve, 150));
      writeFileSync(
        join(tmpdir(), `linear-settings-${appearance}.png`),
        (await running.window.webContents.capturePage()).toPNG(),
      );
    }
    await evaluate(
      'window.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}))',
    );
    await waitFor(`!!document.querySelector('textarea')`);
    await evaluate(
      `(() => {const el=document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Create a Linear issue to investigate checkout'); el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await waitFor(
      `!document.querySelector('button[aria-label="Send"]').disabled`,
    );
    await evaluate(
      `document.querySelector('button[aria-label="Send"]').click()`,
    );
    await waitFor(
      `document.body.textContent.includes('Approve Linear action')`,
    );
    assert.equal(fixture.mutations.length, 0);
    writeFileSync(
      join(tmpdir(), 'linear-approval.png'),
      (await running.window.webContents.capturePage()).toPNG(),
    );
    await click('Approve Linear action');
    await waitFor(
      `document.body.textContent.includes('Linear created the issue: Investigate checkout.') && document.body.textContent.includes('Verified')`,
    );
    assert.deepEqual(fixture.mutations, [{ title: 'Investigate checkout' }]);
    assert.equal(
      (await evaluate(`window.supahelp.connectLinear('invalid')`)).ok,
      false,
    );
    await evaluate(
      'window.dispatchEvent(new KeyboardEvent("keydown", {key:",",metaKey:true}))',
    );
    await click('Connections');
    await openTool('linear');
    await waitFor(`document.body.textContent.includes('Disconnect Linear')`);
    await click('Disconnect Linear');
    await waitFor(`document.body.textContent.includes('Connect Linear')`);
    assert.equal(
      (await evaluate('window.supahelp.getLinear()')).value.state,
      'disconnected',
    );
    console.log(
      'PASS: Settings OAuth setup → access review → chat MCP read → write approval → verified write → disconnect',
    );
    await click('All connections');
    await openTool('zendesk');
    await waitFor(
      `!!document.querySelector('input[aria-label="Zendesk workspace"]')`,
    );
    assert.equal(
      await evaluate(
        `document.body.textContent.includes('Look up the customer')`,
      ),
      false,
    );
    assert.equal(
      await evaluate(
        `document.body.textContent.includes('Read public replies and internal notes')`,
      ),
      true,
    );
    await input('Zendesk workspace', 'evil.example');
    assert.equal(
      await evaluate(
        `!!document.querySelector('input[aria-label="Zendesk OAuth client ID"]')`,
      ),
      false,
    );
    await click('Connect Zendesk');
    await waitFor(`!!document.querySelector('[role="alert"]')`);
    assert.equal(
      (await evaluate('window.supahelp.getZendesk()')).value.state,
      'disconnected',
    );
    await input('Zendesk workspace', 'acme.zendesk.com');
    for (const appearance of ['light', 'dark']) {
      nativeTheme.themeSource = appearance;
      await new Promise((resolve) => setTimeout(resolve, 150));
      writeFileSync(
        join(tmpdir(), `zendesk-setup-${appearance}.png`),
        (await running.window.webContents.capturePage()).toPNG(),
      );
    }
    await click('Connect Zendesk');
    await waitFor(`document.body.textContent.includes('Disconnect Zendesk')`);
    assert.deepEqual(
      (await evaluate('window.supahelp.getZendesk()')).value.tools.map(
        (tool) => tool.name,
      ),
      [
        'search_tickets',
        'get_ticket',
        'list_comments',
        'search_customers',
        'get_customer',
      ],
    );
    assert.equal(
      await evaluate(
        `document.body.textContent.includes('Supahelp only reads from Zendesk')`,
      ),
      true,
    );
    assert.equal(
      await evaluate(
        `!!document.querySelector('code') && document.body.textContent.includes('reply_to_ticket')`,
      ),
      false,
    );
    await click('Disconnect Zendesk');
    await waitFor(
      `!!document.querySelector('select[aria-label="Zendesk access"]')`,
    );
    await evaluate(
      `(() => {const el=document.querySelector('select[aria-label="Zendesk access"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'Read + changes'); el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await click('Connect Zendesk');
    await waitFor(`document.body.textContent.includes('Disconnect Zendesk')`);
    assert.equal(
      await evaluate(
        `document.body.textContent.includes('tickets:write') && document.body.textContent.includes('Test Agent')`,
      ),
      true,
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Disconnect Zendesk').closest('section').scrollIntoView({block:'start'})`,
    );
    for (const appearance of ['light', 'dark']) {
      nativeTheme.themeSource = appearance;
      await new Promise((resolve) => setTimeout(resolve, 150));
      writeFileSync(
        join(tmpdir(), `zendesk-settings-${appearance}.png`),
        (await running.window.webContents.capturePage()).toPNG(),
      );
    }
    await click('New chat');
    await waitFor(`!!document.querySelector('textarea')`);
    await evaluate(
      `(() => {const el=document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Reply to Zendesk ticket 123'); el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await waitFor(
      `!document.querySelector('button[aria-label="Send"]').disabled`,
    );
    await evaluate(
      `document.querySelector('button[aria-label="Send"]').click()`,
    );
    await waitFor(
      `document.body.textContent.includes('Approve Zendesk action')`,
    );
    assert.equal(zendesk.writes.length, 0);
    await click('Approve Zendesk action');
    await waitFor(
      `document.body.textContent.includes('Zendesk accepted the customer reply.') && document.body.textContent.includes('Verified')`,
    );
    assert.deepEqual(zendesk.comments, [
      { id: 1, body: 'We are investigating checkout.', public: true },
    ]);
    await evaluate(
      'window.dispatchEvent(new KeyboardEvent("keydown", {key:",",metaKey:true}))',
    );
    await click('Connections');
    await openTool('zendesk');
    await waitFor(`document.body.textContent.includes('Disconnect Zendesk')`);
    const staleZendesk = await running.zendesk.agent('revocation-check');
    zendesk.failures.set('/api/v2/tickets/123.json', 401);
    await assert.rejects(
      staleZendesk.call('get_ticket', { ticket_id: 123 }),
      /Reconnect/,
    );
    await waitFor(
      `document.body.textContent.includes('Needs reconnecting') && document.body.textContent.includes('Sign in again')`,
    );
    await click('All connections');
    await waitFor(
      `document.querySelector('[data-tool="zendesk"]').textContent.includes('Reconnect')`,
    );
    zendesk.failures.clear();
    await openTool('zendesk');
    await waitFor(
      `[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Reconnect Zendesk' && !button.disabled)`,
    );
    await click('Reconnect Zendesk');
    await waitFor(`document.body.textContent.includes('Disconnect Zendesk')`);
    await click('Disconnect Zendesk');
    await waitFor(`document.body.textContent.includes('Connect Zendesk')`);
    assert.equal(
      (await evaluate('window.supahelp.getZendesk()')).value.state,
      'disconnected',
    );
    console.log(
      'PASS: Connections search/groups → Zendesk read-only and write setup → chat API read → approved public reply → audit verification → revoked-access UI → reconnect → disconnect',
    );
    await click('All connections');
    await openTool('custom-mcp');
    await waitFor(
      `!!document.querySelector('input[aria-label="MCP server address"]')`,
    );
    await input('MCP server address', fixture.endpoint);
    await click('Connect Your MCP server');
    await waitFor(
      `document.body.textContent.includes('Disconnect Your MCP server')`,
    );
    assert.equal(
      (
        await evaluate('window.supahelp.getConnections()')
      ).value.connections.find((c) => c.id === 'custom-mcp').tools[0].readOnly,
      false,
    );
    await evaluate(`document.querySelector('details summary').click()`);
    await evaluate(`document.querySelector('input[type="checkbox"]').click()`);
    await waitFor(`document.querySelector('input[type="checkbox"]').checked`);
    const genericAgents = await running.connections.agents('generic-check');
    assert.match(
      (
        await genericAgents
          .find((entry) => entry.name === 'custom_mcp')
          .agent.call('get_issue', { id: 'SUP-1' })
      ).content[0].text,
      /checkout/i,
    );
    await click('Disconnect Your MCP server');
    console.log(
      'PASS: Custom MCP UI → OAuth/PKCE → discovered schema review → controlled transport read → disconnect',
    );
    const writes = [];
    const { createServer } = require('node:http');
    customApi = createServer(async (request, response) => {
      assert.equal(request.headers.authorization, 'Bearer fixture-api-secret');
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'PATCH') {
        let text = '';
        for await (const chunk of request) text += chunk;
        writes.push(JSON.parse(text));
      }
      response.end(
        JSON.stringify({
          id: 'customer-1',
          status: writes.at(-1)?.status ?? 'open',
        }),
      );
    });
    await new Promise((resolve) => customApi.listen(0, '127.0.0.1', resolve));
    await click('All connections');
    await openTool('custom-api');
    await waitFor(
      `!!document.querySelector('select[aria-label="Credential type"]')`,
    );
    assert.equal(
      await evaluate(`!!document.querySelector('input[aria-label="Token"]')`),
      false,
    );
    await evaluate(
      `(() => {const el=document.querySelector('select[aria-label="Credential type"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'Bearer token');el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await waitFor(`!!document.querySelector('input[aria-label="Token"]')`);
    // Describe the API by hand; the generated JSON is replaced below with the fixture's operations.
    await evaluate(
      `(() => {const el=document.querySelector('select[aria-label="How to describe the API"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'Add endpoints by hand');el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await waitFor(
      `!!document.querySelector('textarea[aria-label="Operations JSON"]')`,
    );
    await input('Name', 'Your REST API');
    await input(
      'API base address',
      `http://127.0.0.1:${customApi.address().port}`,
    );
    await input('Token', 'fixture-api-secret');
    const schema = {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    };
    const operations = [
      {
        name: 'read_record',
        description: 'Read a customer record',
        method: 'GET',
        path: '/records/{id}',
        inputSchema: schema,
        readOnly: true,
      },
      {
        name: 'change_record',
        description: 'Change the reviewed customer status',
        method: 'PATCH',
        path: '/records/{id}',
        inputSchema: {
          ...schema,
          properties: { ...schema.properties, status: { type: 'string' } },
          required: ['id', 'status'],
        },
        readOnly: false,
      },
    ];
    await evaluate(
      `(() => {const el=document.querySelector('textarea[aria-label="Operations JSON"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(JSON.stringify(operations))});el.dispatchEvent(new Event('input',{bubbles:true}));const access=document.querySelector('select[aria-label="Your REST API access"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(access,'Read + changes');access.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await click('Connect Your REST API');
    await waitFor(
      `document.body.textContent.includes('Disconnect Your REST API')`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('input[type="password"]') === null`,
      ),
      true,
    );
    await click('Disconnect Your REST API');
    await waitFor(
      `!!document.querySelector('select[aria-label="Credential type"]')`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('input[aria-label="Name"]').value`,
      ),
      'Your REST API',
    );
    await input(
      'API base address',
      `http://127.0.0.1:${customApi.address().port}`,
    );
    await evaluate(
      `(() => {const set=(label,value)=>{const el=document.querySelector('select[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));};set('Credential type','Bearer token');set('How to describe the API','Add endpoints by hand');})()`,
    );
    await waitFor(
      `!!document.querySelector('textarea[aria-label="Operations JSON"]')`,
    );
    await input('Token', 'fixture-api-secret');
    await evaluate(
      `(() => {const el=document.querySelector('textarea[aria-label="Operations JSON"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(JSON.stringify(operations))});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await click('Connect Your REST API');
    await waitFor(
      `document.body.textContent.includes('Disconnect Your REST API')`,
    );
    for (const appearance of ['light', 'dark']) {
      nativeTheme.themeSource = appearance;
      await new Promise((resolve) => setTimeout(resolve, 150));
      writeFileSync(
        join(tmpdir(), `custom-api-settings-${appearance}.png`),
        (await running.window.webContents.capturePage()).toPNG(),
      );
    }
    await click('New chat');
    await waitFor(`!!document.querySelector('textarea')`);
    await evaluate(
      `(() => {const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Update the customer using our custom API');el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await waitFor(
      `!document.querySelector('button[aria-label="Send"]').disabled`,
    );
    await evaluate(
      `document.querySelector('button[aria-label="Send"]').click()`,
    );
    await waitFor(
      `document.body.textContent.includes('Approve Your REST API action')`,
    );
    assert.equal(writes.length, 0);
    await click('Approve Your REST API action');
    await waitFor(
      `document.body.textContent.includes('The custom API accepted the requested status.')`,
    );
    assert.deepEqual(writes, [{ status: 'investigating' }]);
    assert.equal(
      await evaluate(
        `document.body.textContent.includes('fixture-api-secret')`,
      ),
      false,
    );
    console.log(
      'PASS: Custom REST UI → bounded API read through model bridge → exact approval → controlled write → credential isolation',
    );
    await running.setAccount('5ca46fdb-84bc-4f64-a676-2c5e38907f59', true);
    await waitFor(
      `document.body.textContent.includes('Fixture team · Support')`,
    );
    await evaluate(
      'window.dispatchEvent(new KeyboardEvent("keydown", {key:",",metaKey:true}))',
    );
    await click('Connections');
    await openTool('linear');
    const linearStatus = () => evaluate('window.supahelp.getLinear()');
    assert.equal((await linearStatus()).value.state, 'disconnected');
    await waitFor(
      `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Connect Linear' && !button.disabled)`,
    );
    await click('Connect Linear');
    await waitFor(`document.body.textContent.includes('Disconnect Linear')`);
    assert.equal((await linearStatus()).value.state, 'connected');
    assert.equal((await linearStatus()).value.context.context.kind, 'team');
    await click('Disconnect Linear');
    await waitFor(`document.body.textContent.includes('Connect Linear')`);
    assert.equal((await linearStatus()).value.state, 'disconnected');
    assert.equal((await linearStatus()).value.context.context.kind, 'team');
    console.log(
      'PASS: Team Connections catalog, personal Linear setup and disconnect without switching.',
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await running?.close();
    await fixture?.close();
    await zendesk?.close();
    if (customApi) await new Promise((resolve) => customApi.close(resolve));
    rmSync(profile, { recursive: true, force: true });
    app.exit(process.exitCode ?? 0);
  }
});
