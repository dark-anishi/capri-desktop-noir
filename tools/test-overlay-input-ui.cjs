'use strict';
// Fault injection against the actual Electron/Win32 overlay. No user cursor,
// installed Capri, VPN configuration, or foreground window is changed.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require(process.env.CAPRI_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-native-input-')); let app;
  try {
    const source = path.join(temp, 'ReadStyle.cs'), helper = path.join(temp, 'ReadStyle.exe');
    fs.writeFileSync(source, `using System; using System.Runtime.InteropServices;
      class ReadStyle {
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        static int Main(string[] args) { var h=new IntPtr(long.Parse(args[0])); uint pid; GetWindowThreadProcessId(h,out pid);
          if(pid!=uint.Parse(args[1])) return 2;
          Console.WriteLine((GetWindowLong(h,-20)&0x20)!=0 ? "ignored" : "interactive"); return 0; }
      }`);
    execFileSync(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/out:' + helper, source], { windowsHide: true });
    fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ welcomed: true, linked: true, muted: true, visible: true, wander: false, possess: false, skin: 'mono', lang: 'ru' }));
    const bootstrap = path.join(temp, 'bootstrap.cjs');
    fs.writeFileSync(bootstrap, `
      global.inputErrors=[];process.on('uncaughtException',error=>inputErrors.push(error.message));
      require(${JSON.stringify(path.join(root, 'src/main/windows.js'))}).startWindowWatch=({onUpdate})=>{global.inputGame=value=>onUpdate({fg:0,wins:[],gameMode:value});global.inputGame(false);return{stop(){}};};
      require(${JSON.stringify(path.join(root, 'src/main/main.js'))});
    `);
    app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap, '--dev'], cwd: root, env: { ...process.env, CAPRI_TEST_DATA: temp, CAPRI_PORT: '47843' } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.host));
    // Do not let fixture hit-test polling overwrite the controlled desired state.
    // The live renderer is replaced with an inert page in this test instance.
    const native = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/'));
      global.inputOverlay = win;
      await win.loadURL('data:text/html,<body style="background:transparent"></body>');
      win.showInactive();
      const handle = win.getNativeWindowHandle();
      return { handle: String(handle.length >= 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()), pid: process.pid, bounds: win.getBounds() };
    });
    const read = () => execFileSync(helper, [native.handle, String(native.pid)], { encoding: 'utf8', windowsHide: true }).trim();
    const setDesired = value => app.evaluate(({ ipcMain }, value) => ipcMain.emit('overlay:interactive', { sender: inputOverlay.webContents }, value), value);
    const waitStyle = async expected => {
      const until = Date.now() + 2500;
      while (read() !== expected) { if (Date.now() >= until) throw new Error('Native style did not recover: expected ' + expected); await new Promise(resolve => setTimeout(resolve, 30)); }
    };
    await setDesired(true); await waitStyle('interactive');
    for (let i = 0; i < 8; i++) {
      await app.evaluate(() => inputOverlay.setIgnoreMouseEvents(true, { forward: false }));
      // The renderer sends no new state and the window never changes monitors.
      await waitStyle('interactive');
    }
    await setDesired(false); await waitStyle('ignored');
    await app.evaluate(() => inputOverlay.setIgnoreMouseEvents(false)); await waitStyle('ignored');
    await setDesired(true); await waitStyle('interactive');
    await app.evaluate(() => inputGame(true)); await waitStyle('ignored');
    await setDesired(true); assert.equal(read(), 'ignored', 'renderer cannot bypass game suppression');
    await app.evaluate(() => inputGame(false)); await waitStyle('interactive');
    const final = await app.evaluate(() => ({ bounds: inputOverlay.getBounds(), focused: inputOverlay.isFocused() }));
    assert.deepEqual(final.bounds, native.bounds); assert.equal(final.focused, false);
    await app.evaluate(({ ipcMain }) => {
      const sender = inputOverlay.webContents;
      inputOverlay.destroy();
      // A last queued renderer message must not dereference the destroyed HWND.
      ipcMain.emit('overlay:interactive', { sender }, true);
    });
    assert.deepEqual(await app.evaluate(() => inputErrors), [], 'closing the actual BrowserWindow must not throw');
    console.log('NATIVE OVERLAY INPUT PASS: 8 independent HWND click-through faults recovered, reverse fault recovered, game protection preserved, no movement or focus; native window destruction has no uncaught errors.');
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-native-input-'))); fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
