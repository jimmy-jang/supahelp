import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import config from '../vite.main.config.mts';

test('main build embeds only allowlisted account, OAuth and update configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'account-build-'));
  const previous = process.cwd();
  const keys = [
    'SUPAHELP_UPDATE_FEED',
    'SUPAHELP_API_BASE_URL',
    'SUPAHELP_WORKOS_CLIENT_ID',
    'SUPAHELP_GOOGLE_CLIENT_ID',
    'SUPAHELP_GOOGLE_DESKTOP_CLIENT_SECRET',
    'SUPAHELP_GITHUB_CLIENT_ID',
    'SUPAHELP_SLACK_CLIENT_ID',
    'SUPAHELP_TEAMS_CLIENT_ID',
    'SUPAHELP_SALESFORCE_CLIENT_ID',
    'SUPAHELP_ZENDESK_CLIENT_ID',
  ];
  const environment = keys.map((key) => process.env[key]);
  try {
    for (const key of keys) delete process.env[key];
    process.chdir(directory);
    await writeFile(
      '.env.local',
      [
        'SUPAHELP_UPDATE_FEED=https://updates.example.com/desktop',
        'SUPAHELP_API_BASE_URL=https://accounts.example.com',
        'SUPAHELP_WORKOS_CLIENT_ID=client_test',
        'SUPAHELP_GOOGLE_CLIENT_ID=google-desktop',
        'SUPAHELP_GOOGLE_DESKTOP_CLIENT_SECRET=google-secret-desktop',
        'SUPAHELP_GITHUB_CLIENT_ID=github-app',
        'SUPAHELP_GITHUB_CLIENT_SECRET=github-secret-must-not-ship',
        'WORKOS_API_KEY=server-secret-must-not-ship',
        'SUPAHELP_UNRELATED_SECRET=another-secret-must-not-ship',
      ].join('\n'),
    );
    const result = config({ mode: 'production', command: 'build' });
    assert.equal(
      JSON.parse(result.define.__SUPAHELP_UPDATE_FEED__),
      'https://updates.example.com/desktop',
    );
    assert.deepEqual(JSON.parse(result.define.__SUPAHELP_ACCOUNT_CONFIG__), {
      clientId: 'client_test',
      apiBaseUrl: 'https://accounts.example.com',
    });
    assert.deepEqual(JSON.parse(result.define.__SUPAHELP_OAUTH_CONFIG__), {
      googleClientId: 'google-desktop',
      googleClientSecret: 'google-secret-desktop',
      githubClientId: 'github-app',
      slackClientId: '',
      teamsClientId: '',
      salesforceClientId: '',
      zendeskClientId: '',
    });
    assert.doesNotMatch(JSON.stringify(result.define), /secret-must-not-ship/);
    await rm('.env.local');
    const defaults = config({ mode: 'production', command: 'build' }).define;
    assert.deepEqual(JSON.parse(defaults.__SUPAHELP_ACCOUNT_CONFIG__), {
      clientId: '',
      apiBaseUrl: '',
    });
    assert.equal(JSON.parse(defaults.__SUPAHELP_UPDATE_FEED__), '');
  } finally {
    process.chdir(previous);
    keys.forEach((key, index) => {
      if (environment[index] === undefined) delete process.env[key];
      else process.env[key] = environment[index];
    });
    await rm(directory, { recursive: true, force: true });
  }
});
