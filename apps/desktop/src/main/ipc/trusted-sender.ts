import type { IpcMainInvokeEvent, WebContents } from 'electron';

export function isTrustedSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  trusted: WebContents | undefined,
  location: string,
): boolean {
  return (
    !!trusted &&
    event.sender === trusted &&
    event.senderFrame === trusted.mainFrame &&
    trusted.getURL() === new URL(location).href
  );
}
