import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { randomUUID } from 'node:crypto';
import type { ConnectionAction } from '../../../contracts/connections';

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

// Money-moving tools always wait for an in-chat approval, even when a custom
// connection marks them read only. Plain reads (get_charge, list_refunds) still run.
// ponytail: name heuristic; move to a per-tool `sensitive` flag if tools get vaguer names.
const READ_VERB =
  /^(get|list|search|read|retrieve|fetch|find|lookup|query|describe|view|show)(_|-|[A-Z]|$)/i;
const MONEY =
  /refund|payout|transfer|charge|payment|pay_|invoice|subscription|balance|credit|coupon|discount|dispute/i;
export const requiresApproval = (tool: Tool) =>
  tool.annotations?.readOnlyHint !== true ||
  (MONEY.test(tool.name) && !READ_VERB.test(tool.name));

export class ConnectionActions {
  private label: string | (() => string);
  private get name() {
    return typeof this.label === 'function' ? this.label() : this.label;
  }
  private receipts: () => ConnectionAction[];
  private save: () => Promise<void>;
  private changed: () => void;
  private context: () => {
    account?: string;
    scope?: string;
    principal?: string;
  };
  private pending = new Map<string, (approved: boolean) => void>();
  private calls = new Map<AbortController, string>();
  private cancelled = new Set<string>();
  private validator = new AjvJsonSchemaValidator();
  constructor(
    name: string | (() => string),
    receipts: () => ConnectionAction[],
    save: () => Promise<void>,
    changed: () => void,
    context: () => {
      account?: string;
      scope?: string;
      principal?: string;
    } = () => ({}),
  ) {
    this.label = name;
    this.receipts = receipts;
    this.save = save;
    this.changed = changed;
    this.context = context;
  }
  recover() {
    for (const action of this.receipts()) {
      if (action.status === 'running') {
        action.status = 'unknown';
        action.message = `Supahelp closed before the result was recorded. Check ${this.name} before retrying.`;
      }
      if (action.status === 'pending') action.status = 'cancelled';
    }
  }
  resumeChat(id: string) {
    this.cancelled.delete(id);
  }
  isCancelled(id: string) {
    return this.cancelled.has(id);
  }
  cancelChat(id: string) {
    this.cancelled.add(id);
    for (const [controller, chatId] of this.calls)
      if (id === chatId) controller.abort();
  }
  cancelAll() {
    for (const controller of this.calls.keys()) controller.abort();
  }
  async cancelCase(caseId: string) {
    let changed = false;
    for (const action of this.receipts())
      if (action.source?.caseId === caseId && action.status === 'pending') {
        action.status = 'cancelled';
        action.message =
          'Case authority changed. Review the case before proposing another action.';
        this.pending.get(action.id)?.(false);
        changed = true;
      }
    if (changed) {
      await this.save();
      this.changed();
    }
  }
  async decide(id: string, decision: 'approve' | 'deny' | 'checked') {
    const action = this.receipts().find((item) => item.id === id);
    if (
      action &&
      (action.principal ?? null) !== (this.context().principal ?? null)
    )
      throw Error('Return to the account that owns this action.');
    if (decision === 'checked' && action?.status === 'unknown') {
      action.status = 'reviewed';
      action.message = `You confirmed you checked the outcome in ${this.name}.`;
      await this.save();
      this.changed();
      return;
    }
    const resolve = this.pending.get(id);
    if (!action || action.status !== 'pending' || !resolve)
      throw Error('This action is no longer pending.');
    resolve(decision === 'approve');
  }
  async run(
    chatId: string,
    tool: Tool,
    supplied: Record<string, unknown>,
    active: () => void,
    execute: (
      args: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<CallToolResult>,
    signal?: AbortSignal,
    verify?: (
      result: CallToolResult,
      args: Record<string, unknown>,
      signal: AbortSignal,
    ) => Promise<string | undefined>,
    effect = (args: Record<string, unknown>) => args,
    source?: { caseId: string; resolutionId: string },
    pending?: (id: string) => void,
  ) {
    signal?.throwIfAborted();
    active();
    const args = structuredClone(supplied);
    if (
      JSON.stringify(args).length > 48000 ||
      !this.validator.getValidator(tool.inputSchema)(args).valid
    )
      throw Error(`Invalid ${this.name} tool inputs.`);
    const controller = new AbortController();
    this.calls.set(controller, chatId);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let action: ConnectionAction | undefined;
    try {
      if (requiresApproval(tool)) {
        const context = this.context();
        if (
          this.receipts().some(
            (item) =>
              (source &&
                item.source?.resolutionId === source.resolutionId &&
                !['failed', 'cancelled', 'reviewed'].includes(item.status)) ||
              (['pending', 'running', 'unknown'].includes(item.status) &&
                item.tool === tool.name &&
                (!item.scope ||
                  !context.scope ||
                  item.scope === context.scope) &&
                (canonical(effect(item.arguments)) ===
                  canonical(effect(args)) ||
                  (source &&
                    item.source?.resolutionId === source.resolutionId))),
          )
        )
          throw Error(
            'This action already exists or has an uncertain outcome. Check its receipt before retrying.',
          );
        action = {
          id: randomUUID(),
          chatId,
          tool: tool.name,
          ...context,
          arguments: args,
          ...(source ? { source } : {}),
          status: 'pending',
        };
        this.receipts().unshift(action);
        const approval = new Promise<boolean>((resolve) => {
          const done = (approved: boolean) => {
            controller.signal.removeEventListener('abort', cancelled);
            this.pending.delete(action!.id);
            resolve(approved);
          };
          const cancelled = () => done(false);
          if (controller.signal.aborted) return resolve(false);
          this.pending.set(action!.id, done);
          controller.signal.addEventListener('abort', cancelled, {
            once: true,
          });
        });
        await this.save();
        this.changed();
        pending?.(action.id);
        const approved = await approval;
        active();
        if (!approved || controller.signal.aborted)
          throw Error(`${this.name} action cancelled.`);
        action.status = 'running';
        await this.save();
        this.changed();
      }
      active();
      controller.signal.throwIfAborted();
      const result = await execute(args, controller.signal);
      if (action) {
        action.status = result.isError ? 'unknown' : 'returned';
        action.message = result.isError
          ? `${this.name} reported an error. Check whether the change took effect before trying again.`
          : `Supahelp can’t independently confirm this result. Check ${this.name} to be sure.`;
        if (!result.isError && verify) {
          action.status = 'unknown';
          try {
            active();
            const confirmation = await verify(result, args, controller.signal);
            if (confirmation) {
              action.status = 'verified';
              action.message = confirmation;
            } else
              action.message = `${this.name} returned a result, but the requested fields could not all be verified. Check ${this.name} before repeating the change.`;
          } catch {
            action.message = `${this.name} returned a result, but the follow-up check did not finish. Check ${this.name} before repeating the action.`;
          }
        }
        await this.save();
        this.changed();
      }
      return result;
    } catch (error) {
      if (action) {
        action.status =
          action.status === 'running'
            ? 'unknown'
            : action.status === 'pending'
              ? 'cancelled'
              : action.status;
        if (action.status === 'unknown')
          action.message = `The result is uncertain. Check ${this.name} before retrying; Supahelp will not automatically repeat this action.`;
        await this.save();
        this.changed();
      }
      throw error;
    } finally {
      controller.abort();
      if (action) this.pending.delete(action.id);
      this.calls.delete(controller);
      signal?.removeEventListener('abort', abort);
    }
  }
}
