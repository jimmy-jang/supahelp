// Round initial. Without a tone (viewers), it sits on the sunk tint.
export function Avatar({
  name,
  tone,
  size = 18,
}: {
  name: string;
  tone?: string;
  size?: 18 | 22 | 36;
}) {
  const text = { 18: 'text-[9.5px]', 22: 'text-[10.5px]', 36: 'text-[15px]' }[
    size
  ];
  return (
    <span
      title={name}
      style={{ width: size, height: size, background: tone }}
      className={`inline-grid flex-none place-items-center rounded-full font-semibold ${text} ${tone ? 'text-white' : 'bg-sunk text-ink-2'}`}
    >
      {name[0]}
    </span>
  );
}
