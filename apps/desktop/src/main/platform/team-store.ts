import type { Encryption } from './auth-store';
import { EncryptedStore } from './encrypted-store.ts';

export class TeamStore extends EncryptedStore {
  documentsChanged?: (changes: ReadonlyMap<string, unknown>) => void;
  private changes?: Map<string, unknown>;

  private recordChange(key: string, value?: unknown) {
    if (!/^(?:d|draft|q)\//.test(key)) return;
    if (this.changes) this.changes.set(key, value);
    else this.documentsChanged?.(new Map([[key, value]]));
  }

  override put(id: string, value: unknown) {
    super.put(id, value);
    this.recordChange(id, value);
  }

  override remove(id: string) {
    super.remove(id);
    this.recordChange(id);
  }

  override transaction<T>(run: () => T): T {
    const changes = new Map<string, unknown>();
    this.changes = changes;
    let result;
    try {
      result = super.transaction(run);
    } finally {
      this.changes = undefined;
    }
    if (changes.size) this.documentsChanged?.(changes);
    return result;
  }

  static async open(directory: string, scope: string, encryption: Encryption) {
    return super.open(
      directory,
      scope,
      encryption,
      'team.db',
      'sync-locked',
    ) as Promise<TeamStore>;
  }
}
