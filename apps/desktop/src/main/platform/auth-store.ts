import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type Encryption = {
  isEncryptionAvailable(): boolean | Promise<boolean>;
  encryptString(value: string): Buffer | Promise<Buffer>;
  decryptString(value: Buffer): string | Promise<string>;
};
export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  subject: string;
  sessionId: string;
  expiresAt: number;
};

export class AuthStore {
  private file: string;
  private encryption: Encryption;
  private writing: Promise<void> = Promise.resolve();
  constructor(file: string, encryption: Encryption) {
    this.file = file;
    this.encryption = encryption;
  }
  async assertAvailable() {
    if (!(await this.encryption.isEncryptionAvailable()))
      throw Error('Secure credential storage is unavailable.');
  }
  async load(): Promise<StoredSession | undefined> {
    await this.writing;
    let bytes: Buffer;
    try {
      bytes = await readFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await this.assertAvailable();
    const value = JSON.parse(await this.encryption.decryptString(bytes));
    for (const key of ['accessToken', 'refreshToken', 'subject', 'sessionId']) {
      if (
        !value ||
        typeof value[key] !== 'string' ||
        !value[key] ||
        value[key].length > 16_384
      )
        throw Error('Account credentials could not be read. Sign in again.');
    }
    if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0)
      throw Error('Account credentials could not be read. Sign in again.');
    return {
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
      subject: value.subject,
      sessionId: value.sessionId,
      expiresAt: value.expiresAt,
    };
  }
  save(session: StoredSession): Promise<void> {
    return this.serialize(async () => {
      await this.assertAvailable();
      const bytes = await this.encryption.encryptString(
        JSON.stringify(session),
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
  }
  clear(): Promise<void> {
    return this.serialize(() => rm(this.file, { force: true }));
  }
  private serialize(run: () => Promise<void>): Promise<void> {
    const result = this.writing.then(run);
    this.writing = result.catch(() => {});
    return result;
  }
}
