import { STATUS } from './status';
import type { StatusKey } from './types';

export function StatusPill({ status }: { status: StatusKey }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex flex-none items-center gap-1.5 rounded-full py-px pr-2 pl-1.5 text-[11px] font-medium ${s.pill}`}
    >
      <span
        className={`size-1.5 rounded-full ${status === 'unk' ? 'ring-1 ring-current' : 'bg-current'}`}
      />
      {s.label}
    </span>
  );
}
