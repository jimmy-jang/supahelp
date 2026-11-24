import { isApiKey } from '../../platform/model-credentials.ts';
import { isProvider } from '../../platform/model-settings.ts';

export function providerApiKey(input: unknown) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'key,provider'
  )
    throw Error('invalid-api-key');
  const { provider, key } = input as { provider: unknown; key: unknown };
  if (!isProvider(provider) || !isApiKey(key)) throw Error('invalid-api-key');
  return { provider, key };
}
