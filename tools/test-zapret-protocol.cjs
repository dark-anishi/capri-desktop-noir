'use strict';
// Actual JS manager -> native broker -> authenticated pipe -> native host -> owned job.
// Only harmless fixture binaries run. Production's UAC wrapper is deliberately not invoked.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { createZapret, launchHelper } = require('../src/main/zapret');
if (process.platform !== 'win32') { console.log('Windows-only Zapret protocol test skipped.'); process.exit(0); }
const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-zapret-protocol-'));
const folder = path.join(temp, 'Zapret-fixture'), engine = path.join(folder, 'bin', 'winws.exe');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function stopped(pids) { for (let i = 0; i < 50 && pids.some(alive); i++) await pause(100); assert.ok(pids.every((pid) => !alive(pid)), 'Fixture engine survived its lease'); }
(async () => {
  let manager, child, observation, stdout = '', stderr = '';
  fs.mkdirSync(path.dirname(engine), { recursive: true });
  try {
    const fixture = path.join(temp, 'Fixture.cs');
    fs.writeFileSync(fixture, `using System; using System.IO; using System.Diagnostics; using System.Threading;
class Fixture { static void Main(string[] args) {
  File.AppendAllText(args[0],Process.GetCurrentProcess().Id+"\\n");
  if(args.Length==1) Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"\\\""+args[0]+"\\\" child") { UseShellExecute=false,CreateNoWindow=true });
  Thread.Sleep(60000);
} }`);
    execFileSync(compiler, ['/nologo', '/target:winexe', '/out:' + engine, fixture], { windowsHide: true, stdio: 'pipe' });
    fs.writeFileSync(path.join(folder, 'general (ALT12).bat'), '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\ncall service.bat status_zapret\r\ncall service.bat check_updates\r\ncall service.bat load_game_filter\r\ncall service.bat load_user_lists\r\nset "BIN=%~dp0bin\\"\r\ncd /d %BIN%\r\nstart "zapret: %~n0" /min "%BIN%winws.exe" "%~dp0pids.txt"\r\n');
    fs.writeFileSync(path.join(folder, 'service.bat'), '@echo off\r\nexit /b\r\n');
    const source = path.join(temp, 'Protocol.cs'), executable = path.join(temp, 'Protocol.exe');
    fs.writeFileSync(source, `using System; using System.IO; using System.Diagnostics; using System.Text; using System.Collections.Generic; using System.Web.Script.Serialization;
namespace CapriWindows {
static class Program {
  public static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=4194304,RecursionLimit=48 };
  public static Dictionary<string,object> Parse(string s) { return Json.DeserializeObject(s) as Dictionary<string,object>; }
  public static string Text(Dictionary<string,object> d,string key,string fallback="") { object v; return d.TryGetValue(key,out v)&&v!=null?Convert.ToString(v):fallback; }
  public static void Emit(object data) { try { Console.WriteLine(Json.Serialize(data)); } catch(IOException) { } }
  public static string RandomSecret() { return Guid.NewGuid().ToString("N")+Guid.NewGuid().ToString("N"); }
  static int Main(string[] args) { try {
    Console.InputEncoding=new UTF8Encoding(false); Console.OutputEncoding=new UTF8Encoding(false);
    if(args[0]=="--fixture-host") ZapretBridge.RunHost(args[1],args[2]);
    else ZapretBridge.RunBroker(delegate(string name,string secret) {
      var host=Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--fixture-host "+name+" "+secret) { UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true });
      host.ErrorDataReceived+=delegate(object sender,DataReceivedEventArgs e) { if(e.Data!=null) Console.Error.WriteLine("host: "+e.Data); }; host.BeginErrorReadLine(); return host;
    });
    return 0;
  } catch(Exception e) { Emit(new {ok=false,error=e.Message});return 1; } }
} }`);
    let native = path.resolve(__dirname, '../native/ZapretHost.cs');
    if (process.env.CAPRI_ZAPRET_PROTOCOL_TRACE) {
      let text = fs.readFileSync(native, 'utf8');
      const points = ['var request = Console.ReadLine();', 'pipe.EndWaitForConnection(connection);', 'if (reader.ReadLine() != secret)', 'writer.WriteLine(Program.Json.Serialize(spec));', 'writer.WriteLine(secret);', 'var request = reader.ReadLine();', 'using (var locked = new ZapretFiles(spec))', 'using (var job = new ZapretJob(locked.Folder, locked.Batch, locked.Engines))', 'monitor.Start();', 'writer.WriteLine(Program.Json.Serialize(new { ok = true, phase = "running" }));'];
      for (const point of points) text = text.replace(point, 'Console.Error.WriteLine(' + JSON.stringify('before ' + point) + '); ' + point + (point.startsWith('writer.WriteLine') ? ' Console.Error.WriteLine(' + JSON.stringify('after ' + point) + ');' : ''));
      text = text.replace('} catch (Exception e) {', '} catch (Exception e) { Console.Error.WriteLine("host failure: " + e.Message);');
      native = path.join(temp, 'ZapretHost.Traced.cs'); fs.writeFileSync(native, text);
    }
    execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/out:' + executable, '/r:System.Web.Extensions.dll', native, source], { windowsHide: true, stdio: 'pipe' });
    const start = Date.now();
    manager = createZapret({ app: { isPackaged: false }, platform: 'win32', storeFile: path.join(temp, 'prefs.json'), dialog: { async showOpenDialog() { return { filePaths: [folder] }; } }, launcher: (app, spec, exit) => launchHelper(app, spec, exit, {
      startTimeoutMs: 4000,
      spawn(_file, _args, options) { child = spawn(executable, ['--fixture-broker'], options); child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; }); return child; },
    }) });
    await manager.start();
    const inspect = setTimeout(() => {
      let pids = []; try { pids = fs.readFileSync(path.join(folder, 'pids.txt'), 'utf8').trim().split(/\s+/).map(Number); } catch { }
      observation = { phase: manager.state().phase, engineAlive: pids.length >= 2 && pids.every(alive), stdout };
    }, 2500);
    try { await manager.start('general (ALT12).bat'); } finally { clearTimeout(inspect); }
    assert.equal(manager.state().phase, 'running');
    assert.ok(Date.now() - start < 3500, 'Readiness was not delivered promptly');
    assert.match(stdout, /"phase":"running"/);
    let pids = fs.readFileSync(path.join(folder, 'pids.txt'), 'utf8').trim().split(/\s+/).map(Number);
    await pause(4500); // Longer than the deliberately shortened startup watchdog.
    assert.equal(manager.state().phase, 'running', 'Successful start kept its startup watchdog armed');
    assert.ok(pids.every(alive), 'Healthy engine was stopped by startup watchdog');
    await manager.stop(); await stopped(pids);
    fs.unlinkSync(path.join(folder, 'pids.txt'));
    await manager.start();
    pids = fs.readFileSync(path.join(folder, 'pids.txt'), 'utf8').trim().split(/\s+/).map(Number);
    child.kill(); // Crash only this test's broker; host must see lease EOF and kill its own job.
    await stopped(pids);
    console.log('ZAPRET PROTOCOL PASS: actual native pipe+PID+secret, /min batch readiness reaches JS, startup watchdog cleared, stop and crashed-broker lease clean up child+grandchild. No UAC/drivers/network changes.');
  } catch (e) {
    console.error('Protocol evidence:', JSON.stringify({ observation, phase: manager?.state().phase, stdout, stderr })); throw e;
  } finally {
    if (manager) await manager.close();
    assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-zapret-protocol-')));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
