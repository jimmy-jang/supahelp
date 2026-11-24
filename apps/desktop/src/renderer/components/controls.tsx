import { useState } from 'react';
import { Icon } from './Icon';

// Switch. `locked` shows a setting that can't be turned off, as "Always on".
export function Toggle({
  label,
  defaultOn = false,
  locked = false,
}: {
  label: string;
  defaultOn?: boolean;
  locked?: boolean;
}) {
  const [on, setOn] = useState(locked || defaultOn);
  return (
    <span className="flex flex-none items-center gap-2">
      {locked && (
        <span className="flex items-center gap-1 text-[11.5px] text-ink-3">
          <Icon name="lock" size={12} />
          Always on
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={on}
        aria-disabled={locked}
        onClick={() => !locked && setOn(!on)}
        className={`relative h-[19px] w-8 flex-none rounded-full transition-colors ${on ? 'bg-ink' : 'bg-line'} ${locked ? 'cursor-not-allowed opacity-45' : ''}`}
      >
        <span
          className={`absolute top-0.5 size-[15px] rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-[left] duration-150 ease-out ${on ? 'left-[15px] bg-surface' : 'left-0.5 bg-white'}`}
        />
      </button>
    </span>
  );
}

// Native select styled to the design system.
export function Select({
  label,
  options,
  defaultValue,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: string[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className="relative inline-flex flex-none">
      <select
        aria-label={label}
        defaultValue={
          value === undefined ? (defaultValue ?? options[0]) : undefined
        }
        value={value}
        onChange={
          onChange ? (event) => onChange(event.target.value) : undefined
        }
        disabled={disabled}
        className="h-7 appearance-none rounded-item bg-surface pr-7 pl-2.5 text-[12.5px] text-ink ring-1 ring-line outline-none focus-visible:ring-2 focus-visible:ring-busy"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-ink-3">
        <Icon name="updown" size={12} />
      </span>
    </span>
  );
}
