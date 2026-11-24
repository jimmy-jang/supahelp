import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Encryption } from './auth-store.ts';

export class LocalAccess {
  private file: string;
  private encryption: Encryption;
  private owners: Record<
    string,
    { owner: string | null | false; pending?: string }
  > = {};
  private denyUnclaimed = false;
  private loaded: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  constructor(file: string, encryption: Encryption) {
    this.file = file;
    this.encryption = encryption;
    this.loaded = this.load();
  }
  private async load() {
    try {
      const bytes = await readFile(this.file);
      if (!(await this.encryption.isEncryptionAvailable())) throw Error();
      const data = JSON.parse(await this.encryption.decryptString(bytes));
      if (
        data.version !== 1 ||
        typeof data.denyUnclaimed !== 'boolean' ||
        !data.owners ||
        typeof data.owners !== 'object' ||
        Array.isArray(data.owners)
      )
        throw Error();
      for (const [key, value] of Object.entries(data.owners)) {
        if (
          !/^[a-z0-9:-]{1,100}$/.test(key) ||
          !value ||
          typeof value !== 'object' ||
          !('owner' in value) ||
          (value.owner !== false &&
            value.owner !== null &&
            typeof value.owner !== 'string')
        )
          throw Error();
      }
      this.owners = data.owners;
      this.denyUnclaimed = data.denyUnclaimed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.denyUnclaimed = true;
    }
  }
  async allows(capability: string, accountId: string | null): Promise<boolean> {
    await this.loaded;
    await this.writing;
    const entry = this.owners[capability];
    return entry
      ? entry.owner === accountId && !entry.pending
      : !this.denyUnclaimed && accountId === null;
  }
  async block(capability: string): Promise<string> {
    const id = randomUUID();
    await this.change(() => {
      this.owners[capability] = { owner: false, pending: id };
    });
    return id;
  }
  async bindAfterConnection(
    capability: string,
    accountId: string | null,
    pending?: string,
  ): Promise<void> {
    await this.change(() => {
      if (pending && this.owners[capability]?.pending !== pending) return;
      this.owners[capability] = { owner: accountId };
    });
  }
  private async change(run: () => void) {
    await this.loaded;
    const result = this.writing.then(async () => {
      if (!(await this.encryption.isEncryptionAvailable()))
        throw Error('Secure credential storage is unavailable.');
      run();
      const bytes = await this.encryption.encryptString(
        JSON.stringify({
          version: 1,
          denyUnclaimed: this.denyUnclaimed,
          owners: this.owners,
        }),
      );
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, this.file);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.writing = result.catch(() => {
      this.denyUnclaimed = true;
      this.owners = {};
    });
    return result;
  }
}
