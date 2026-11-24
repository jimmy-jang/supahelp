import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const key = randomBytes(32);
export const encryption = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  },
  decryptString(value) {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      value.subarray(0, 12),
    );
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([
      decipher.update(value.subarray(28)),
      decipher.final(),
    ]).toString('utf8');
  },
};
export const personalContext = () => ({
  generation: 1,
  accountId: null,
  context: { kind: 'personal' },
});
export const caseOperation = (context = personalContext()) => ({
  context,
  selection: { provider: 'claude', model: 'fixture-model' },
  signal: new AbortController().signal,
});
export function caseEnvironment() {
  let context = personalContext();
  const prompts = [];
  const environment = {
    encryption,
    context: () => structuredClone(context),
    assertContext(stamp) {
      if (
        JSON.stringify(stamp) !== JSON.stringify(context) ||
        context.context.kind !== 'personal'
      )
        throw Error('case-context');
    },
  };
  return {
    environment,
    prompts,
    switchContext(next = { ...context, generation: context.generation + 1 }) {
      context = next;
    },
  };
}
