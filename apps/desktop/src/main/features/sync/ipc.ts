import type { IpcMain } from 'electron';
import type { ContextStamp } from '../../../contracts/accounts';
import type { ModelSelection } from '../../../contracts/chat';
import { publicCaseError } from '../cases/errors.ts';
import type { CaseService } from '../cases/service';
import type { SyncService } from './service';

// The outer scopedFeatureIpc verifies the frame; each operation also pins its context.
export function registerSyncIpc(
  ipc: Pick<IpcMain, 'handle'>,
  cases: CaseService,
  sync: SyncService,
  selection: () => Promise<ModelSelection>,
) {
  for (const channel of ['sync:flag', 'sync:correct'])
    ipc.handle(channel, async (_event, input) => {
      try {
        if (
          !input ||
          typeof input !== 'object' ||
          Object.keys(input).sort().join(',') !==
            (channel === 'sync:flag'
              ? 'context,id'
              : 'context,id,text,title') ||
          !/^[a-f0-9-]{36}$/.test(input.id)
        )
          throw Error('invalid-entry');
        const context = input.context as ContextStamp;
        cases.assertContext(context);
        await sync.activate(context);
        cases.assertContext(context);
        if (channel === 'sync:flag') sync.queue('flag', input.id);
        else {
          if (
            sync.guard(true).role !== 'admin' ||
            typeof input.title !== 'string' ||
            typeof input.text !== 'string' ||
            input.title.length > 120 ||
            input.text.length > 32000
          )
            throw Error('reserved-field');
          const metadata = await sync.privacy(input.id);
          const clean = await cases.mask(
            [
              { id: 'title', text: input.title },
              { id: 'text', text: input.text },
            ],
            {
              context,
              signal: cases.operationSignal(),
              selection: await selection(),
            },
          );
          cases.assertContext(context);
          sync.queue('remediate', input.id, {
            generation: metadata.generation,
            base: metadata.version,
            title: clean[0].text,
            ...(metadata.kind === 'case'
              ? {
                  value: {
                    section: 'summary',
                    kind: 'text',
                    text: clean[1].text,
                  },
                }
              : { content: { title: clean[0].text, markdown: clean[1].text } }),
          });
        }
        await sync.sync();
        cases.assertContext(context);
        return { ok: true, value: sync.snapshot() };
      } catch (error) {
        return { ok: false, error: publicCaseError(error) };
      }
    });
  for (const channel of ['sync:status', 'sync:now', 'sync:create-case'])
    ipc.handle(channel, async (_event, input) => {
      try {
        if (
          !input ||
          typeof input !== 'object' ||
          Object.keys(input).join(',') !== 'context'
        )
          throw Error('case-context');
        const context = (input as { context: ContextStamp }).context;
        cases.assertContext(context);
        if (context.context.kind !== 'team') throw Error('case-context');
        await sync.activate(context);
        cases.assertContext(context);
        if (channel === 'sync:now') await sync.sync();
        if (channel === 'sync:create-case') {
          const op = {
            context,
            signal: cases.operationSignal(),
            selection: await selection(),
          };
          const [title] = await cases.mask(
            [{ id: 'title', text: 'Untitled case' }],
            op,
          );
          const id = cases.team!.create(title.text, op);
          await sync.sync();
          cases.assertContext(context);
          return { ok: true, value: id };
        }
        cases.assertContext(context);
        return { ok: true, value: sync.snapshot() };
      } catch (error) {
        return { ok: false, error: publicCaseError(error) };
      }
    });
}
