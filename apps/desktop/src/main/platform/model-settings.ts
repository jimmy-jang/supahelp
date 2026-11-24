import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ModelSelection, ProviderId } from '../../contracts/chat';

type ModelPreferences = { selected?: ModelSelection; codexExecutable?: string };

export function isProvider(value: unknown): value is ProviderId {
  return value === 'claude' || value === 'chatgpt';
}

export function isModelSelection(value: unknown): value is ModelSelection {
  if (!value || typeof value !== 'object') return false;
  const selection = value as ModelSelection;
  return (
    isProvider(selection.provider) &&
    typeof selection.model === 'string' &&
    /^[a-zA-Z0-9._-]{1,120}$/.test(selection.model)
  );
}

export async function readModelPreferences(
  file: string,
): Promise<ModelPreferences> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    return {
      ...(isModelSelection(value.selected) ? { selected: value.selected } : {}),
      ...(typeof value.codexExecutable === 'string'
        ? { codexExecutable: value.codexExecutable }
        : {}),
    };
  } catch {
    return {};
  }
}

export async function writeModelPreferences(
  file: string,
  value: ModelPreferences,
) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
