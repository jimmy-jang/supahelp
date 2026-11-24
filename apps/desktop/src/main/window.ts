import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  nativeTheme,
  shell,
} from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import macIconData from '../../assets/supahelp-macos.png?inline';
import iconData from '../../assets/supahelp.png?inline';
import { protectUnsavedEdits } from './window-close';
import { windowConfirmation } from './window-dialog';

export const rendererLocation = () =>
  (MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).href
    : undefined) ||
  pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  ).href;

export const createWindow = (cancelEdits: () => void) => {
  const icon = nativeImage.createFromDataURL(
    process.platform === 'darwin' ? macIconData : iconData,
  );
  app.dock?.setIcon(icon);
  const mainWindow = new BrowserWindow({
    icon,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Supahelp',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151618' : '#FAFAFB',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  protectUnsavedEdits(
    mainWindow,
    windowConfirmation(ipcMain, mainWindow, rendererLocation()),
    cancelEdits,
  );
  // Renderer links never open in-app; only the support portal opens externally.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === 'https://support.supahelp.app')
      void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererLocation()) event.preventDefault();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
  return mainWindow;
};
