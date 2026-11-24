import type { PlaybookContent } from '../../../contracts/playbooks';
import { screenshotIds } from '../../../contracts/playbook-markdown.ts';

export function documentContent(input: unknown): PlaybookContent {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('invalid-entry');
  const c = input as PlaybookContent;
  if (
    Object.keys(c).some((k) => !['title', 'markdown'].includes(k)) ||
    typeof c.title !== 'string' ||
    !c.title.trim() ||
    c.title.length > 120 ||
    typeof c.markdown !== 'string' ||
    c.markdown.length > 32000
  )
    throw Error('invalid-entry');
  screenshotIds(c.markdown);
  return structuredClone(c);
}
