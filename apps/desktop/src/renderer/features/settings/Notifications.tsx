import { useEffect, useState } from 'react';
import { useAccount } from '../accounts/AccountProvider';
import { useCollaboration } from '../collaboration/useCollaboration';
import { Card, Group, PageHeader, Row } from './parts';
const labels = {
  approval: 'A case needs approval',
  failure: 'An action fails or its outcome is unknown',
  question: 'An open question is for you',
  'brought-in': 'You were brought into a case',
  'handed-off': 'A case is handed to you',
  'playbook-published': 'A new Playbook is published',
  'playbook-updated': 'Someone updates your Playbook',
};
export function NotificationSettings() {
  const { snapshot: account, isCurrent } = useAccount(),
    context = account.context,
    c = useCollaboration();
  const [local, setLocal] = useState<{
      enabled: boolean;
      hideDetails: boolean;
    }>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.supahelp
      .notificationBannerSettings({ context })
      .then((r) => {
        if (isCurrent(context)) {
          if (r.ok) setLocal(r.value);
          else setError(r.error);
        }
      })
      .catch(() => setError('Notification settings could not load.'));
  }, [context.generation]);
  const save = async (value: { enabled: boolean; hideDetails: boolean }) => {
    setBusy(true);
    try {
      const r = await window.supahelp.notificationBannerSettings({
        context,
        value,
      });
      if (isCurrent(context)) {
        if (r.ok) setLocal(r.value);
        else setError(r.error);
      }
    } catch {
      setError('Settings could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="Notifications" />
      <Group label="This computer">
        <Card>
          <Row
            title="Desktop notification banners"
            description="Your computer's notification permissions also apply."
          >
            <input
              type="checkbox"
              aria-label="Desktop notification banners"
              checked={local?.enabled ?? false}
              disabled={!local || busy}
              onChange={(e) =>
                void save({ ...local!, enabled: e.target.checked })
              }
            />
          </Row>
          <Row
            title="Hide details in banners"
            description="Hidden by default. Case and customer text never appears in banners."
          >
            <input
              type="checkbox"
              aria-label="Hide details in banners"
              checked={local?.hideDetails ?? true}
              disabled={!local || busy}
              onChange={(e) =>
                void save({ ...local!, hideDetails: e.target.checked })
              }
            />
          </Row>
        </Card>
      </Group>
      {/* Builds without the account service have no account preferences. */}
      {account.error?.code !== 'not-configured' && (
        <Group label="Your account">
          <Card>
            {c.value && context.accountId ? (
              Object.entries(labels).map(([key, label]) => (
                <Row key={key} title={label}>
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={
                      // An older account service omits newer categories; they default on.
                      c.value!.preferences[key as keyof typeof labels] ?? true
                    }
                    disabled={c.busy}
                    onChange={(e) =>
                      void c.preferences({
                        ...c.value!.preferences,
                        [key]: e.target.checked,
                      })
                    }
                  />
                </Row>
              ))
            ) : (
              <Row
                title="Select a team workspace"
                description="Account notification preferences sync across your devices."
              />
            )}
          </Card>
        </Group>
      )}
      <p className="text-meta text-ink-3">
        Notifications appear in Supahelp and, when enabled, desktop banners
        while the app is running. No email is sent.
      </p>
      {(error || c.error) && (
        <p role="alert" className="text-bad">
          {error ?? c.error}
        </p>
      )}
    </>
  );
}
