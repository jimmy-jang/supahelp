import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  ConnectionAccess,
  ConnectionAction,
} from '../../contracts/connections';
// Credentials and action receipts share one atomic, OS-encrypted file.
export class ConnectionStore<
  T extends { access: ConnectionAccess; actions: ConnectionAction[] },
> {
  private file: string;
  private encryption: {
    isEncryptionAvailable(): boolean | Promise<boolean>;
    encryptString(value: string): Buffer | Promise<Buffer>;
    decryptString(value: Buffer): string | Promise<string>;
  };
  constructor(
    file: string,
    encryption: {
      isEncryptionAvailable(): boolean | Promise<boolean>;
      encryptString(value: string): Buffer | Promise<Buffer>;
      decryptString(value: Buffer): string | Promise<string>;
    },
  ) {
    this.file = file;
    this.encryption = encryption;
  }
  async load(): Promise<T | undefined> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!(await this.encryption.isEncryptionAvailable()))
      throw Error('Secure credential storage is unavailable.');
    const value = JSON.parse(await this.encryption.decryptString(bytes)) as T;
    if (
      !value ||
      !['read', 'write'].includes(value.access) ||
      !Array.isArray(value.actions)
    )
      throw Error('Connection data could not be read.');
    return value;
  }
  async remove() {
    await rm(this.file, { force: true });
  }
  async save(value: T, { flush = false }: { flush?: boolean } = {}) {
    if (!(await this.encryption.isEncryptionAvailable()))
      throw Error('Secure credential storage is unavailable.');
    const bytes = await this.encryption.encryptString(JSON.stringify(value));
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flush });
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
