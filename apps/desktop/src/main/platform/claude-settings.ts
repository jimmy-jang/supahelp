import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ClaudeModel } from '../../contracts/chat';

export type ClaudePreferences = {
  executable?: string;
  model: ClaudeModel;
  enabled?: boolean;
};

export function isClaudeModel(value: unknown): value is ClaudeModel {
  return (
    value === 'default' ||
    value === 'sonnet' ||
    value === 'opus' ||
    value === 'haiku'
  );
}

export async function readClaudePreferences(
  file: string,
): Promise<ClaudePreferences> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    return {
      model: isClaudeModel(value.model) ? value.model : 'default',
      ...(value.enabled === false ? { enabled: false } : {}),
      ...(typeof value.executable === 'string'
        ? { executable: value.executable }
        : {}),
    };
  } catch {
    return { model: 'default' };
  }
}

export async function writeClaudePreferences(
  file: string,
  value: ClaudePreferences,
) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
