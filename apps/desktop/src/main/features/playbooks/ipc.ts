import { documentId } from '../../../contracts/document-id.ts';
import type { BrowserWindow, IpcMain } from 'electron';
import {
  playbookMarkdown,
  safePlaybookLink,
  screenshotIds,
  screenshotReference,
} from '../../../contracts/playbook-markdown.ts';
import type { DocumentRequest } from '../../../contracts/playbooks';
import { isTrustedSender } from '../../ipc/trusted-sender.ts';
import type { PlaybookScreenshots } from '../../platform/playbook-screenshots';
import { publicCaseError } from '../cases/errors.ts';
import { documentContent } from './validation.ts';
import type { ResolveService } from '../cases/resolve';
import type { CaseOperation, CaseService } from '../cases/service';

import type { ChatModels } from '../chat/models';
import type { ChatService } from '../chat/service';
import type { ZendeskConnector } from '../zendesk/service';
import { exportPlaybook } from './export.ts';
import type { PlaybookService } from './service';

// Logs field names and lengths only: draft text may contain case details.
function rejectedDraft(kind: string, reply: unknown) {
  console.warn('[document-draft] rejected reply', {
    kind,
    fields:
      reply && typeof reply === 'object'
        ? Object.fromEntries(
            Object.entries(reply).map(([k, v]) => [
              k,
              typeof v === 'string' ? v.length : typeof v,
            ]),
          )
        : typeof reply,
  });
  return Error('document-draft-invalid');
}

