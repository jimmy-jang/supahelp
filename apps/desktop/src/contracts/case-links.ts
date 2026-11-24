const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseCaseLink(value: string): string | undefined {
  if (typeof value !== 'string' || value.length > 256) return;
  try {
    const u = new URL(value);
    if (u.username || u.password || u.port || u.search || u.hash) return;
    const id =
      u.protocol === 'https:' &&
      ['supahelp.app', 'www.supahelp.app'].includes(u.host)
        ? u.pathname.match(/^\/case\/([^/]+)$/)?.[1]
        : u.protocol === 'supahelp:' && u.host === 'case'
          ? u.pathname.match(/^\/([^/]+)$/)?.[1]
          : undefined;
    return id && idPattern.test(id) ? id.toLowerCase() : undefined;
  } catch {
    return;
  }
}
export function sharedCaseLink(id: string) {
  if (!idPattern.test(id)) throw Error('Invalid case ID.');
  return `https://supahelp.app/case/${id.toLowerCase()}`;
}
