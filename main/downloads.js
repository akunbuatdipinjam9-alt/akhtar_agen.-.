'use strict';
                                                                                                      
const { uid, now } = require('../utils/misc');

function setupDownloads(app, win) {
  const items = new Map();
  app.downloads = {
    list: () => [...items.values()].map(({ handle, ...pub }) => pub),
    pause: (id) => items.get(id)?.handle.pause(),
    resume: (id) => items.get(id)?.handle.resume(),
    cancel: (id) => items.get(id)?.handle.cancel(),
  };

  win.webContents.session.on('will-download', (event, item) => {
    const id = uid();
    const rec = {
      id, handle: item, filename: item.getFilename(), url: item.getURL(),
      state: 'progressing', receivedBytes: 0, totalBytes: item.getTotalBytes(), startedAt: now(), savePath: null,
    };
    items.set(id, rec);
                                                                     
    item.setSavePath(item.getSavePath());

    const emit = () => { const w = app.getWindow?.() || win; if (w && !w.isDestroyed()) w.webContents.send('download:event', { ...rec, handle: undefined }); };
    item.on('updated', (_e, state) => {
      rec.receivedBytes = item.getReceivedBytes();
      rec.totalBytes = item.getTotalBytes();
      rec.state = state === 'interrupted' ? 'interrupted' : state === 'progressing' && item.isPaused() ? 'paused' : 'progressing';
      emit();
    });
    item.once('done', (_e, state) => {
      rec.state = state;                                             
      rec.savePath = item.getSavePath();
      emit();
    });
    emit();
  });
}

module.exports = { setupDownloads };
