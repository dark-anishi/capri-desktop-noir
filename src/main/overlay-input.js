'use strict';

// Renderer hit testing describes the desired state. HWND styles can be changed
// independently by window lifecycle operations, so that description is not a
// durable acknowledgement from Windows. Reapply without moving/focusing it.
function createOverlayInput({ overlay, blocked = () => false, interval = 500, timers = globalThis, platform = process.platform, onRecover = () => {} }) {
  // BrowserWindow.webContents is a native getter and throws after 'closed'.
  // Keep the emitter while it is alive; removing JS listeners is safe later.
  const webContents = overlay.webContents;
  let interactive = false, closed = false;
  let pendingRecovery = false;
  let recoveryTimers = [];
  const alive = () => !closed && !overlay.isDestroyed() && !webContents.isDestroyed();
  const apply = () => {
    if (closed || overlay.isDestroyed() || webContents.isDestroyed()) return;
    if (!overlay.isVisible()) return;
    const ignore = blocked() || !interactive;
    overlay.setIgnoreMouseEvents(ignore, { forward: ignore });
  };
  const reset = () => { interactive = false; apply(); };
  const recover = () => {
    if (!alive()) return;
    pendingRecovery = true;
    if (!overlay.isVisible() || blocked()) return;
    pendingRecovery = false;
    webContents.invalidate(); onRecover(); apply();
  };
  const powerChanged = (wParam) => {
    if (!Buffer.isBuffer(wParam) || wParam.length < 4 || wParam.readUInt32LE(0) !== 0x8013 || !alive()) return;
    for (const id of recoveryTimers) timers.clearTimeout(id);
    // GPU/display restoration may finish after the notification is delivered.
    recoveryTimers = [250, 1500].map(delay => timers.setTimeout(recover, delay));
  };
  const show = () => { if (pendingRecovery) recover(); else apply(); };
  const timer = timers.setInterval(apply, interval);
  timer.unref?.();
  const events = ['resize', 'move'];
  for (const event of events) overlay.on(event, apply);
  overlay.on('show', show);
  if (platform === 'win32') overlay.hookWindowMessage(0x218, powerChanged);
  webContents.on('did-start-loading', reset);
  const close = () => {
    if (closed) return;
    closed = true; timers.clearInterval(timer);
    for (const id of recoveryTimers) timers.clearTimeout(id);
    recoveryTimers = [];
    if (platform === 'win32' && !overlay.isDestroyed()) overlay.unhookWindowMessage(0x218);
    for (const event of events) overlay.removeListener(event, apply);
    overlay.removeListener('show', show);
    webContents.removeListener('did-start-loading', reset);
    webContents.removeListener('destroyed', close);
    overlay.removeListener('closed', close);
  };
  overlay.on('closed', close);
  webContents.on('destroyed', close);
  return {
    setInteractive(value) { if (typeof value !== 'boolean') return; interactive = value; apply(); },
    reapply: apply,
    recover,
    close,
  };
}

module.exports = { createOverlayInput };
