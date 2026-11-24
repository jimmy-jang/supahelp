import type { BrowserWindow, IpcMain } from 'electron';
import type { ContextStamp } from '../../../contracts/accounts';
import { isTrustedSender } from '../../ipc/trusted-sender.ts';
import type { PilotMetrics } from './service';

const messages: Record<string, string> = {
  'case-context':
    'The account or workspace changed. Use your personal workspace and try again.',
  'case-masking-required':
    'Local counts are unavailable until the existing case masking recovery finishes. Open Cases to continue recovery.',
  'pilot-state':
    'Pilot counts could not be read safely. Saved documents are preserved. You can delete pilot counts and start a new observation.',
  'pilot-clock':
    'Existing change times cannot support the 24-hour counts. Check this computer’s clock; no report was saved.',
  'pilot-off': 'Start local pilot counts first.',
  'pilot-finished':
    'Delete the finished pilot counts before starting a new observation.',
  'pilot-not-finished': 'Finish collection before exporting counts.',
  'pilot-changed':
    'Pilot collection changed. Export the current finished report again.',
  'pilot-input': 'Check the pilot counts request.',
};
export function registerPilotMetricsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | undefined,
  location: string,
  metrics: PilotMetrics,
  save: (data: string, guard: () => void) => Promise<boolean>,
) {
  for (const name of ['get', 'start', 'finish', 'export', 'delete'] as const)
    ipc.handle(`pilot-metrics:${name}`, async (event, input: unknown) => {
      if (!isTrustedSender(event, getWindow()?.webContents, location))
        return {
          ok: false,
          error: 'This window cannot access local pilot counts.',
        };
      try {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).join(',') !== 'context'
        )
          throw Error('pilot-input');
        const op = metrics.operation(
          (input as { context: ContextStamp }).context,
        );
        const value =
          name === 'export'
            ? await metrics.export(op, save)
            : metrics[name](op);
        metrics.guard(op);
        return { ok: true, value };
      } catch (error) {
        return {
          ok: false,
          error:
            messages[error instanceof Error ? error.message : ''] ??
            'Pilot counts could not finish. Saved documents are preserved.',
        };
      }
    });
}
