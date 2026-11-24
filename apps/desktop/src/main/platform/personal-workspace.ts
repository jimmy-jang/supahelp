import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseService } from '../features/cases/service';
import type { ChatService } from '../features/chat/service';
import type { ChatModels } from '../features/chat/models';
import type { Encryption } from './auth-store';
import type { ChatResources } from './chat-resources';
import type { PlaybookScreenshots } from './playbook-screenshots';
import type { PersonalRecovery } from './personal-workspace-recovery';
import { ChatStore } from './chat-store.ts';

export function personalDirectory(root: string, accountId: string | null) {
  if (accountId === null) return join(root, 'personal', 'guest');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      accountId,
    )
  )
    throw Error('account-access');
  return join(root, 'personal', 'accounts', accountId);
}

export class PersonalWorkspace {
  private accountId: string | null | undefined;
  private writing: Promise<void> = Promise.resolve();
  private options: {
    root: string;
    encryption: Encryption;
    cases: CaseService;
    chats: ChatService;
    models: ChatModels;
    resources: ChatResources;
    screenshots: PlaybookScreenshots;
    chatStore: ChatStore;
    recovery?: PersonalRecovery;
  };
  constructor(options: PersonalWorkspace['options']) {
    this.options = options;
  }

  activate(accountId: string | null): Promise<void> {
    const directory = personalDirectory(this.options.root, accountId);
    const result = this.writing.then(async () => {
      if (this.accountId === accountId) return;
      this.accountId = undefined;
      const o = this.options;
      if (accountId) await o.recovery?.resume(accountId);
      o.cases.cancelPending();
      o.models.resetWorkspace();
      await o.chats.close();
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const store = await ChatStore.open(
        join(directory, 'chats'),
        'local-chats',
        o.encryption,
      );
      try {
        await o.chats.activate(store);
        await o.cases.activate(join(directory, 'cases.db'));
        o.resources.activate(join(directory, 'projects.json'));
        await o.screenshots.activate(join(directory, 'playbook-screenshots'));
      } catch (error) {
        store.close();
        throw error;
      }
      o.chatStore.close();
      o.chatStore = store;
      for (const chat of o.chats.snapshot().chats)
        o.models.attachPlaybooks(chat.id, chat.playbookIds ?? []);
      this.accountId = accountId;
    });
    this.writing = result.catch(() => {});
    return result;
  }
  restore(accountId: string, guard: () => void) {
    const result = this.writing.then(async () => {
      if (this.accountId !== accountId || !this.options.recovery)
        throw Error('account-access');
      const o = this.options;
      await o.chats.close();
      if (o.chats.snapshot().chats.length)
        throw Error('Recovery needs an empty personal workspace.');
      await o.recovery!.restore(accountId, guard, async () => {
        this.accountId = undefined;
        o.models.resetWorkspace();
        o.cases.cancelPending();
        await o.chats.close();
        o.cases.store.close();
        o.chatStore.close();
        this.accountId = undefined;
      });
    });
    this.writing = result.catch(() => {});
    return result;
  }
  close() {
    this.options.chatStore.close();
  }
}
