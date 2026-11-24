import type { IpcMain } from 'electron';
import type { ModelSelection } from '../../../contracts/chat';
import { notificationDefaults } from '../../../contracts/sync.ts';
import type { AccountService } from '../accounts/service';
import { publicCaseError } from '../cases/errors.ts';
import { maskCasePatterns } from '../cases/masking.ts';
import type { CaseService } from '../cases/service';
import type { NotificationDelivery } from '../notifications/service';
import type { SyncService, SyncTransport } from '../sync/service';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const unavailable = 'This case is unavailable or you no longer have access.';
export function registerCollaborationIpc(
  ipc: Pick<IpcMain, 'handle'>,
  cases: CaseService,
  sync: SyncService,
  accounts: AccountService,
  transport: SyncTransport | undefined,
  selection: () => Promise<ModelSelection>,
  notifications: NotificationDelivery,
) {
  const channels = [
    'collaboration',
    'collaborate',
    'answer',
    'check-answer',
    'cancel-answer',
    'read-notification',
    'preferences',
    'banner-settings',
    'resolve-link',
    'clear-link',
    'open-link',
  ];
  for (const kind of channels)
    ipc.handle(`sync:${kind}`, async (_event, input) => {
      try {
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw Error('Invalid request.');
        const allowed: Record<string, string[]> = {
          collaboration: [],
          collaborate: [
            'id',
            'caseId',
            'type',
            'recipientId',
            'ownerRevision',
            'entryId',
            'base',
          ],
          answer: ['id', 'caseId', 'entryId', 'base', 'text'],
          'check-answer': ['id'],
          'cancel-answer': ['id'],
          'read-notification': ['id'],
          preferences: ['preferences'],
          'banner-settings': ['value'],
          'resolve-link': ['id'],
          'clear-link': ['id'],
          'open-link': ['id'],
        };
        if (
          Object.keys(input).some(
            (k) => k !== 'context' && !allowed[kind].includes(k),
          )
        )
          throw Error('Invalid request.');
        accounts.assertCurrentContext(input.context);
        const context = input.context;
        if (kind === 'banner-settings')
          return { ok: true, value: await notifications.settings(input.value) };
        if (kind === 'open-link') {
          if (!uuid(input.id)) throw Error(unavailable);
          await accounts.receiveLink(`supahelp://case/${input.id}`);
          return { ok: true, value: undefined };
        }
        if (kind === 'clear-link') {
          if (!uuid(input.id)) throw Error('Invalid link.');
          accounts.clearCaseLink(input.id);
          return { ok: true, value: undefined };
        }
        if (kind === 'resolve-link') {
          if (!uuid(input.id) || !transport?.lookup || !context.accountId)
            throw Error(unavailable);
          const value = await transport.lookup(
            input.id,
            cases.operationSignal(),
          );
          accounts.assertCurrentContext(context);
          if (
            context.context.kind === 'team' &&
            context.context.workspaceId === value.workspaceId
          ) {
            await sync.activate(context);
            // Only sync when the case isn't cached: a sync is a network round trip.
            if (!sync.cases().some((c) => c.id === value.caseId))
              await sync.sync();
            accounts.assertCurrentContext(context);
            if (!sync.cases().some((c) => c.id === value.caseId))
              throw Error(unavailable);
          }
          return { ok: true, value };
        }
        if (context.context.kind === 'personal') {
          const scope = `${context.accountId ?? 'anonymous'}/personal`;
          if (kind === 'preferences') {
            if (!context.accountId || !transport?.preferences)
              throw Error('Sign in to save account preferences.');
            const value = await transport.preferences(
              input.preferences,
              cases.operationSignal(),
            );
            accounts.assertCurrentContext(context);
            await notifications.preferences(scope, value);
          } else if (kind === 'read-notification') {
            if (typeof input.id !== 'string' || input.id.length > 100)
              throw Error('Invalid notification.');
            if (uuid(input.id) && transport?.readEvent)
              await transport.readEvent('', input.id, cases.operationSignal());
            else await notifications.read(scope, input.id);
          } else if (kind !== 'collaboration')
            throw Error('Select a team workspace.');
          const local = await notifications.local(scope),
            visible = new Set(cases.snapshot().cases.map((c) => c.id));
          let global: {
            events: import('../../../contracts/sync').CaseNotification[];
            preferences: import('../../../contracts/sync').NotificationPreferences;
          } = {
            events: [],
            preferences: local.preferences ?? notificationDefaults,
          };
          if (context.accountId && transport?.allNotifications) {
            try {
              global = await transport.allNotifications(
                cases.operationSignal(),
              );
              accounts.assertCurrentContext(context);
              await notifications.preferences(scope, global.preferences);
              if (kind === 'collaboration')
                await notifications.deliver(
                  `${context.accountId}/team`,
                  global.events,
                  global.preferences,
                );
            } catch {
              accounts.assertCurrentContext(context);
            }
          }
          return {
            ok: true,
            value: {
              members: [],
              candidates: [],
              events: [
                ...global.events,
                ...local.events.filter((e) => visible.has(e.documentId)),
              ],
              preferences: global.preferences,
            },
          };
        }
        if (context.context.kind !== 'team')
          throw Error('Select a team workspace.');
        await sync.activate(context);
        accounts.assertCurrentContext(context);
        if (
          kind !== 'collaboration' &&
          kind !== 'preferences' &&
          !uuid(input.id)
        )
          throw Error('Invalid request ID.');
        if (kind === 'collaborate') {
          if (
            !uuid(input.caseId) ||
            !['bring-in', 'handoff', 'assign-question'].includes(input.type) ||
            (input.recipientId !== undefined && !uuid(input.recipientId)) ||
            (input.type === 'assign-question' &&
              (!uuid(input.entryId) || !Number.isSafeInteger(input.base))) ||
            (input.type !== 'assign-question' &&
              !Number.isSafeInteger(input.ownerRevision))
          )
            throw Error('Invalid case command.');
          const { context: _context, ...command } = input;
          const value = await sync.collaborate(command);
          accounts.assertCurrentContext(context);
          return {
            ok: true,
            value: {
              ...value,
              candidates: value.candidates.map((a) => ({ ...a, text: '' })),
            },
          };
        }
        if (kind === 'answer') {
          if (
            !uuid(input.caseId) ||
            !uuid(input.entryId) ||
            !Number.isSafeInteger(input.base) ||
            typeof input.text !== 'string' ||
            !input.text.trim() ||
            input.text.length > 4000
          )
            throw Error('Enter an answer of 1 to 4000 characters.');
          const lease = sync.guard(),
            e = sync
              .cases()
              .find((c) => c.id === input.caseId)
              ?.entries.find((e) => e.id === input.entryId);
          if (
            !e ||
            e.recipientId !== lease.accountId ||
            e.pill !== 'Open' ||
            e.version !== input.base
          )
            throw Error('The question changed. Refresh it.');
          const candidate = {
            id: input.id,
            documentId: input.caseId,
            entryId: input.entryId,
            base: input.base,
            text: maskCasePatterns(input.text),
            enrollment: lease.enrollment,
          };
          await sync.online((t, w, s) => {
            if (!t.holdAnswer) throw Error('Unavailable');
            return t.holdAnswer(w, candidate, s);
          });
        }
        if (kind === 'check-answer') {
          sync.guard(true);
          const candidate = (await sync.collaboration()).candidates.find(
            (a) => a.id === input.id,
          );
          if (!candidate) throw Error('The answer is no longer pending.');
          const signal = cases.operationSignal();
          const [clean] = await cases.mask(
            [{ id: 'answer', text: candidate.text }],
            {
              context,
              signal,
              selection: await selection(),
            },
          );
          accounts.assertCurrentContext(context);
          signal.throwIfAborted();
          await sync.online((t, w, s) => {
            if (!t.checkAnswer) throw Error('Unavailable');
            return t.checkAnswer(
              w,
              input.id,
              clean.text,
              AbortSignal.any([signal, s]),
            );
          });
          await sync.sync();
        }
        if (kind === 'cancel-answer')
          await sync.online((t, w, s) => {
            if (!t.cancelAnswer) throw Error('Unavailable');
            return t.cancelAnswer(w, input.id, s);
          });
        if (kind === 'read-notification')
          await sync.online((t, w, s) => {
            if (!t.readEvent) throw Error('Unavailable');
            return t.readEvent(w, input.id, s);
          });
        if (kind === 'preferences')
          await sync.online((t, _w, s) => {
            if (!t.preferences) throw Error('Unavailable');
            return t.preferences(input.preferences, s);
          });
        const value = await sync.collaboration();
        accounts.assertCurrentContext(context);
        // Candidate text is private masking input. Only IDs/state reach the renderer.
        await notifications.preferences(
          `${context.accountId}/personal`,
          value.preferences,
        );
        if (kind === 'collaboration')
          await notifications.deliver(
            `${context.accountId}/team`,
            value.events,
            value.preferences,
          );
        return {
          ok: true,
          value: {
            ...value,
            candidates: value.candidates.map((a) => ({ ...a, text: '' })),
          },
        };
      } catch (error) {
        return {
          ok: false,
          error:
            kind === 'resolve-link'
              ? unavailable
              : kind === 'check-answer'
                ? publicCaseError(error)
                : error instanceof Error &&
                    [
                      'The question changed. Refresh it.',
                      'The answer is no longer pending.',
                      'Enter an answer of 1 to 4000 characters.',
                      'Select a team workspace.',
                      'Sign in to save account preferences.',
                    ].includes(error.message)
                  ? error.message
                  : 'Shared work is unavailable or changed. Refresh and review it.',
        };
      }
    });
}