export function registerPlaybooksIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | undefined,
  location: string,
  cases: CaseService,
  books: PlaybookService,
  resolve: ResolveService,
  models: ChatModels,
  chats: ChatService,
  screenshots: PlaybookScreenshots,
  chooseImage: () => Promise<string | undefined>,
  zendesk?: ZendeskConnector,
  files?: {
    chooseExport(title: string): Promise<string | undefined>;
    openLink(url: string): Promise<void>;
    copyMarkdown?(markdown: string): void;
  },
) {
  const prepared = screenshots.prepare();
  let recovered: Promise<void> | undefined;
  books.screenshotAllowed = (book, id) => screenshots.allowed(book, id);
  ipc.handle('playbooks:cancel', async (event, value) => {
    if (!isTrustedSender(event, getWindow()?.webContents, location))
      return { ok: false, error: 'This window cannot access local documents.' };
    try {
      if (!value || Object.keys(value).join(',') !== 'context')
        throw Error('invalid-entry');
      cases.assertContext(value.context);
      cases.cancelPending();
      models.cancelMasking();
      screenshots.clear();
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: publicCaseError(error) };
    }
  });
  const handle = (
    channel: string,
    keys: string[],
    run: (a: DocumentRequest, op: CaseOperation) => unknown,
  ) =>
    ipc.handle(channel, async (event, value) => {
      if (!isTrustedSender(event, getWindow()?.webContents, location))
        return {
          ok: false,
          error: 'This window cannot access local documents.',
        };
      try {
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).some((k) => !['context', ...keys].includes(k))
        )
          throw Error('invalid-entry');
        const a = value as DocumentRequest;
        cases.assertContext(a.context);
        const op: CaseOperation = {
          context: a.context,
          signal: cases.operationSignal(),
        };
        await cases.prepare(op);
        books.guard(op);
        await prepared;
        books.guard(op);
        if (a.context.context.kind === 'personal')
          recovered ??= screenshots.collect(
            new Set(
              books
                .list(op)
                .flatMap((p) =>
                  [
                    p.draft,
                    p.published,
                    ...(p.history ?? []).map((h) => h.content),
                  ].flatMap((c) =>
                    c
                      ? screenshotIds(c.markdown).map(
                          (id) => `${p.id}_${id}.png`,
                        )
                      : [],
                  ),
                ),
            ),
          );
        await recovered;
        books.guard(op);
        const result = await run(a, op);
        books.guard(op);
        return { ok: true, value: result };
      } catch (error) {
        return { ok: false, error: publicCaseError(error) };
      }
    });
  const selected = async (a: DocumentRequest, op: CaseOperation) => {
    const chat = a.chatId
      ? chats.snapshot().chats.find((c) => c.id === a.chatId)
      : undefined;
    if (a.chatId && (!chat || cases.caseForChat(chat.id) !== a.caseId))
      throw Error('unknown-chat');
    if (chat && chat.status !== 'idle') throw Error('case-turn-ended');
    const selection =
      chat?.options?.selection ?? (await models.settings()).selected;
    return {
      ...op,
      selection,
      guard: () => {
        if (chat && cases.caseForChat(chat.id) !== a.caseId)
          throw Error('case-context');
        if (
          chat &&
          chats.snapshot().chats.find((c) => c.id === chat.id)?.status !==
            'idle'
        )
          throw Error('case-turn-ended');
      },
    };
  };
  handle('playbooks:list', [], (_a, op) => books.snapshot(op));
  handle('playbooks:search', ['text', 'caseId'], (a, op) =>
    books.search(a.text, a.caseId, op),
  );
  handle('playbooks:openLink', ['text'], async (a) => {
    const url = typeof a.text === 'string' && safePlaybookLink(a.text);
    if (!url || !files) throw Error('invalid-entry');
    await files.openLink(url);
  });
  const exportBook = async (a: DocumentRequest, op: CaseOperation) => {
    const p = books.read(a.id!, op);
    const guard = () => {
      books.guard(op);
      if (op.context.context.kind === 'team') cases.team!.sync.exportGuard();
      if (books.read(p.id, op).version !== a.version)
        throw Error('case-changed');
    };
    guard();
    const content = p.draft ?? p.published;
    if (!content || !files) throw Error('invalid-entry');
    const path = await files.chooseExport(content.title);
    guard();
    if (!path) return false;
    try {
      await exportPlaybook(
        path,
        content,
        async (id) => {
          const shot = await screenshots.read(p.id, id);
          if (!shot.confirmed) throw Error('invalid-screenshot');
          return Buffer.from(shot.data.split(',')[1], 'base64');
        },
        guard,
      );
    } catch (error) {
      guard();
      if (error instanceof Error && error.message === 'invalid-screenshot')
        throw error;
      throw Error('playbook-export-failed');
    }
    return true;
  };
  handle('playbooks:export', ['id', 'version'], exportBook);
  handle('playbooks:saveDraft', ['id', 'version', 'content'], async (a, op) =>
    books.save(a.id, a.version!, a.content, {
      ...op,
      selection: (await models.settings()).selected,
    }),
  );
  const publishBook = async (a: DocumentRequest, op: CaseOperation) => {
    const p = books.read(a.id!, op);
    for (const id of screenshotIds(p.draft?.markdown ?? ''))
      await screenshots.read(p.id, id);
    books.guard(op);
    const result = books.publish(p.id, a.version!, op);
    chats.refreshTools();
    return result;
  };
  handle('playbooks:publish', ['id', 'version'], publishBook);
  const discardDraft = (a: DocumentRequest, op: CaseOperation) => {
    books.discard(a.id!, a.version!, op);
    screenshots.discardBook(a.id!);
    return true;
  };
  handle('playbooks:discardDraft', ['id', 'version'], discardDraft);
  const chooseScreenshot = async (a: DocumentRequest, op: CaseOperation) => {
    const p = books.read(a.id!, op);
    if (!p.draft) throw Error('no-draft');
    const path = await chooseImage();
    books.guard(op);
    if (!path) return;
    const data = await screenshots.bytes(path);
    const latest = books.read(p.id, op);
    if (
      !latest.draft ||
      (a.version !== undefined && latest.version !== a.version)
    )
      throw Error('case-changed');
    return screenshots.stage(p.id, data);
  };
  handle('playbooks:chooseScreenshot', ['id'], chooseScreenshot);
  const removeBook = async (a: DocumentRequest, op: CaseOperation) => {
    const id = documentId(a.id);
    const attached = chats
      .snapshot()
      .chats.filter((chat) => chat.playbookIds?.includes(id));
    if (attached.some((chat) => chat.status !== 'idle'))
      throw Error('remove-running');
    books.remove(id, a.version!, op);
    for (const chat of attached) {
      const remaining = chat.playbookIds!.filter((book) => book !== id);
      models.attachPlaybooks(chat.id, remaining);
      chats.setPlaybooks(chat.id, remaining);
      chats.refreshTools(chat.id);
    }
    await screenshots.removeBook(id);
    return true;
  };
  handle('playbooks:remove', ['id', 'version'], removeBook);
  handle('playbooks:screenshot', ['id', 'screenshotId'], async (a, op) => {
    const p = books.read(a.id!, op);
    const preview = await screenshots.read(p.id, a.screenshotId!);
    books.guard(op);
    if (
      preview.confirmed &&
      ![p.draft, p.published, ...(p.history ?? []).map((h) => h.content)].some(
        (c) => c && screenshotIds(c.markdown).includes(a.screenshotId!),
      )
    )
      throw Error('invalid-screenshot');
    return preview;
  });
  const confirmScreenshot = async (a: DocumentRequest, op: CaseOperation) => {
    const p = books.read(a.id!, op);
    if (!p.draft || p.version !== a.version) throw Error('case-changed');
    const content = structuredClone(p.draft);
    await screenshots.confirm(p.id, documentId(a.screenshotId), () => {
      if (books.read(p.id, op).version !== a.version)
        throw Error('case-changed');
    });
    content.markdown += `\n\n![Reviewed screenshot](${screenshotReference(a.screenshotId!)})`;
    return books.save(p.id, p.version, content, {
      ...op,
      selection: (await models.settings()).selected,
    });
  };
  handle(
    'playbooks:confirmScreenshot',
    ['id', 'version', 'screenshotId'],
    confirmScreenshot,
  );
  handle(
    'playbooks:removeScreenshot',
    ['id', 'version', 'screenshotId'],
    async (a, op) => {
      const p = books.read(a.id!, op);
      if (!p.draft || p.version !== a.version) throw Error('case-changed');
      if (a.screenshotId) {
        screenshots.discard(p.id, a.screenshotId);
        return p;
      }
      throw Error('invalid-entry');
    },
  );
  const runningChatActions = new Set<string>();
  handle(
    'chat:playbookAction',
    ['chatId', 'requestId', 'cancel', 'screenshotId'],
    async (a, op) => {
      const chatId = documentId(a.chatId),
        requestId = documentId(a.requestId);
      if (a.cancel !== undefined && typeof a.cancel !== 'boolean')
        throw Error('invalid-entry');
      if (runningChatActions.has(chatId)) throw Error('reply-running');
      const action = chats.getPlaybookAction(chatId, requestId);
      const screenshotId =
        a.screenshotId === undefined ? undefined : documentId(a.screenshotId);
      if (screenshotId !== undefined && action.kind !== 'screenshot')
        throw Error('invalid-entry');
      if (a.cancel) {
        if (screenshotId) screenshots.discard(action.playbookId, screenshotId);
        chats.finishPlaybookAction(chatId, requestId, false);
        return true;
      }
      const target = {
        context: a.context,
        id: action.playbookId,
        version: action.version,
      };
      const p = books.read(target.id, op);
      if (
        !['open', 'saved'].includes(action.kind) &&
        p.version !== target.version
      )
        throw Error('case-changed');
      runningChatActions.add(chatId);
      try {
        const current = {
          ...op,
          guard: () => {
            chats.getPlaybookAction(chatId, requestId);
          },
        };
        switch (action.kind) {
          case 'publish':
            if (!p.draft?.markdown.trim()) throw Error('invalid-entry');
            await publishBook(target, current);
            break;
          case 'discard':
            discardDraft(target, current);
            break;
          case 'delete':
            await removeBook(target, current);
            break;
          case 'export':
            if (!(await exportBook(target, current))) return;
            break;
          case 'copy': {
            const content = p.draft ?? p.published;
            if (!files?.copyMarkdown || !content) throw Error('invalid-entry');
            books.guard(current);
            files.copyMarkdown(playbookMarkdown(content));
            break;
          }
          case 'screenshot':
            if (!screenshotId) return await chooseScreenshot(target, current);
            await confirmScreenshot({ ...target, screenshotId }, current);
            break;
        }
        books.guard(op);
        chats.finishPlaybookAction(chatId, requestId, true);
        return true;
      } finally {
        runningChatActions.delete(chatId);
      }
    },
  );
  const checkPlaybooks = (ids: unknown, op: CaseOperation): string[] => {
    if (
      !Array.isArray(ids) ||
      ids.length > 5 ||
      ids.some((id) => typeof id !== 'string') ||
      new Set(ids).size !== ids.length
    )
      throw Error('invalid-entry');
    for (const id of ids)
      if (!books.read(id, op).published) throw Error('unknown-playbook');
    return ids;
  };
  handle('chat:create', ['caseId', 'playbookIds', 'text'], (a, op) => {
    if (typeof a.text !== 'string' || a.text.length > 12000)
      throw Error('invalid-entry');
    const ids = checkPlaybooks(a.playbookIds ?? [], op);
    const kase = a.caseId === undefined ? undefined : cases.read(a.caseId, op);
    const chatId = chats.createLocalChat(
      a.text.trim().slice(0, 48) || 'New chat',
    );
    let linked = false;
    try {
      if (kase) {
        cases.linkChat(kase.id, chatId, op);
        linked = true;
      }
      models.attachPlaybooks(chatId, ids);
      chats.setPlaybooks(chatId, ids);
      return chatId;
    } catch (error) {
      if (linked) cases.unlinkChat(kase!.id, chatId, op);
      models.attachPlaybooks(chatId, []);
      chats.remove(chatId);
      cases.emit();
      throw error;
    }
  });
  handle('chat:setPlaybooks', ['chatId', 'playbookIds'], (a, op) => {
    const chat = chats.snapshot().chats.find((c) => c.id === a.chatId);
    if (!chat || chat.status !== 'idle') throw Error('invalid-entry');
    const ids = checkPlaybooks(a.playbookIds, op);
    models.attachPlaybooks(chat.id, ids);
    chats.setPlaybooks(chat.id, ids);
    chats.refreshTools(chat.id);
  });
  handle('chat:attachCase', ['chatId', 'caseId'], (a, op) => {
    const chat = chats.snapshot().chats.find((c) => c.id === a.chatId);
    if (!chat || chat.status !== 'idle') throw Error('invalid-entry');
    cases.linkChat(a.caseId!, chat.id, op);
    chats.refreshTools(chat.id);
  });
  handle('chat:detachCase', ['chatId', 'caseId'], (a, op) => {
    const chat = chats.snapshot().chats.find((c) => c.id === a.chatId);
    if (!chat || chat.status !== 'idle') throw Error('invalid-entry');
    cases.unlinkChat(a.caseId!, chat.id, op);
    chats.refreshTools(chat.id);
  });
  handle('cases:resume', ['caseId'], (a, op) => {
    const c = cases.read(a.caseId!, op),
      existing = chats
        .snapshot()
        .chats.find((chat) => c.chatIds.includes(chat.id));
    if (existing) return existing.id;
    const id = chats.createLocalChat();
    cases.linkChat(c.id, id, op);
    return id;
  });
  // One chat per Playbook, draft or published.
  handle('playbooks:resumeChat', ['id'], (a, op) => {
    const book = books.read(a.id!, op),
      content = book.draft ?? book.published;
    if (!content) throw Error('unknown-playbook');
    const existing = chats
      .snapshot()
      .chats.find((c) => c.playbookId === book.id);
    if (existing) return existing.id;
    const chatId = chats.createLocalChat(content.title || 'Playbook', book.id);
    models.attachPlaybooks(chatId, [book.id]);
    chats.setPlaybooks(chatId, [book.id]);
    chats.refreshTools(chatId);
    return chatId;
  });
  handle(
    'cases:draftResolution',
    ['caseId', 'chatId', 'requestId', 'id', 'version', 'text', 'playbookId'],
    async (a, op) => {
      const current = await selected(a, op),
        c = cases.read(a.caseId!, current);
      if (!resolve.canResolve(c, current)) throw Error('resolve-owner');
      if (c.status === 'done') throw Error('case-resolved');
      const existing = resolve.latest(c.id, current);
      const generated = a.text === undefined;
      const id = documentId(
        a.id ?? (generated ? existing?.id : undefined) ?? a.requestId,
      );
      const version =
        a.version ?? (generated ? existing?.version : undefined) ?? 0;
      let text = a.text;
      if (text === undefined) {
        const { changes: _changes, ...currentCase } = c;
        const chat = chats
          .snapshot()
          .chats.find((chat) => chat.id === a.chatId);
        const result = (await models.draftDocument(
          'resolution',
          {
            case: currentCase,
            chat: chat?.messages.filter((m) => m.role !== 'case'),
          },
          current.selection!,
          current.signal,
        )) as { resolution?: unknown };
        if (typeof result?.resolution !== 'string')
          throw rejectedDraft('resolution', result);
        text = result.resolution;
      }
      if (JSON.stringify(cases.read(c.id, current)) !== JSON.stringify(c))
        throw Error('case-changed');
      return resolve.save(
        c.id,
        id,
        text,
        generated ? existing?.playbookId : a.playbookId,
        current,
        version,
        generated,
      );
    },
  );
  handle(
    'cases:confirmResolve',
    ['id', 'version', 'chatId', 'cancel'],
    async (a, op) => {
      if (
        !Number.isSafeInteger(a.version) ||
        a.version! < 1 ||
        (a.cancel !== undefined && typeof a.cancel !== 'boolean')
      )
        throw Error('invalid-entry');
      if (a.cancel) {
        chats.dismissResolutionReview(
          documentId(a.chatId),
          documentId(a.id),
          a.version!,
        );
        return;
      }
      const r = resolve.read(a.id!, op);
      const guard = () => {
        if (a.chatId && cases.caseForChat(a.chatId) !== r.caseId)
          throw Error('case-context');
        const linked = cases.read(r.caseId, op).chatIds;
        if (
          chats
            .snapshot()
            .chats.some((c) => linked.includes(c.id) && c.status !== 'idle')
        )
          throw Error('case-turn-ended');
      };
      guard();
      return resolve.confirm(r.id, a.version!, {
        ...op,
        guard,
        committed: (u) => {
          if (a.chatId && cases.caseForChat(a.chatId) === r.caseId) {
            chats.caseUpdated(a.chatId, u, false);
            chats.dismissResolutionReview(a.chatId, r.id, r.version);
          }
        },
      });
    },
  );
  handle('cases:reopen', ['caseId'], (a, op) => resolve.reopen(a.caseId!, op));
  handle('cases:draftPlaybook', ['id', 'playbookId'], async (a, op) => {
    if (op.context.context.kind === 'team')
      throw Error('sync-unavailable-operation');
    const r = resolve.read(a.id!, op);
    if (!r.committed) throw Error('no-draft');
    if (!a.playbookId) {
      const existing = books.fromCase(r.caseId, op);
      if (existing) return existing;
    }
    const p = a.playbookId ? books.read(a.playbookId, op) : undefined;
    if (p?.draft) throw Error('existing-draft');
    const selection = (await models.settings()).selected;
    const reply = (await models.draftDocument(
      'playbook',
      { resolution: r.text, published: p?.published },
      selection,
      op.signal,
    )) as { title?: unknown; markdown?: unknown } | null;
    // Keep only the fields we asked for; models sometimes add extras.
    const content = { title: reply?.title, markdown: reply?.markdown };
    try {
      documentContent(content);
    } catch {
      throw rejectedDraft('playbook', reply);
    }
    const markdown = content.markdown as string;
    if (
      p?.published &&
      screenshotIds(p.published.markdown).some(
        (id) => !screenshotIds(markdown).includes(id),
      )
    )
      throw Error('document-draft-images');
    return books.save(
      p?.id,
      p?.version ?? 0,
      content,
      { ...op, selection },
      r.caseId,
    );
  });
  handle('cases:proposeResolutionNote', ['id', 'chatId'], async (a, op) => {
    if (op.context.context.kind === 'team')
      throw Error('sync-unavailable-operation');
    const r = resolve.read(a.id!, op),
      c = cases.read(r.caseId, op);
    if (
      !r.committed ||
      !zendesk ||
      c.status !== 'done' ||
      cases.caseForChat(documentId(a.chatId)) !== c.id ||
      !chats
        .snapshot()
        .chats.some((chat) => chat.id === a.chatId && chat.status === 'idle')
    )
      throw Error('note-unavailable');
    const ticket = /^ZD #(\d+)$/.exec(c.ticket);
    if (!ticket) throw Error('note-unavailable');
    if (
      zendesk
        .snapshot()
        .actions.some(
          (action) =>
            action.source?.resolutionId === r.id &&
            !['failed', 'cancelled', 'reviewed'].includes(action.status),
        )
    )
      throw Error('note-existing');
    const guard = () => {
      books.guard(op);
      if (cases.read(c.id, op).status !== 'done') throw Error('case-changed');
    };
    zendesk.resumeChat(a.chatId!);
    let publishPending!: (id: string) => void;
    const pending = new Promise<string>((resolve) => {
      publishPending = resolve;
    });
    const agent = await zendesk.agent(
      a.chatId!,
      { caseId: c.id, resolutionId: r.id },
      guard,
      publishPending,
    );
    if (!agent) throw Error('note-unavailable');
    const result = await agent.call(
      'get_ticket',
      { ticket_id: Number(ticket[1]) },
      op.signal,
    );
    if (result.isError) throw Error('note-unavailable');
    const part = result.content.find((item) => item.type === 'text');
    const read = part?.type === 'text' ? JSON.parse(part.text) : undefined;
    if (read?.id !== Number(ticket[1]) || typeof read.updated_at !== 'string')
      throw Error('note-unavailable');
    guard();
    // The connector persists the exact note and source before approval; this request may finish after the panel closes.
    const submitted = agent.call(
      'add_internal_note',
      {
        ticket_id: Number(ticket[1]),
        body: `What fixed it\n\n${r.text}`,
        updated_stamp: read.updated_at,
      },
      op.signal,
    );
    const actionId = await Promise.race([
      pending,
      submitted.then(() => {
        throw Error('note-unavailable');
      }),
    ]);
    guard();
    r.noteActionId = actionId;
    books.store.saveResolution(r);
    books.emit(op);
  });
}
