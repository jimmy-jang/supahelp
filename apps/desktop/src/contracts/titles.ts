export type TitleEdit = { title: string; expectedTitle: string };

export function checkedTitle(value: unknown): string {
  if (typeof value !== 'string') throw Error('invalid-title');
  const title = value.trim();
  if (!title || title.length > 120 || /[\r\n\0]/.test(title))
    throw Error('invalid-title');
  return title;
}
