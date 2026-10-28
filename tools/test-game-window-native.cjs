'use strict';
// Real Win32 metadata on owned, hidden WinForms HWNDs. No desktop focus changes,
// real game, service, VPN, administrator rights or system settings are required.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isGameActivity } = require('../src/main/game-mode');
if (process.platform !== 'win32') { console.log('Windows-only native metadata gate skipped.'); process.exit(0); }
const root = path.resolve(__dirname, '..'), compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-game-native-'));
try {
  const activity = path.join(root, 'src/main/window-activity.cs');
  const fallback = fs.readFileSync(path.join(root, 'src/main/windows.ps1'), 'utf8').match(/\$capriTrackerSource = @"\r?\n([\s\S]*?)\r?\n"@/);
  assert.ok(fallback, 'PowerShell must compile its geometry source with the shared activity source');
  const fallbackSource = path.join(temp, 'FallbackSnapshot.cs'); fs.writeFileSync(fallbackSource, fallback[1]);
  const outputs = [];
  for (const mode of ['native', 'fallback']) {
    const snapshotClass = mode === 'native' ? 'CapriWindows.WindowTracker' : 'CapriWindowSnapshot';
    const driver = path.join(temp, mode + '-driver.cs');
    fs.writeFileSync(driver, `
      using System; using System.Diagnostics; using System.Drawing; using System.Windows.Forms;
      using System.Web.Script.Serialization;
      class GameMetadataFixture {
        [STAThread] static void Main() {
          ${snapshotClass}.Init();
          var serializer = new JavaScriptSerializer();
          using (var form = new Form()) {
            form.AutoScaleMode = AutoScaleMode.None; form.StartPosition = FormStartPosition.Manual;
            form.FormBorderStyle = FormBorderStyle.FixedSingle; form.SetBounds(40, 60, 520, 300);
            IntPtr handle = form.Handle; // Create a real HWND; deliberately never Show/Activate it.
            string normal = CapriWindows.ForegroundActivity.JsonForWindow(0, handle);
            string own = CapriWindows.ForegroundActivity.JsonForWindow(handle.ToInt64(), handle);
            form.FormBorderStyle = FormBorderStyle.None;
            form.Bounds = Screen.PrimaryScreen.Bounds; handle = form.Handle;
            string fullscreen = CapriWindows.ForegroundActivity.JsonForWindow(0, handle);
            // The last valid query was this process. A missing foreground must not reuse its identity.
            string absent = CapriWindows.ForegroundActivity.JsonForWindow(0, IntPtr.Zero);
            string snapshot = ${snapshotClass}.Snapshot(0);
            var parsed = serializer.Deserialize<System.Collections.Generic.Dictionary<string, object>>(snapshot);
            if (!parsed.ContainsKey("activity") || !parsed.ContainsKey("wins")) throw new Exception("Snapshot omitted activity or geometry");
            Console.WriteLine("{\\"normal\\":" + normal + ",\\"own\\":" + own + ",\\"fullscreen\\":" + fullscreen + ",\\"absent\\":" + absent + ",\\"snapshotIncludesActivity\\":true}");
          }
        }
      }
    `);
    const snapshotSource = mode === 'native' ? path.join(root, 'native/WindowTracker.cs') : fallbackSource;
    const compiled = path.join(temp, mode + '-fixture.exe');
    execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/out:' + compiled, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', snapshotSource, activity, driver], { windowsHide: true, stdio: 'pipe' });
    for (const name of ['RobloxPlayerBeta.exe', 'CapriWindowFixture.exe']) {
      const executable = path.join(temp, name); fs.copyFileSync(compiled, executable);
      const data = JSON.parse(execFileSync(executable, [], { windowsHide: true, encoding: 'utf8', timeout: 10000 }));
      assert.equal(data.normal.executable.toLowerCase(), name.toLowerCase());
      assert.equal(data.normal.own, false); assert.equal(data.normal.fullscreen, false);
      assert.equal(data.own.own, true); assert.equal(data.own.executable, ''); assert.equal(isGameActivity(data.own), false);
      assert.equal(data.fullscreen.fullscreen, true, mode + ': real monitor-sized HWND');
      assert.equal(isGameActivity(data.fullscreen), true);
      assert.equal(data.absent.executable, '', mode + ': absent foreground must not retain a previous executable');
      assert.equal(isGameActivity(data.absent), false);
      if (name === 'RobloxPlayerBeta.exe') assert.equal(isGameActivity(data.normal), true, 'windowed game identity');
      assert.equal(data.snapshotIncludesActivity, true);
      outputs.push({ mode, executable: name, windowed: !data.normal.fullscreen, fullscreen: data.fullscreen.fullscreen, ownExcluded: data.own.own, absentCleared: !data.absent.executable });
    }
  }
  console.log(JSON.stringify(outputs));
  console.log('NATIVE GAME METADATA PASS: real owned HWND geometry/process identity, fullscreen and windowed policy, own-process exclusion, no stale absent-foreground identity, native and fallback snapshot source parity. No Show/Activate or user focus changes. Actual foreground WinEvent delivery, exclusive DirectX games and minimization/Alt+Tab remain separate manual acceptance cases.');
} finally {
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'capri-game-native-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
