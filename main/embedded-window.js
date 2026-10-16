'use strict';
const { WebContentsView } = require('electron');
const { EventEmitter } = require('events');

// A window-like service surface backed by a view INSIDE the OS window.
// Nested browser views belong to this view, so their coordinates stay local.
function createEmbeddedWindow(parent, webPreferences) {
  const view = new WebContentsView({ webPreferences });
  const surface = new EventEmitter();
  let destroyed = false;
  view.setVisible(false);
  parent.contentView.addChildView(view);
  Object.assign(surface, {
    webContents: view.webContents,
    contentView: view,
    nativeWindow: parent,
    loadFile: (...args) => view.webContents.loadFile(...args),
    isDestroyed: () => destroyed || view.webContents.isDestroyed() || parent.isDestroyed(),
    isMinimized: () => false,
    restore() {},
    show() {}, // Visibility is owned by the desktop window manager.
    focus() { if (!surface.isDestroyed()) view.webContents.focus(); },
    setDesktopLayout(layout) {
      if (surface.isDestroyed()) return;
      const rect = layout?.bounds;
      if (!layout?.visible || !rect || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k]))) {
        view.setVisible(false);
        return;
      }
      const zoom = parent.webContents.getZoomFactor();
      const area = parent.getContentBounds();
      const x = Math.max(0, Math.round(rect.x * zoom));
      const y = Math.max(0, Math.round(rect.y * zoom));
      const width = Math.min(Math.round(rect.width * zoom), area.width - x);
      const height = Math.min(Math.round(rect.height * zoom), area.height - y);
      if (width < 1 || height < 1) { view.setVisible(false); return; }
      view.setBounds({ x, y, width, height });
      view.setVisible(true);
    },
    close() {
      if (destroyed) return;
      destroyed = true;
      if (!parent.isDestroyed()) parent.contentView.removeChildView(view);
      surface.emit('closed');
      if (!view.webContents.isDestroyed()) view.webContents.close();
      parent.removeListener('closed', surface.close);
    },
  });
  parent.once('closed', surface.close);
  return surface;
}
module.exports = { createEmbeddedWindow };
