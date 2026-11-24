// Controlled renderer fixture: no provider login, network or payment execution.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AccountProvider } from '../../src/renderer/features/accounts/AccountProvider';
import { SettingsView } from '../../src/renderer/features/settings/SettingsView';
import { WorkspaceSwitcher } from '../../src/renderer/layout/WorkspaceSwitcher';
import '../../src/renderer/styles/index.css';

const ok = (value) => Promise.resolve({ ok: true, value });
const image = (color) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, 8, 8);
  return canvas.toDataURL('image/jpeg');
};
const org = {
  id: 'org',
  name: 'Acme',
  ownerId: 'owner',
  access: 'active',
  source: 'trial',
  capacity: 5,
  assigned: 1,
  reserved: 0,
  expiresAt: '2099-01-01T00:00:00Z',
};
let snapshot, billing, listener, calls, reads;
const root = createRoot(document.getElementById('root'));
const emit = () => {
  snapshot = { ...snapshot, revision: snapshot.revision + 1 };
  listener?.(snapshot);
};
window.supahelp = {
  getAccount: () => ok(snapshot),
  onAccountChanged: (fn) => {
    listener = fn;
    return () => {
      listener = undefined;
    };
  },
  getBilling: () => {
    reads++;
    return ok(billing);
  },
  refreshAccount: () => {
    emit();
    return ok(snapshot);
  },
  selectWorkspace: (context) => {
    snapshot.context.context = context;
    emit();
    return ok({});
  },
  signInAccount: () => {
    calls.push('sign-in');
    return ok({});
  },
  createOrganization: () => {
    snapshot.view.organizations = [{ ...org }];
    emit();
    return ok({ organizationId: org.id });
  },
  changeBilling: (request) => {
    calls.push(request);
    return ok({
      opened: request.action === 'checkout' || request.action === 'portal',
    });
  },
};
function Fixture() {
  const [page, setPage] = useState('billing');
  return (
    <AccountProvider>
      <div className="flex h-screen flex-col bg-canvas text-ink p-6">
        <WorkspaceSwitcher
          onBilling={() => setPage('billing')}
          onSettings={() => setPage('account')}
          onNewOrganization={() => setPage('new-organization')}
          onContextChange={async () => true}
        />
        <SettingsView page={page} onPage={setPage} />
      </div>
    </AccountProvider>
  );
}
let key = 0;
window.billingTest = {
  reset(mode = 'owner') {
    calls = [];
    reads = 0;
    snapshot = {
      revision: 1,
      context: {
        generation: ++key,
        accountId:
          mode === 'signed-out' ? null : mode === 'member' ? 'member' : 'owner',
        context: { kind: 'personal' },
      },
      status: mode === 'signed-out' ? 'signed-out' : 'ready',
      view:
        mode === 'signed-out'
          ? null
          : {
              account: {
                id: mode === 'member' ? 'member' : 'owner',
                email:
                  mode === 'member'
                    ? 'member@example.test'
                    : 'owner@example.test',
              },
              organizations: mode === 'no-org' ? [] : [{ ...org }],
              workspaces:
                mode === 'icon-switcher'
                  ? [
                      {
                        id: 'workspace',
                        organizationId: 'org',
                        name: 'General',
                        role: 'admin',
                      },
                    ]
                  : [],
            },
      members: [],
      invitations: [],
    };
    if (mode === 'expired')
      snapshot.view.organizations[0].expiresAt = '2020-01-01T00:00:00Z';
    if (mode === 'icon-switcher')
      snapshot.view.organizations[0].icon = image('red');
    billing = {
      enabled: mode !== 'disabled',
      trialAvailable: false,
      status: 'none',
      capacity: 5,
      pendingCapacity: null,
      pendingAt: null,
      cancelAtPeriodEnd: false,
      hasSubscription: false,
      reviewRequired: false,
      pendingAction: false,
    };
    root.render(<Fixture key={key} />);
  },
  confirm(status = 'trialing') {
    billing = { ...billing, hasSubscription: true, status };
    window.dispatchEvent(new Event('focus'));
  },
  setIcon(color) {
    snapshot.view.organizations[0].icon = image(color);
    emit();
  },
  calls: () => calls,
  reads: () => reads,
};
window.billingTest.reset();
