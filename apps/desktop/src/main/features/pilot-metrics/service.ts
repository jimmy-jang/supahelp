import type { ContextStamp } from '../../../contracts/accounts';
import type {
  PilotCounts,
  PilotMetricsSnapshot,
  PilotReport,
} from '../../../contracts/pilot-metrics';
import type { CaseOperation, CaseService } from '../cases/service';

export class PilotMetrics {
  private generation = 0;
  private cases: CaseService;
  private now: () => number;
  constructor(cases: CaseService, now: () => number = Date.now) {
    this.cases = cases;
    this.now = now;
  }
  operation(context: ContextStamp): CaseOperation {
    return { context, signal: this.cases.operationSignal() };
  }
  guard(op: CaseOperation) {
    op.signal.throwIfAborted();
    this.cases.assertContext(op.context);
    if (op.context.context.kind !== 'personal') throw Error('case-context');
    op.guard?.();
    if (!this.cases.store.ready) throw Error('case-masking-required');
  }
  private counts(): PilotCounts {
    const state = this.cases.store.pilot();
    if (!state) throw Error('pilot-off');
    if (state.state === 'finished') return state.report.counts;
    const { cases, changes } = this.cases.store.pilotSource(
      state.caseNumberFloor,
    );
    const counts: PilotCounts = {
      cases_created: cases.created,
      cases_attached_to_later_chat: cases.reused,
      cases_confirmed_resolved: cases.resolved,
      cases_currently_resolved: cases.done,
      playbooks_created_from_resolutions: state.created,
      playbooks_updated_from_resolutions: state.updated,
      case_ai_changes: changes.length,
      case_ai_changes_undone: 0,
      case_ai_changes_observed_24h: 0,
      case_ai_changes_observed_24h_undone_within_24h: 0,
    };
    const now = this.now(),
      day = 86_400_000;
    const time = (value: string) => {
      const result = Date.parse(value);
      if (
        !Number.isFinite(result) ||
        new Date(result).toISOString() !== value ||
        result > now
      )
        throw Error('pilot-clock');
      return result;
    };
    if (!Number.isFinite(now)) throw Error('pilot-clock');
    for (const change of changes) {
      const at = time(change.at),
        undone = change.undone_at === null ? undefined : time(change.undone_at);
      if (undone !== undefined && undone < at) throw Error('pilot-clock');
      if (undone !== undefined) counts.case_ai_changes_undone++;
      if (now - at >= day) {
        counts.case_ai_changes_observed_24h++;
        if (undone !== undefined && undone - at <= day)
          counts.case_ai_changes_observed_24h_undone_within_24h++;
      }
    }
    return counts;
  }
  get(op: CaseOperation): PilotMetricsSnapshot {
    this.guard(op);
    const state = this.cases.store.pilot();
    return state
      ? { context: op.context, state: state.state, counts: this.counts() }
      : { context: op.context, state: 'off' };
  }
  start(op: CaseOperation) {
    this.guard(op);
    this.cases.store.startPilot();
    this.generation++;
    return this.get(op);
  }
  finish(op: CaseOperation) {
    this.guard(op);
    this.cases.store.transaction(() => {
      const state = this.cases.store.pilot();
      if (!state) throw Error('pilot-off');
      if (state.state === 'finished') return;
      this.cases.store.savePilot({
        definitionVersion: 1,
        state: 'finished',
        report: {
          formatVersion: 1,
          definitionVersion: 1,
          counts: this.counts(),
        },
      });
    });
    this.generation++;
    return this.get(op);
  }
  delete(op: CaseOperation) {
    this.guard(op);
    this.cases.store.deletePilot();
    this.generation++;
    return this.get(op);
  }
  report(op: CaseOperation): PilotReport {
    this.guard(op);
    const state = this.cases.store.pilot();
    if (state?.state !== 'finished') throw Error('pilot-not-finished');
    return state.report;
  }
  async export(
    op: CaseOperation,
    save: (data: string, guard: () => void) => Promise<boolean>,
  ) {
    const data = JSON.stringify(this.report(op), null, 2) + '\n',
      generation = this.generation;
    const guard = () => {
      this.guard(op);
      if (generation !== this.generation) throw Error('pilot-changed');
    };
    const saved = await save(data, guard);
    guard();
    return saved ? ('saved' as const) : ('cancelled' as const);
  }
}
