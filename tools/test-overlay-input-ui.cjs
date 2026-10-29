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
        [DllImport("user32.dll")] static extern IntPtr RegisterPowerSettingNotification(IntPtr h, ref Guid setting, uint flags);
        [DllImport("user32.dll")] static extern bool UnregisterPowerSettingNotification(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint message, IntPtr w, IntPtr l);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr h, IntPtr after, string cls, string caption);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int command);
        static int Main(string[] args) { var h=new IntPtr(long.Parse(args[0])); uint pid; GetWindowThreadProcessId(h,out pid);
          if(pid!=uint.Parse(args[1])) return 2;
          if(args.Length>2 && (args[2]=="child" || args[2]=="hide-child")) {
            var child=FindWindowEx(h,IntPtr.Zero,"Chrome_RenderWidgetHostHWND",null);
            if(child==IntPtr.Zero) return 4;
            if(args[2]=="hide-child") ShowWindow(child,0);
            Console.WriteLine(IsWindowVisible(child)?"visible":"hidden");return 0;
          }
          if(args.Length>2 && args[2]=="power") {
            Guid setting=new Guid("2B84C20E-AD23-4DDF-93DB-05FFBD7EFCA5");
            IntPtr registration=RegisterPowerSettingNotification(h,ref setting,0);
            if(registration==IntPtr.Zero) return 3;
            IntPtr data=Marshal.AllocHGlobal(24);
            try { Marshal.Copy(setting.ToByteArray(),0,data,16); Marshal.WriteInt32(data,16,4);
              for(int state=0;state<=1;state++) { Marshal.WriteInt32(data,20,state); SendMessage(h,0x218,new IntPtr(0x8013),data); }
            } finally { Marshal.FreeHGlobal(data); UnregisterPowerSettingNotification(registration); }
            Console.WriteLine("registered-and-notified"); return 0;
          }
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
    await app.evaluate(() => {
      global.displayRefreshes=0;const invalidate=inputOverlay.webContents.invalidate.bind(inputOverlay.webContents);
      inputOverlay.webContents.invalidate=(...args)=>{displayRefreshes++;return invalidate(...args);};
    });
    const child = command => execFileSync(helper, [native.handle, String(native.pid), command], { encoding: 'utf8', windowsHide: true }).trim();
    assert.equal(child('child'), 'visible');
    assert.equal(child('hide-child'), 'hidden', 'reproduce the hidden Chromium input HWND observed in the installed app');
    const watcher = require('node:child_process').spawn(path.join(root, 'native/bin/Capri.Windows.exe'), ['--watch-windows', native.handle, String(native.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Native watcher did not recover hidden input')), 5000);
        let output = '';
        watcher.stdout.on('data', chunk => { output += chunk; if (output.includes('"inputRecovered":true')) { clearTimeout(timeout); resolve(); } });
        watcher.on('error', error => { clearTimeout(timeout); reject(error); });
      });
    } finally {
      watcher.stdin.end();
      await new Promise(resolve => { const timeout = setTimeout(() => { watcher.kill(); resolve(); }, 2000); watcher.once('exit', () => { clearTimeout(timeout); resolve(); }); });
    }
    assert.equal(child('child'), 'visible', 'native repair must restore the observed hidden input child');
    assert.equal(JSON.parse(execFileSync(path.join(root, 'native/bin/Capri.Windows.exe'), ['--repair-input-window', native.handle, String(native.pid)], { encoding: 'utf8', windowsHide: true })).repaired, false, 'healthy input must stay untouched');
    assert.equal(execFileSync(helper, [native.handle, String(native.pid), 'power'], { encoding: 'utf8', windowsHide: true }).trim(), 'registered-and-notified');
    await app.evaluate(async () => {
      const end=Date.now()+4000;
      while(displayRefreshes<2) { if(Date.now()>end) throw new Error('Display power did not rebuild the surface');await new Promise(resolve=>setTimeout(resolve,30)); }
    });
    assert.equal(child('child'), 'visible', 'recovery must restore the hidden input child, not just the top-level flag');
    await waitStyle('interactive');
    const final = await app.evaluate(() => ({ bounds: inputOverlay.getBounds(), focused: inputOverlay.isFocused() }));
    assert.deepEqual(final.bounds, native.bounds); assert.equal(final.focused, false);
    await app.evaluate(({ ipcMain }) => {
      const sender = inputOverlay.webContents;
      inputOverlay.destroy();
      // A last queued renderer message must not dereference the destroyed HWND.
      ipcMain.emit('overlay:interactive', { sender }, true);
    });
    assert.deepEqual(await app.evaluate(() => inputErrors), [], 'closing the actual BrowserWindow must not throw');
    console.log('NATIVE OVERLAY INPUT PASS: input faults recovered; real cross-process display-notification registration and injected WM_POWERBROADCAST off/on rebuild the surface without resume, monitor change or focus; destruction has no uncaught errors. Actual monitor power-off was not performed.');
  } finally {
    if (app) await app.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-native-input-'))); fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
