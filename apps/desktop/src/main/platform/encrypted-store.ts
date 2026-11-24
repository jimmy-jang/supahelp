import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Encryption } from './auth-store';

// Flush a directory entry (e.g. after rename) to disk. Windows cannot open a directory
// for fsync (EPERM); NTFS journals the rename, so skipping it there is safe.
export async function syncDirectory(directory: string) {
  if (process.platform === 'win32') return;
  const parent = await open(directory, 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

// Only opaque row IDs and authenticated ciphertext reach SQLite, including its WAL.
export class EncryptedStore {
  private db: DatabaseSync;
  private key: Buffer;
  private scope: string;
  private lockedError: string;
  readonly directory: string;
  protected constructor(
    directory: string,
    scope: string,
    key: Buffer,
    filename: string,
    lockedError: string,
  ) {
    this.directory = directory;
    this.scope = scope;
    this.key = key;
    this.lockedError = lockedError;
    this.db = new DatabaseSync(join(directory, filename));
    const version = Number(
      this.db.prepare('PRAGMA user_version').get()?.user_version,
    );
    if (version > 1) {
      this.db.close();
      throw Error(this.lockedError);
    }
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,payload BLOB NOT NULL); PRAGMA user_version=1',
    );
  }
  static async open(
    directory: string,
    scope: string,
    encryption: Encryption,
    filename: string,
    lockedError: string,
  ) {
    if (!(await encryption.isEncryptionAvailable())) throw Error(lockedError);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, 'key.enc');
    let key: Buffer;
    try {
      key = Buffer.from(
        await encryption.decryptString(await readFile(file)),
        'hex',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw Error(lockedError);
      // Missing key beside an existing database is corruption, never generate a replacement.
      try {
        await readFile(join(directory, filename));
        throw Error(lockedError);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      key = randomBytes(32);
      await writeFile(
        `${file}.tmp`,
        await encryption.encryptString(key.toString('hex')),
        {
          mode: 0o600,
          flush: true,
        },
      );
      await rename(`${file}.tmp`, file);
      await syncDirectory(directory);
    }
    if (key.length !== 32) throw Error(lockedError);
    const result = new this(directory, scope, key, filename, lockedError);
    await chmod(join(directory, filename), 0o600);
    return result;
  }
  get<T>(id: string): T | undefined {
    const row = this.db
      .prepare('SELECT payload FROM records WHERE id=?')
      .get(id);
    if (!row) return;
    const bytes = Buffer.from(row.payload as Uint8Array);
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(`${this.scope}/${id}/1`));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString(),
      );
    } catch {
      throw Error(this.lockedError);
    }
  }
  put(id: string, value: unknown) {
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(`${this.scope}/${id}/1`));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    this.db
      .prepare('INSERT OR REPLACE INTO records VALUES(?,?)')
      .run(id, Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]));
  }
  remove(id: string) {
    this.db.prepare('DELETE FROM records WHERE id=?').run(id);
  }
  keys(prefix: string): string[] {
    return this.db
      .prepare('SELECT id FROM records WHERE id>=? AND id<? ORDER BY rowid')
      .all(prefix, `${prefix}\uffff`)
      .map((row) => String(row.id));
  }
  list<T>(prefix: string): T[] {
    return this.keys(prefix).map((id) => this.get<T>(id)!);
  }
  transaction<T>(run: () => T) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  removePrefix(prefix: string) {
    this.db
      .prepare('DELETE FROM records WHERE substr(id,1,?)=?')
      .run(prefix.length, prefix);
  }
  async rotate(encryption: Encryption) {
    const key = randomBytes(32),
      file = join(this.directory, 'key.enc');
    await writeFile(
      `${file}.tmp`,
      await encryption.encryptString(key.toString('hex')),
      {
        mode: 0o600,
        flush: true,
      },
    );
    this.clear();
    await rename(`${file}.tmp`, file);
    await syncDirectory(this.directory);
    this.key.fill(0);
    this.key = key;
  }
  clear() {
    this.db.exec('DELETE FROM records');
  }
  close() {
    if (this.db.isOpen) this.db.close();
    this.key.fill(0);
  }
  async destroy() {
    this.close();
    await rm(this.directory, { recursive: true, force: true });
  }
}
