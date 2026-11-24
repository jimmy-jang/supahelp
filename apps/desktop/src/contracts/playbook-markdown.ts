// Managed references are independent of section structure and never filesystem paths.
export const screenshotReference = (id: string) => `playbook-image:${id}`;

export function screenshotIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(/playbook-image:([^\s)>"'\]]*)/g)) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(match[1]))
      throw Error('invalid-screenshot');
    ids.add(match[1]);
  }
  return [...ids];
}

export function playbookMarkdown(content: { title: string; markdown: string }) {
  return `# ${content.title.replace(/[\r\n]/g, ' ')}\n\n${content.markdown}\n`;
}

export function safePlaybookLink(value: string) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
