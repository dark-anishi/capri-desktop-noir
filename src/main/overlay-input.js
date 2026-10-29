'use strict';

// Renderer hit testing describes the desired state. HWND styles can be changed
// independently by window lifecycle operations, so that description is not a
// durable acknowledgement from Windows. Reapply without moving/focusing it.
function createOverlayInput({ overlay, blocked = () => false, interval = 500, timers = globalThis }) {
  // BrowserWindow.webContents is a native getter and throws after 'closed'.
  // Keep the emitter while it is alive; removing JS listeners is safe later.
  const webContents = overlay.webContents;
  let interactive = false, closed = false;
  const apply = () => {
    if (closed || overlay.isDestroyed() || webContents.isDestroyed()) return;
    if (!overlay.isVisible()) return;
    const ignore = blocked() || !interactive;
    overlay.setIgnoreMouseEvents(ignore, { forward: ignore });
  };
  const reset = () => { interactive = false; apply(); };
  const timer = timers.setInterval(apply, interval);
  timer.unref?.();
  const events = ['show', 'resize', 'move'];
  for (const event of events) overlay.on(event, apply);
  webContents.on('did-start-loading', reset);
  const close = () => {
    if (closed) return;
    closed = true; timers.clearInterval(timer);
    for (const event of events) overlay.removeListener(event, apply);
    webContents.removeListener('did-start-loading', reset);
    webContents.removeListener('destroyed', close);
    overlay.removeListener('closed', close);
  };
  overlay.on('closed', close);
  webContents.on('destroyed', close);
  return {
    setInteractive(value) { if (typeof value !== 'boolean') return; interactive = value; apply(); },
    reapply: apply,
    close,
  };
}

module.exports = { createOverlayInput };
