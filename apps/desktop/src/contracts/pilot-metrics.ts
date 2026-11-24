import type { ContextStamp } from './accounts.ts';
import type { Reply } from './chat.ts';

export const PILOT_COUNT_KEYS = [
  'cases_created',
  'cases_attached_to_later_chat',
  'cases_confirmed_resolved',
  'cases_currently_resolved',
  'playbooks_created_from_resolutions',
  'playbooks_updated_from_resolutions',
  'case_ai_changes',
  'case_ai_changes_undone',
  'case_ai_changes_observed_24h',
  'case_ai_changes_observed_24h_undone_within_24h',
] as const;
export type PilotCounts = Record<(typeof PILOT_COUNT_KEYS)[number], number>;
export type PilotReport = {
  formatVersion: 1;
  definitionVersion: 1;
  counts: PilotCounts;
};
export type PilotMetricsSnapshot = {
  context: ContextStamp;
} & (
  | { state: 'off' }
  | { state: 'collecting' | 'finished'; counts: PilotCounts }
);
export type PilotMetricsApi = {
  getPilotMetrics(input: {
    context: ContextStamp;
  }): Promise<Reply<PilotMetricsSnapshot>>;
  startPilotMetrics(input: {
    context: ContextStamp;
  }): Promise<Reply<PilotMetricsSnapshot>>;
  finishPilotMetrics(input: {
    context: ContextStamp;
  }): Promise<Reply<PilotMetricsSnapshot>>;
  deletePilotMetrics(input: {
    context: ContextStamp;
  }): Promise<Reply<PilotMetricsSnapshot>>;
  exportPilotMetrics(input: {
    context: ContextStamp;
  }): Promise<Reply<'saved' | 'cancelled'>>;
};
