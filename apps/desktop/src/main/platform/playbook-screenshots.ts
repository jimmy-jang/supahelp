import { documentId } from '../../contracts/document-id.ts';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScreenshotPreview } from '../../contracts/playbooks';

type Image = { width: number; height: number; pixels: Buffer };
export class PlaybookScreenshots {
  team?: {
    active(): boolean;
    allowed(book: string, id: string): boolean;
    read(book: string, id: string): Promise<Buffer>;
    save(book: string, id: string, bytes: Buffer): Promise<void>;
  };
  private directory: string;
  private codec: { decode(data: Buffer): Image; encode(image: Image): Buffer };
  private pending = new Map<string, { book: string; image: Image }>();
  private confirmed = new Set<string>();
  constructor(directory: string, codec: PlaybookScreenshots['codec']) {
    this.directory = directory;
    this.codec = codec;
  }
  async activate(directory: string) {
    this.clear();
    this.confirmed.clear();
    this.directory = directory;
    await this.prepare();
  }
  private key(book: string, id: string) {
    return `${documentId(book)}_${documentId(id)}.png`;
  }
  async prepare() {
    const directory = this.directory;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(directory)) {
      if (directory !== this.directory) return;
      if (/^[a-zA-Z0-9-]{1,100}_[a-zA-Z0-9-]{1,100}\.png$/.test(name))
        this.confirmed.add(name);
      else if (name.endsWith('.tmp'))
        await rm(join(directory, name), { force: true });
    }
  }
  private decode(bytes: Buffer) {
    if (
      bytes.length < 24 ||
      bytes.length > 10 * 1024 * 1024 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw Error('invalid-screenshot');
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (
      !width ||
      !height ||
      width > 4096 ||
      height > 4096 ||
      width * height > 8000000
    )
      throw Error('invalid-screenshot');
    const image = this.codec.decode(bytes);
    if (
      image.width !== width ||
      image.height !== height ||
      image.pixels.length !== width * height * 4
    )
      throw Error('invalid-screenshot');
    return image;
  }
  stage(book: string, bytes: Buffer) {
    documentId(book);
    if (this.pending.size >= 5) throw Error('invalid-screenshot');
    const id = randomUUID();
    this.pending.set(id, { book, image: this.decode(bytes) });
    return this.preview(book, id);
  }
  preview(book: string, id: string): ScreenshotPreview {
    const p = this.pending.get(documentId(id));
    if (!p || p.book !== book) throw Error('invalid-screenshot');
    return {
      id,
      data: `data:image/png;base64,${this.codec.encode(p.image).toString('base64')}`,
      width: p.image.width,
      height: p.image.height,
      confirmed: false,
    };
  }
  async confirm(book: string, id: string, guard: () => void) {
    const p = this.pending.get(id);
    if (!p && this.allowed(book, id)) {
      await this.read(book, id);
      guard();
      return;
    }
    if (!p || p.book !== book) throw Error('invalid-screenshot');
    const bytes = this.codec.encode(p.image),
      key = this.key(book, id),
      file = join(this.directory, key);
    guard();
    if (this.team?.active()) {
      await this.team.save(book, id, bytes);
      guard();
      this.pending.delete(id);
      return;
    }
    try {
      await writeFile(`${file}.tmp`, bytes, { mode: 0o600, flush: true });
      guard();
      await rename(`${file}.tmp`, file);
      guard();
      this.confirmed.add(key);
      this.pending.delete(id);
    } catch (error) {
      await rm(file, { force: true });
      throw error;
    } finally {
      await rm(`${file}.tmp`, { force: true });
    }
  }
  allowed(book: string, id: string) {
    if (this.team?.active()) return this.team.allowed(book, id);
    return this.confirmed.has(this.key(book, id));
  }
  async read(book: string, id: string): Promise<ScreenshotPreview> {
    if (this.pending.has(id)) return this.preview(book, id);
    if (!this.allowed(book, id)) throw Error('invalid-screenshot');
    const image = this.decode(
      this.team?.active()
        ? await this.team.read(book, id)
        : await this.bytes(join(this.directory, this.key(book, id))),
    );
    return {
      id,
      data: `data:image/png;base64,${this.codec.encode(image).toString('base64')}`,
      width: image.width,
      height: image.height,
      confirmed: true,
    };
  }
  async collect(references: Set<string>) {
    const directory = this.directory;
    for (const key of this.confirmed)
      if (!references.has(key)) {
        if (directory !== this.directory) return;
        await rm(join(directory, key), { force: true });
        if (directory === this.directory) this.confirmed.delete(key);
      }
  }
  clear() {
    this.pending.clear();
  }
  discardBook(book: string) {
    for (const [id, p] of this.pending)
      if (p.book === book) this.pending.delete(id);
  }
  async removeBook(book: string) {
    const directory = this.directory;
    this.discardBook(book);
    if (this.team?.active()) return;
    await Promise.allSettled(
      [...this.confirmed]
        .filter((key) => key.startsWith(`${book}_`))
        .map(async (key) => {
          await rm(join(directory, key), { force: true });
          if (directory === this.directory) this.confirmed.delete(key);
        }),
    );
  }
  discard(book: string, id: string) {
    if (this.pending.get(id)?.book !== book) throw Error('invalid-screenshot');
    this.pending.delete(id);
  }
  async bytes(path: string) {
    const handle = await open(path, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 10 * 1024 * 1024)
        throw Error('invalid-screenshot');
      const buffer = Buffer.alloc(10 * 1024 * 1024 + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 10 * 1024 * 1024) throw Error('invalid-screenshot');
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}
