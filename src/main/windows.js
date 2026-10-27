'use strict';

// Feeds the overlay with the position of the other windows (Windows only), so Capri can
// sit on them. A small PowerShell helper does the Win32 calls; we turn its physical pixels
// into the overlay's coordinates.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { app, screen, BrowserWindow } = require('electron');
const fs = require('node:fs');
const { paths, verify } = require('./vpn/paths');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'windows.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function startWindowWatch({ overlay, onUpdate }) {
  if (process.platform !== 'win32') return { stop() {} };

  let child = null;
  let stopped = false;
  let restarts = 0, retry = null, native = null;
  try { const files = paths(app); verify(files.helper, JSON.parse(fs.readFileSync(files.manifest, 'utf8')).helperSha256); native = files.helper; }
  catch { /* Development without compiled helpers uses the geometry-only fallback. */ }

  const handle = overlay.getNativeWindowHandle();
  const self = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  const toOverlay = (win, bounds) => {
    const dip = screen.screenToDipRect(null, { x: win.x, y: win.y, width: win.w, height: win.h });
    return { id: win.id, x: dip.x - bounds.x, y: dip.y - bounds.y, w: dip.width, h: dip.height, max: win.max };
  };

  const start = () => {
    const fast = Boolean(native);
    child = fast ? spawn(native, ['--watch-windows', String(self), String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) : spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, String(self), String(process.pid),
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let snap;
      try {
        snap = JSON.parse(line);
      } catch {
        return;
      }
      if (!snap || !Array.isArray(snap.wins) || !Number.isFinite(snap.fg) || overlay.isDestroyed()) return;
      const bounds = overlay.getBounds();
      const ownMenus = new Set(BrowserWindow.getAllWindows().filter((window) => /\/src\/(?:launcher|quick)\//.test(window.webContents.getURL())).map((window) => {
        const handle = window.getNativeWindowHandle();
        return Number(handle.length >= 8 ? handle.readBigUInt64LE(0) : handle.readUInt32LE(0));
      }));
      const wins = snap.wins
        .filter((window) => !ownMenus.has(window.id))
        .map((w) => toOverlay(w, bounds))
        // only what overlaps Capri's screen
        .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
      onUpdate({ fg: snap.fg, wins });
    });
    child.stderr.on('data', (d) => console.error('[capri] window watch:', String(d).trim()));
    let finished = false;
    const finish = () => {
      if (finished) return; finished = true; child = null;
      if (stopped) return;
      if (fast) { native = null; restarts = 0; retry = setTimeout(start, 100); }
      else if (restarts++ < 3) retry = setTimeout(start, 1000);
    };
    child.on('error', finish); child.on('exit', finish);
  };

  start();
  return {
    stop() {
      stopped = true; clearTimeout(retry);
      child?.stdin.end(); child?.kill();
    },
  };
}

module.exports = { startWindowWatch };
