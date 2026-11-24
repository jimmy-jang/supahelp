import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import type { Attachment, ChatFile, Project } from '../../contracts/chat';

const imageTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export class ChatResources {
  private files = new Map<string, ChatFile>();
  private projects = new Set<string>();
  private file: string;
  constructor(file: string) {
    this.file = file;
  }

  activate(file: string) {
    this.file = file;
    this.projects.clear();
    this.files.clear();
  }

  async list(guard = () => {}): Promise<Project[]> {
    const file = this.file;
    let saved: unknown;
    try {
      saved = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      saved = [];
    }
    guard();
    if (file !== this.file) throw Error('account-access');
    if (Array.isArray(saved))
      for (const path of saved)
        if (typeof path === 'string') this.projects.add(path);
    const result: Project[] = [];
    for (const path of this.projects) {
      try {
        if ((await stat(path)).isDirectory())
          result.push({ path, name: basename(path) });
      } catch {
        /* Hide folders that no longer exist. */
      }
    }
    guard();
    if (file !== this.file) throw Error('account-access');
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async connect(path: string, guard = () => {}): Promise<Project> {
    const file = this.file;
    const resolved = await realpath(path);
    if (!(await stat(resolved)).isDirectory()) throw Error('invalid-project');
    await this.list(guard);
    guard();
    if (file !== this.file) throw Error('account-access');
    const next = [...new Set([...this.projects, resolved])];
    await mkdir(dirname(file), { recursive: true });
    guard();
    await writeFile(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    guard();
    await rename(`${file}.tmp`, file);
    guard();
    if (file !== this.file) throw Error('account-access');
    this.projects.add(resolved);
    return { path: resolved, name: basename(resolved) };
  }

  async validateProject(path: string) {
    if (!(await this.list()).some((project) => project.path === path))
      throw Error('invalid-project');
  }

  async attach(paths: string[], guard = () => {}): Promise<Attachment[]> {
    if (paths.length > 5) throw Error('invalid-attachment');
    const selected: ChatFile[] = [];
    for (const path of paths) {
      const info = await stat(path);
      if (!info.isFile() || info.size > 10 * 1024 * 1024)
        throw Error('invalid-attachment');
      const handle = await open(path, 'r');
      let data: Buffer;
      try {
        const buffer = Buffer.alloc(10 * 1024 * 1024 + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        data = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      if (data.length > 10 * 1024 * 1024) throw Error('invalid-attachment');
      const mime = imageTypes[extname(path).toLowerCase()] ?? 'text/plain';
      if (mime.startsWith('image/')) {
        const valid =
          mime === 'image/png'
            ? data
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : mime === 'image/jpeg'
              ? data[0] === 255 && data[1] === 216 && data[2] === 255
              : mime === 'image/gif'
                ? /^GIF8[79]a/.test(data.subarray(0, 6).toString())
                : data.subarray(0, 4).toString() === 'RIFF' &&
                  data.subarray(8, 12).toString() === 'WEBP';
        if (!valid) throw Error('unsupported-attachment');
      }
      if (
        mime === 'text/plain' &&
        (data.includes(0) || !Buffer.from(data.toString('utf8')).equals(data))
      )
        throw Error('unsupported-attachment');
      selected.push({
        id: randomUUID(),
        name: basename(path),
        size: data.length,
        mime,
        data: data.toString('base64'),
      });
    }
    if (this.files.size + selected.length > 50) throw Error('attachment-limit');
    guard();
    for (const file of selected) this.files.set(file.id, file);
    return selected.map(({ id, name, size }) => ({ id, name, size }));
  }

  resolve(ids: string[]): ChatFile[] {
    if (
      !Array.isArray(ids) ||
      ids.length > 5 ||
      ids.some((id) => typeof id !== 'string' || !this.files.has(id))
    )
      throw Error('invalid-attachment');
    return ids.map((id) => this.files.get(id)!);
  }
  consume(ids: string[]) {
    for (const id of ids) this.files.delete(id);
  }
  clear() {
    this.files.clear();
  }
}
