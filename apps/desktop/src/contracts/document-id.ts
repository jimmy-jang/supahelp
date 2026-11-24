const idPattern = /^[a-zA-Z0-9-]{1,100}$/;
export function documentId(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value))
    throw Error('invalid-entry');
  return value;
}
