import { mock } from 'node:test';
import * as credentials from '../../src/main/platform/model-credentials.ts';

// Unit-only policy double: callers provide synthetic executables or provider objects.
// Native harnesses never import this module and retain the real process guard.
export function mockSubscriptionPolicy() {
  process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
  const policy = { enabled: true };
  mock.module('../../src/main/platform/model-credentials.ts', {
    namedExports: {
      ...credentials,
      assertSubscriptionEnabled() {
        if (!policy.enabled) credentials.assertSubscriptionEnabled();
      },
    },
  });
  return policy;
}
