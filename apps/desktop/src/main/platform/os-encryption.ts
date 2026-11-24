import { safeStorage } from 'electron';

export const encryption = {
  isEncryptionAvailable: async () =>
    (await safeStorage.isAsyncEncryptionAvailable()) &&
    (process.platform !== 'linux' ||
      safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  encryptString: (value: string) => safeStorage.encryptStringAsync(value),
  decryptString: async (value: Buffer) =>
    (await safeStorage.decryptStringAsync(value)).result,
};
