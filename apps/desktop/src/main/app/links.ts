import { parseAppLink } from '../features/accounts/links';

const pendingLinks: string[] = [];
let receiveLink: ((url: string) => Promise<void>) | undefined;

export function routeLink(url: string) {
  if (!parseAppLink(url)) return;
  if (receiveLink) void receiveLink(url).catch(() => {});
  else if (pendingLinks.length < 10) pendingLinks.push(url);
}

export function connectLinks(receive: (url: string) => Promise<void>) {
  receiveLink = receive;
  for (const url of [...pendingLinks.splice(0), ...process.argv])
    routeLink(url);
}
