import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import type { ChatOptions, ProviderStatus } from '../../contracts/chat';
import type { ChatOutput, ChatSession } from '../features/chat/service';
import type { ModelCredentials } from '../platform/model-credentials';
import { assertSubscriptionEnabled } from '../platform/model-credentials.ts';
import {
  connectedInstructions,
  type AgentConnection,
} from './connector-agent.ts';
import { DOCUMENT_DRAFT_INSTRUCTIONS } from './document-draft.ts';

type Notification = { method: string; params?: Record<string, unknown> };
type Account = { type: string; email?: string; planType?: string };
export type CodexModel = {
  model: string;
  displayName: string;
  hidden: boolean;
  supportedReasoningEfforts?: { reasoningEffort: string }[];
};

export function codexEnvironment(home: string, source = process.env) {
  const allowed =
    /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LC_.*|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|COMSPEC|PATHEXT|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS)$/i;
  return {
    ...Object.fromEntries(
      Object.entries(source).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && allowed.test(entry[0]),
      ),
    ),
    CODEX_HOME: home,
  };
}

export const codexConfig = {
  model_provider: 'openai',
  forced_login_method: 'chatgpt',
  cli_auth_credentials_store: 'file',
  'features.shell_tool': false,
  'features.view_image': false,
  'features.apply_patch_freeform': false,
  'features.hooks': false,
  'features.multi_agent': false,
  'features.plugins': false,
  'features.apps': false,
  'features.code_mode.enabled': false,
  'agents.enabled': false,
  web_search: 'disabled',
  project_doc_max_bytes: 0,
};

// Codex owns subscription tokens; API keys are injected into ephemeral auth over stdio.
export class CodexRpc {
  private apiKey?: string;
  private executable: string;
  private home: string;
  version?: string;
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private sequence = 0;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<(message: Notification) => void>();
  private connections: AgentConnection[];

  constructor(
    executable: string,
    home: string,
    connections: AgentConnection[] = [],
    apiKey?: string,
  ) {
    this.executable = executable;
    this.home = home;
    this.connections = connections;
    this.apiKey = apiKey;
  }

