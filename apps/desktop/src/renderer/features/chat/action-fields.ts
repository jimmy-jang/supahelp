// Turns a connection action's raw tool name and JSON arguments into
// plain-language labels and values for the approval/receipt card.

export type ActionField = {
  label: string;
  text?: string;
  long?: boolean;
  items?: string[];
  fields?: ActionField[];
};

const WORDS: Record<string, string> = { id: 'ID', url: 'URL', api: 'API' };

const words = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .filter(Boolean);

// "create_google_doc" -> "Create Google Doc"
export const toolTitle = (tool: string) =>
  words(tool)
    .map((w) => WORDS[w.toLowerCase()] ?? w[0].toUpperCase() + w.slice(1))
    .join(' ');

// Per-tool wording where the generic label would mislead.
const LABELS: Record<string, Record<string, string>> = {
  create_google_doc: { name: 'Title', text: 'Content' },
};

// "file_id" -> "File ID"
const fieldLabel = (tool: string, key: string) =>
  LABELS[tool]?.[key] ??
  words(key)
    .map(
      (w, i) =>
        WORDS[w.toLowerCase()] ??
        (i ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)),
    )
    .join(' ');

const MAX_DEPTH = 3;
const isPlain = (v: unknown): v is string | number | boolean =>
  ['string', 'number', 'boolean'].includes(typeof v);
const plain = (v: string | number | boolean) =>
  typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);

function field(
  tool: string,
  key: string,
  value: unknown,
  depth: number,
): ActionField | undefined {
  const label = fieldLabel(tool, key);
  if (value == null || value === '') return undefined;
  if (isPlain(value)) {
    const text = plain(value);
    return { label, text, long: text.includes('\n') || text.length > 80 };
  }
  if (Array.isArray(value) && value.every(isPlain))
    return { label, items: value.map(plain) };
  if (depth >= MAX_DEPTH)
    return { label, text: JSON.stringify(value), long: true };
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i + 1), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const fields = entries.flatMap(
    ([k, v]) => field(tool, k, v, depth + 1) ?? [],
  );
  return fields.length ? { label, fields } : undefined;
}

export const actionFields = (tool: string, args: Record<string, unknown>) =>
  Object.entries(args).flatMap(([k, v]) => field(tool, k, v, 1) ?? []);
