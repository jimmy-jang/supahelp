import type { Encryption } from './auth-store';
import { EncryptedStore } from './encrypted-store.ts';

export class TeamStore extends EncryptedStore {
  static async open(directory: string, scope: string, encryption: Encryption) {
    return super.open(directory, scope, encryption, 'team.db', 'sync-locked');
  }
}
