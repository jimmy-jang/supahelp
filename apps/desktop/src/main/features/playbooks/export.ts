import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  playbookMarkdown,
  screenshotIds,
} from '../../../contracts/playbook-markdown.ts';
import type { PlaybookContent } from '../../../contracts/playbooks';

export async function exportPlaybook(
  path: string,
  content: PlaybookContent,
  image: (id: string) => Promise<Buffer>,
  guard: () => void,
) {
  guard();
  const ids = screenshotIds(content.markdown);
  const assetName = `playbook.assets-${randomUUID()}`;
  const assets = join(dirname(path), assetName);
  const temporary = `${path}.${randomUUID()}.tmp`;
  let created = false;
  let committed = false;
  try {
    let markdown = playbookMarkdown(content);
    if (ids.length) {
      await mkdir(assets, { mode: 0o700 });
      created = true;
      for (const id of ids) {
        const bytes = await image(id);
        guard();
        await writeFile(join(assets, `${id}.png`), bytes, {
          mode: 0o600,
          flag: 'wx',
        });
      }
      markdown = markdown.replace(
        /playbook-image:([a-zA-Z0-9-]+)/g,
        (_match, id: string) => `${assetName}/${id}.png`,
      );
    }
    await writeFile(temporary, markdown, {
      mode: 0o600,
      flag: 'wx',
      flush: true,
    });
    guard();
    await rename(temporary, path);
    committed = true;
  } finally {
    await rm(temporary, { force: true });
    if (created && !committed)
      await rm(assets, { recursive: true, force: true });
  }
}
