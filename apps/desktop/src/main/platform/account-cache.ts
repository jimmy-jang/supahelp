import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AccountView } from '../../contracts/accounts';
import type { Encryption } from './auth-store';
export type CachedAccount = { subject: string; at: number; view: AccountView };
export class AccountCache {
  private writing: Promise<void> = Promise.resolve();
  private file: string;
  private encryption: Encryption;
  constructor(file: string, encryption: Encryption) {
    this.file = file;
    this.encryption = encryption;
  }
  async load(): Promise<CachedAccount | undefined> {
    await this.writing;
    try {
      if (!(await this.encryption.isEncryptionAvailable())) return;
      const data = JSON.parse(
        await this.encryption.decryptString(await readFile(this.file)),
      );
      if (
        !data ||
        typeof data.subject !== 'string' ||
        !Number.isSafeInteger(data.at) ||
        !/^[a-f0-9-]{36}$/.test(data.view?.account?.id) ||
        !Array.isArray(data.view?.workspaces) ||
        !Array.isArray(data.view?.organizations) ||
        data.view.workspaces.length > 1000
      )
        return;
      return data;
    } catch {
      return;
    }
  }
  save(value: CachedAccount) {
    return this.serialize(() => this.write(value));
  }
  private async write(value: CachedAccount) {
    if (!(await this.encryption.isEncryptionAvailable()))
      throw Error('sync-locked');
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(
      `${this.file}.tmp`,
      await this.encryption.encryptString(JSON.stringify(value)),
      { mode: 0o600, flush: true },
    );
    await rename(`${this.file}.tmp`, this.file);
  }
  clear() {
    return this.serialize(async () => {
      await rm(this.file, { force: true });
      await rm(`${this.file}.tmp`, { force: true });
    });
  }
  private serialize(run: () => Promise<void>) {
    const result = this.writing.then(run);
    this.writing = result.catch(() => {});
    return result;
  }
}
