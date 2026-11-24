const isMac = (platform: string) => platform.startsWith('Mac');

export const shortcutLabel = (key: string, platform = navigator.platform) =>
  isMac(platform) ? `⌘${key}` : `Ctrl+${key}`;

// AltGr reports Ctrl+Alt on Windows, so typing \ on some layouts must not fire shortcuts.
export const hasCommandKey = (
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>,
  platform = navigator.platform,
) => (isMac(platform) ? event.metaKey : event.ctrlKey && !event.altKey);
