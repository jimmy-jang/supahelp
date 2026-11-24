import type { BrowserWindow } from 'electron';

const decisions = new WeakMap<BrowserWindow, Promise<boolean>>();

export function protectUnsavedEdits(
  window: BrowserWindow,
  confirmDiscard: () => boolean | Promise<boolean>,
  discard: () => void = () => {},
) {
  let approved = false;
  window.webContents.on('will-prevent-unload', (event) => {
    // Electron's preventDefault here permits closing despite beforeunload's veto.
    if (approved) {
      approved = false;
      event.preventDefault();
      return;
    }
    if (decisions.has(window)) return;
    let choice: boolean | Promise<boolean>;
    try {
      choice = confirmDiscard();
    } catch {
      choice = false;
    }
    const decision = Promise.resolve(choice)
      .then((accepted) => {
        if (!accepted || window.isDestroyed()) return false;
        discard();
        approved = true;
        window.close();
        return true;
      })
      .catch(() => false)
      .finally(() => decisions.delete(window));
    decisions.set(window, decision);
  });
}

export function closeBeforeQuit(
  window: BrowserWindow | undefined,
  closed: () => void,
  stayed: () => void,
) {
  if (!window) {
    closed();
    return;
  }
  const contents = window.webContents;
  let finished = false;
  const prevented = (event: Electron.Event) => {
    if (event.defaultPrevented) return;
    const cancel = () => {
      if (finished) return;
      finished = true;
      window.removeListener('closed', finish);
      stayed();
    };
    const decision = decisions.get(window);
    if (decision)
      void decision.then((accepted) => {
        if (!accepted) cancel();
      });
    else cancel();
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    contents.removeListener('will-prevent-unload', prevented);
    closed();
  };
  contents.once('will-prevent-unload', prevented);
  window.once('closed', finish);
  window.close();
}
