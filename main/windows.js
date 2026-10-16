'use strict';
                                                                                                
const { BrowserWindow, shell } = require('electron');
const path = require('path');

                                                                                         
                                                             
function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) shell.openExternal(u.toString());
  } catch { /* malformed URL: ignore */ }
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webviewTag: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

                                                                              
  const indexUrl = require('url').pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).toString();
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
                                                                                               
    if (url.split('#')[0] !== indexUrl) { e.preventDefault(); openExternalSafe(url); }
  });

  return win;
}

module.exports = { createMainWindow, openExternalSafe };
