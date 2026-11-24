import type { ReactNode } from 'react';
import type { IconName } from '../../components/Icon';
import { shortcutLabel } from '../../components/shortcuts';
import { openSupport } from '../../components/support';
import { PreviousLocalWork } from '../accounts/PreviousLocalWork';
import { PlanBilling } from '../accounts/PlanBilling';
import {
  AccountSettings,
  OrganizationSettings,
  WorkspaceSettings,
} from '../accounts/AccountWorkspace';
import { Button } from '../../components/Button';
import { Connections } from './Connections';
import { Models } from './Models';
import { NotificationSettings } from './Notifications';
import { Card, Group, Kbd, PageHeader, Row } from './parts';
import { useUpdateState } from './useUpdateState';

export type SettingsPage =
  | 'general'
  | 'notifications'
  | 'models'
  | 'connections'
  | 'privacy'
  | 'account'
  | 'organization'
  | 'workspace'
  | 'billing'
  // Not in the nav: Plan & billing opened on the new-organization offer.
  | 'new-organization';

// Settings navigation. `badge` counts things that need attention.
export const SETTINGS_NAV: {
  group: string;
  items: {
    page: SettingsPage;
    title: string;
    icon: IconName;
    badge?: number;
  }[];
}[] = [
  {
    group: 'You',
    items: [
      { page: 'general', title: 'General', icon: 'gear' },
      { page: 'notifications', title: 'Notifications', icon: 'bell' },
    ],
  },
  {
    group: 'AI',
    items: [{ page: 'models', title: 'Models', icon: 'spark' }],
  },
  {
    group: 'Tools',
    items: [
      {
        page: 'connections',
        title: 'Connections',
        icon: 'plug',
      },
    ],
  },
  {
    group: 'Data',
    items: [{ page: 'privacy', title: 'Privacy & data', icon: 'shield' }],
  },
  {
    group: 'Team',
    items: [
      { page: 'account', title: 'Account', icon: 'user' },
      { page: 'organization', title: 'Organization', icon: 'folder' },
      { page: 'workspace', title: 'Workspace', icon: 'users' },
      { page: 'billing', title: 'Plan & billing', icon: 'chart' },
    ],
  },
];

function checkedAgo(at?: number) {
  if (!at) return '';
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return ' · checked just now';
  if (minutes < 60) return ` · checked ${minutes} min ago`;
  return ` · checked ${Math.floor(minutes / 60)} h ago`;
}

function About() {
  const update = useUpdateState();
  if (!update) return null;
  const busy = update.status === 'checking' || update.status === 'downloading';
  const description = {
    unsupported:
      "Updates aren't available in this build. Get the latest from supahelp.app/download.",
    idle: 'Checks for updates automatically.',
    checking: 'Checking for updates…',
    current: `You're up to date${checkedAgo(update.checkedAt)}`,
    downloading: 'Downloading the latest version…',
    ready: 'A new version is ready. Restart to finish updating.',
    error: "Couldn't check for updates.",
  }[update.status];
  return (
    <Group label="About">
      <Card>
        <Row title={`Supahelp ${update.version}`} description={description}>
          {update.status === 'ready' ? (
            <Button onClick={() => void window.supahelp.installUpdate()}>
              Restart to update
            </Button>
          ) : (
            update.status !== 'unsupported' && (
              <Button
                kind="secondary"
                disabled={busy}
                onClick={() => void window.supahelp.checkForUpdates()}
              >
                {update.status === 'checking'
                  ? 'Checking…'
                  : update.status === 'downloading'
                    ? 'Downloading…'
                    : update.status === 'error'
                      ? 'Try again'
                      : 'Check for updates'}
              </Button>
            )
          )}
        </Row>
      </Card>
    </Group>
  );
}

function General() {
  return (
    <>
      <PageHeader title="General" />
      <Group label="Preferences">
        <Card>
          <Row
            title="Appearance"
            description="Supahelp follows your computer's appearance."
          />
          <Row
            title="When the window closes"
            description="Active chats stop. Saved personal documents remain on this computer."
          />
        </Card>
      </Group>
      <Group label="Keyboard shortcuts">
        <Card>
          {(
            [
              ['New chat', shortcutLabel('N')],
              ['Show or hide the sidebar', shortcutLabel('\\')],
              ['Open settings', shortcutLabel(',')],
              ['Close settings', 'Esc'],
            ] as const
          ).map(([title, shortcut]) => (
            <Row key={title} title={title}>
              <Kbd>{shortcut}</Kbd>
            </Row>
          ))}
        </Card>
      </Group>
      <Group label="Support">
        <Card>
          <Row
            title="Get support"
            description="Open the Supahelp support portal in your browser."
          >
            <Button kind="secondary" onClick={openSupport}>
              Get support
            </Button>
          </Row>
        </Card>
      </Group>
      <About />
    </>
  );
}

function Privacy() {
  return (
    <>
      <PageHeader
        title="Privacy & data"
        description="What Supahelp keeps on this computer and what it sends elsewhere."
      />
      <PreviousLocalWork />
      <Group label="Where your data goes">
        <Card>
          <Row
            title="Stored on this computer"
            description="Chats, cases and Playbooks are saved per account on this computer and never sync to a team workspace. Signing out opens a separate guest workspace. Save document edits to keep them. Nothing is deleted automatically."
          />
          <Row
            title="Encryption"
            description="Connection credentials are encrypted with your operating system's secure storage. The local document database is not encrypted by Supahelp."
          />
          <Row
            title="AI provider"
            description="Chat content goes to the provider you selected, under its own terms and retention. New document text gets pattern masking and a separate model check before it's saved; masking can miss things."
          />
          <Row
            title="Connected tools"
            description="Tools receive only the requests you make. Changes in external tools need your approval first."
          />
        </Card>
      </Group>
    </>
  );
}

export const SETTINGS_PAGES: Record<
  SettingsPage,
  (props: { onOpenWorkspace: () => void }) => ReactNode
> = {
  general: General,
  notifications: NotificationSettings,
  models: Models,
  connections: Connections,
  privacy: Privacy,
  account: AccountSettings,
  organization: OrganizationSettings,
  workspace: WorkspaceSettings,
  billing: () => <PlanBilling />,
  'new-organization': () => <PlanBilling startNew />,
};
