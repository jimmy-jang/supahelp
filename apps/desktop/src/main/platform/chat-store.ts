import { access, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { Encryption } from './auth-store';
import { EncryptedStore, syncDirectory } from './encrypted-store.ts';

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export class ChatStore extends EncryptedStore {
  static async open(directory: string, scope: string, encryption: Encryption) {
    const legacyFile = join(directory, 'team.db');
    const file = join(directory, 'chats.db');
    if (await exists(legacyFile)) {
      if (await exists(file)) throw Error('chat-storage');
      const legacy = await super.open(
        directory,
        scope,
        encryption,
        'team.db',
        'chat-storage',
      );
      try {
        // Verify ciphertext before moving; closing the last connection checkpoints its WAL.
        legacy.list('chat/');
      } finally {
        legacy.close();
      }
      await rename(legacyFile, file);
      await syncDirectory(directory);
    }
    return super.open(directory, scope, encryption, 'chats.db', 'chat-storage');
  }
}