  listen(listener: (message: Notification) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start() {
    return (this.starting ??= this.initialize());
  }

  private async initialize() {
    if (!this.apiKey) assertSubscriptionEnabled();
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    if (this.closed) throw Error('codex-failure');
    this.child = spawn(
      this.executable,
      [
        'app-server',
        ...Object.entries({
          ...codexConfig,
          ...(this.apiKey
            ? {
                forced_login_method: 'api',
                cli_auth_credentials_store: 'ephemeral',
              }
            : {}),
          ...Object.fromEntries(
            this.connections.flatMap((connection) => [
              [`mcp_servers.${connection.name}.url`, connection.url],
              [
                `mcp_servers.${connection.name}.bearer_token_env_var`,
                `SUPAHELP_${connection.name.toUpperCase()}_TOKEN`,
              ],
              [
                `mcp_servers.${connection.name}.default_tools_approval_mode`,
                // Supahelp's main-owned bridges enforce masking and external-action approvals.
                'approve',
              ],
              [`mcp_servers.${connection.name}.tool_timeout_sec`, 300],
            ]),
          ),
        }).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`]),
      ],
      {
        cwd: this.home,
        env: {
          ...codexEnvironment(this.home),
          ...Object.fromEntries(
            this.connections.map((connection) => [
              `SUPAHELP_${connection.name.toUpperCase()}_TOKEN`,
              connection.token,
            ]),
          ),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    this.child.on('error', () => this.close());
    this.child.on('exit', () => this.close());
    this.child.stdin.on('error', () => this.close());
    this.child.stderr.resume();
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (data: string) => {
      buffer += data;
      if (buffer.length > 2_000_000) {
        this.close();
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.id !== undefined && message.method) {
            this.child?.stdin.write(
              `${JSON.stringify({ id: message.id, error: { code: -32601, message: 'Tools and approvals are not enabled.' } })}\n`,
            );
          } else if (message.id !== undefined) {
            const request = this.pending.get(message.id);
            if (!request) continue;
            clearTimeout(request.timer);
            this.pending.delete(message.id);
            if (message.error) request.reject(Error('codex-failure'));
            else request.resolve(message.result);
          } else if (typeof message.method === 'string') {
            for (const listener of this.listeners) listener(message);
          }
        } catch {
          this.close();
          return;
        }
      }
    });
    try {
      const result = await this.request<{ userAgent: string }>('initialize', {
        clientInfo: {
          name: 'supahelp_desktop',
          title: 'Supahelp',
          version: '1.0.0',
        },
      });
      this.version = result.userAgent?.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
      if (
        !this.version ||
        this.version
          .split('.')
          .map(Number)
          .reduce((n, v) => n * 1000 + v, 0) < 167000
      )
        throw Error('codex-failure');
      this.child.stdin.write('{"method":"initialized"}\n');
      if (this.apiKey) {
        await this.request('account/login/start', {
          type: 'apiKey',
          apiKey: this.apiKey,
        });
        this.apiKey = undefined;
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  request<T>(method: string, params: unknown = {}): Promise<T> {
    if (!this.child || this.closed)
      return Promise.reject(Error('codex-failure'));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
      }, 30000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.child!.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.apiKey = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(Error('codex-failure'));
    }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: 'closed' });
    this.listeners.clear();
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      timer.unref();
      child.once('exit', () => clearTimeout(timer));
    }
  }
}

export class Codex {
  private credentials?: ModelCredentials;
  private home: string;
  private executable?: string;
  private rpc?: CodexRpc;
  private loginId?: string;
  private loginPending = false;
  private loginFailed = false;
  private epoch = 0;
  constructor(
    home: string,
    executable?: string,
    credentials?: ModelCredentials,
  ) {
    this.credentials = credentials;
    this.home = home;
    this.executable = executable;
  }

  useExecutable(executable: string) {
    this.close();
    this.executable = executable;
  }

  private async findExecutable() {
    const candidates = this.executable
      ? [this.executable]
      : [
          join(homedir(), '.local/bin/codex'),
          join(homedir(), '.npm-global/bin/codex'),
          '/opt/homebrew/bin/codex',
          '/usr/local/bin/codex',
          ...(process.env.PATH ?? '')
            .split(delimiter)
            .filter(isAbsolute)
            .map((dir) =>
              join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex'),
            ),
        ];
    for (const candidate of candidates) {
      if (!isAbsolute(candidate)) continue;
      try {
        await access(candidate, constants.X_OK);
        const resolved = await realpath(candidate);
        if (
          process.platform === 'darwin' &&
          resolved.endsWith('/@openai/codex/bin/codex.js')
        ) {
          // Use npm's bundled binary so Finder launches do not depend on a shell's Node path.
          const native = join(
            dirname(resolved),
            '../node_modules/@openai',
            `codex-darwin-${process.arch}`,
            'vendor',
            `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`,
            'bin/codex',
          );
          await access(native, constants.X_OK);
          return native;
        }
        return candidate;
      } catch {
        /* Try the next installation. */
      }
    }
    throw Error('codex-missing');
  }

  private async server() {
    const epoch = this.epoch;
    const executable = await this.findExecutable();
    const auth = await this.credentials?.get('chatgpt');
    if (epoch !== this.epoch) throw Error('codex-auth');
    if (auth?.mode === 'disconnected') throw Error('codex-auth');
    if (!this.rpc) {
      this.rpc = new CodexRpc(executable, this.home, [], auth?.key);
      this.rpc.listen((message) => {
        if (message.method === 'account/login/completed') {
          this.loginPending = false;
          this.loginId = undefined;
          this.loginFailed = message.params?.success !== true;
        }
      });
    }
    const rpc = this.rpc;
    try {
      await rpc.start();
      if (epoch !== this.epoch) throw Error('codex-auth');
      return rpc;
    } catch (error) {
      rpc.close();
      if (this.rpc === rpc) this.close();
      throw error;
    }
  }

  async status(): Promise<ProviderStatus> {
    try {
      const auth = await this.credentials?.get('chatgpt');
      if (auth?.mode === 'disconnected')
        return {
          id: 'chatgpt',
          state: 'disconnected',
          message: 'Connect your own OpenAI account.',
        };
      const rpc = await this.server();
      if (this.loginPending || this.loginFailed)
        return {
          id: 'chatgpt',
          state: this.loginFailed ? 'error' : 'signed-out',
          message: this.loginFailed
            ? 'ChatGPT sign-in did not finish. Try connecting again.'
            : 'Finish ChatGPT sign-in in your browser, then return here.',
          executable: await this.findExecutable(),
          version: rpc.version,
        };
      const { account } = await rpc.request<{ account: Account | null }>(
        'account/read',
        {
          refreshToken: false,
        },
      );
      return {
        id: 'chatgpt',
        state:
          account?.type === (auth?.mode === 'api-key' ? 'apiKey' : 'chatgpt')
            ? 'ready'
            : 'signed-out',
        message:
          auth?.mode === 'api-key'
            ? 'Your API key is saved. Requests use paid OpenAI API usage; access is checked on the first request.'
            : account?.type === 'chatgpt'
              ? 'Your ChatGPT subscription is connected.'
              : 'Continue with ChatGPT to connect your subscription.',
        executable: await this.findExecutable(),
        version: rpc.version,
        ...(account?.type === 'chatgpt'
          ? { email: account.email, plan: account.planType }
          : {}),
      };
    } catch (error) {
      this.close();
      return {
        id: 'chatgpt',
        state:
          error instanceof Error && error.message === 'codex-missing'
            ? 'missing'
            : 'error',
        message: 'Install or update Codex, then check the connection again.',
      };
    }
  }

  async models() {
    const rpc = await this.server();
    const result = await rpc.request<{ data: CodexModel[] }>('model/list', {
      limit: 100,
    });
    return result.data.filter((model) => !model.hidden);
  }

  async signIn() {
    const rpc = await this.server();
    if (this.loginId)
      await rpc.request('account/login/cancel', { loginId: this.loginId });
    this.loginPending = true;
    this.loginFailed = false;
    let result: { authUrl: string; loginId: string };
    try {
      result = await rpc.request<{ authUrl: string; loginId: string }>(
        'account/login/start',
        {
          type: 'chatgpt',
        },
      );
    } catch (error) {
      this.loginPending = false;
      throw error;
    }
    const url = new URL(result.authUrl);
    if (
      url.protocol !== 'https:' ||
      !['auth.openai.com', 'chatgpt.com'].includes(url.hostname) ||
      url.username ||
      url.password
    ) {
      this.close();
      throw Error('codex-auth');
    }
    this.loginId = this.loginPending ? result.loginId : undefined;
    return url.href;
  }

  async disconnect() {
    try {
      if (this.loginId)
        await this.rpc?.request('account/login/cancel', {
          loginId: this.loginId,
        });
      if (this.rpc) await this.rpc.request('account/logout');
    } finally {
      this.close();
      // Disconnect must also clear a subscription saved by an earlier app process.
      await rm(join(this.home, 'auth.json'), { force: true });
    }
  }

  open(
    model: string,
    options: ChatOptions = {},
    connections: AgentConnection[] = [],
    purpose?: 'document-draft',
  ): ChatSession {
    if (purpose && connections.length) throw Error('case-masking-failed');
    let rpc: CodexRpc | undefined;
    let thread:
      | { thread: { id: string }; model: string; instructionSources: string[] }
      | undefined;
    let closed = false;
    const close = () => {
      closed = true;
      rpc?.close();
    };
    const home = this.home;
    const findExecutable = () => this.findExecutable();
    const credentials = this.credentials;
    return {
      provider: 'chatgpt',
      close,
      async *reply(text, signal, files = []): AsyncGenerator<ChatOutput> {
        if (closed || signal.aborted) return;
        const stop = () => close();
        signal.addEventListener('abort', stop, { once: true });
        try {
          const auth = await credentials?.get('chatgpt');
          if (auth?.mode === 'disconnected') throw Error('codex-auth');
          if (!rpc)
            rpc = new CodexRpc(
              await findExecutable(),
              home,
              connections,
              auth?.key,
            );
          if (closed || signal.aborted) return;
          await rpc.start();
          const { account } = await rpc.request<{ account: Account | null }>(
            'account/read',
            {
              refreshToken: false,
            },
          );
          if (
            account?.type !== (auth?.mode === 'api-key' ? 'apiKey' : 'chatgpt')
          )
            throw Error('codex-auth');
          thread ??= await rpc.request<{
            thread: { id: string };
            model: string;
            instructionSources: string[];
          }>('thread/start', {
            ...(model === 'default' ? {} : { model }),
            cwd: purpose ? home : (options.project ?? home),
            ephemeral: true,
            approvalPolicy:
              purpose || connections.length || options.confirmation === 'skip'
                ? 'never'
                : 'untrusted',
            sandbox: 'read-only',
            baseInstructions: purpose
              ? DOCUMENT_DRAFT_INSTRUCTIONS
              : connections.length
                ? connectedInstructions(
                    connections.map((connection) => connection.name),
                  )
                : 'You are Supa, a helpful assistant for customer support work. Answer clearly and distinguish facts from assumptions. Conversation only: do not use tools or claim access to apps, filesystem tools, web, tickets, accounts, payments, logs or code. Use attached content when provided; ask for relevant information when needed. Never claim an action was performed.',
          });
          if (thread.instructionSources?.length) throw Error('codex-isolation');
          yield { type: 'model', model: thread.model };
          const threadId = thread.thread.id;
          const queue: Notification[] = [];
          let wake: (() => void) | undefined;
          const unlisten = rpc.listen((message) => {
            if (
              message.method === 'closed' ||
              message.params?.threadId === threadId
            ) {
              queue.push(message);
              wake?.();
            }
          });
          try {
            await rpc.request('turn/start', {
              threadId,
              effort: options.effort,
              input: [
                { type: 'text', text, text_elements: [] },
                ...files.map((file) =>
                  file.mime.startsWith('image/')
                    ? {
                        type: 'image',
                        url: `data:${file.mime};base64,${file.data}`,
                      }
                    : {
                        type: 'text',
                        text: `Attached file: ${file.name}\n${Buffer.from(file.data, 'base64').toString('utf8')}`,
                        text_elements: [],
                      },
                ),
              ],
            });
            for (;;) {
              if (signal.aborted) return;
              if (!queue.length)
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
              if (signal.aborted) return;
              const message = queue.shift();
              if (!message) continue;
              if (message.method === 'closed') throw Error('codex-failure');
              if (
                message.method === 'item/agentMessage/delta' &&
                typeof message.params?.delta === 'string'
              )
                yield { type: 'text', text: message.params.delta };
              const item = message.params?.item as
                | { type?: unknown; server?: unknown; tool?: unknown }
                | undefined;
              if (
                message.method === 'item/started' &&
                item?.type === 'mcpToolCall' &&
                typeof item.server === 'string' &&
                typeof item.tool === 'string'
              )
                yield { type: 'step', server: item.server, tool: item.tool };
              if (message.method === 'turn/completed') {
                const turn = message.params?.turn as
                  | { status?: string }
                  | undefined;
                if (turn?.status !== 'completed') throw Error('codex-failure');
                return;
              }
            }
          } finally {
            unlisten();
          }
        } catch (error) {
          close();
          throw error;
        } finally {
          signal.removeEventListener('abort', stop);
        }
      },
    };
  }

  close(keepLogin = false) {
    if (keepLogin && this.loginPending) return;
    this.epoch++;
    this.rpc?.close();
    this.rpc = undefined;
    this.loginId = undefined;
    this.loginPending = false;
    this.loginFailed = false;
  }
}
