import { randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { Encryption } from './auth-store';
import { syncDirectory } from './encrypted-store.ts';
import { ConnectionStore } from './connection-store.ts';
import { personalDirectory } from './personal-workspace.ts';
import { ChatStore } from './chat-store.ts';
import { CaseStore } from '../features/cases/store.ts';
import { screenshotIds } from '../../contracts/playbook-markdown.ts';

async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function snapshot(source: string, destination: string) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    if (
      db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw Error('Previous local storage needs repair.');
    await backup(db, destination);
  } finally {
    db.close();
  }
  await chmod(destination, 0o600);
}

type Assignment = {
  access: 'read';
  actions: [];
  owner: string;
  id: string;
  done: boolean;
};
export class PersonalRecovery {
  private root: string;
  private encryption: Encryption;
  private assignment: ConnectionStore<Assignment>;
  constructor(root: string, encryption: Encryption) {
    this.root = root;
    this.encryption = encryption;
    this.assignment = new ConnectionStore(
      join(root, 'personal', 'legacy-assignment.enc'),
      encryption,
    );
  }
  async available() {
    if (await this.assignment.load()) return false;
    return (
      (await exists(join(this.root, 'cases.db'))) ||
      (await exists(join(this.root, 'chats')))
    );
  }
  private async empty(directory: string) {
    const file = join(directory, 'cases.db');
    if (await exists(file)) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        for (const row of db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'workspaces'",
          )
          .all()) {
          const table = String(row.name).replaceAll('"', '""');
          if (db.prepare(`SELECT 1 FROM "${table}" LIMIT 1`).get())
            throw Error('Recovery needs an empty personal workspace.');
        }
      } finally {
        db.close();
      }
    }
    if (await exists(join(directory, 'chats', 'chats.db'))) {
      const store = await ChatStore.open(
        join(directory, 'chats'),
        'local-chats',
        this.encryption,
      );
      try {
        if (store.list('chat/').length)
          throw Error('Recovery needs an empty personal workspace.');
      } finally {
        store.close();
      }
    }
    if (
      (await exists(join(directory, 'projects.json'))) &&
      JSON.parse(await readFile(join(directory, 'projects.json'), 'utf8'))
        .length
    )
      throw Error('Recovery needs an empty personal workspace.');
    if (
      (
        await readdir(join(directory, 'playbook-screenshots')).catch(() => [])
      ).some((name) => name.endsWith('.png'))
    )
      throw Error('Recovery needs an empty personal workspace.');
  }
  async resume(accountId: string) {
    const assignment = await this.assignment.load();
    if (assignment && !assignment.done && assignment.owner === accountId)
      await this.finish(assignment, () => {});
  }
  private async saveAssignment(value: Assignment) {
    // Flush the encrypted claim before publishing the recovered data.
    await this.assignment.save(value, { flush: true });
    await syncDirectory(join(this.root, 'personal'));
  }

  private async finish(assignment: Assignment, guard: () => void) {
    const target = personalDirectory(this.root, assignment.owner),
      stage = `${target}.recovering`,
      previous = `${target}.before-recovery`;
    if (await exists(stage)) {
      guard();
      if (await exists(target)) {
        if (await exists(previous))
          throw Error('Recovery needs checking before retry.');
        await rename(target, previous);
      }
      guard();
      await rename(stage, target);
    }
    if ((await readFile(join(target, 'recovery-id'), 'utf8')) !== assignment.id)
      throw Error('Recovery needs checking before retry.');
    await syncDirectory(dirname(target));
    guard();
    await this.saveAssignment({ ...assignment, done: true });
  }
  async restore(
    accountId: string,
    guard: () => void,
    close: () => Promise<void>,
  ) {
    const prior = await this.assignment.load();
    if (prior) {
      if (prior.owner !== accountId || prior.done)
        throw Error('Previous local work has already been assigned.');
      await close();
      guard();
      return this.finish(prior, guard);
    }
    if (!(await this.available()))
      throw Error('No previous local work was found.');
    const target = personalDirectory(this.root, accountId),
      stage = `${target}.recovering`;
    await this.empty(target);
    guard();
    await rm(stage, { recursive: true, force: true });
    await mkdir(join(stage, 'chats'), { recursive: true, mode: 0o700 });
    const cases = join(this.root, 'cases.db');
    if (await exists(cases)) {
      await snapshot(cases, join(stage, 'cases.db'));
      if (await exists(`${cases}.recovery.enc`))
        await copyFile(
          `${cases}.recovery.enc`,
          join(stage, 'cases.db.recovery.enc'),
        );
      const store = new CaseStore(join(stage, 'cases.db'));
      try {
        await store.recover(this.encryption, guard);
        if (store.ready)
          for (const book of store.books.playbooks())
            for (const content of [
              book.draft,
              book.published,
              ...(book.history ?? []).map((h) => h.content),
            ])
              for (const id of content ? screenshotIds(content.markdown) : [])
                if (
                  !(await exists(
                    join(
                      this.root,
                      'playbook-screenshots',
                      `${book.id}_${id}.png`,
                    ),
                  ))
                )
                  throw Error('A previous Playbook screenshot is missing.');
      } finally {
        store.close();
      }
    }
    for (const name of ['chats.db', 'team.db']) {
      const source = join(this.root, 'chats', name);
      if (await exists(source))
        await snapshot(source, join(stage, 'chats', name));
    }
    if (await exists(join(this.root, 'chats', 'key.enc')))
      await copyFile(
        join(this.root, 'chats', 'key.enc'),
        join(stage, 'chats', 'key.enc'),
      );
    const chats = await ChatStore.open(
      join(stage, 'chats'),
      'local-chats',
      this.encryption,
    );
    try {
      chats.list('chat/');
    } finally {
      chats.close();
    }
    for (const name of ['projects.json', 'playbook-screenshots'])
      if (await exists(join(this.root, name)))
        await cp(join(this.root, name), join(stage, name), {
          recursive: true,
          dereference: false,
        });
    const assignment: Assignment = {
      access: 'read',
      actions: [],
      owner: accountId,
      id: randomUUID(),
      done: false,
    };
    await writeFile(join(stage, 'recovery-id'), assignment.id, {
      mode: 0o600,
      flush: true,
    });
    guard();
    await close();
    guard();
    await this.empty(target);
    guard();
    await this.saveAssignment(assignment);
    await this.finish(assignment, guard);
  }
}
