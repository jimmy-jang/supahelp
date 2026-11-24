// Squirrel needs an installed build; there is no Linux updater.
export function updatesSupported(
  feed: string,
  packaged: boolean,
  platform: string,
  squirrelInstalled = true,
) {
  return (
    feed.startsWith('https://') &&
    packaged &&
    squirrelInstalled &&
    (platform === 'darwin' || platform === 'win32')
  );
}

export function feedUrl(
  feed: string,
  platform: string,
  arch: string,
  version: string,
) {
  return `${feed.replace(/\/+$/, '')}/${platform}-${arch}/${version}`;
}
