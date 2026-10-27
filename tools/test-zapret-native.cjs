'use strict';
// No real Zapret, elevation, drivers or network changes: isolated benign fixture only.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'win32') { console.log('Windows-only native ownership test skipped.'); process.exit(0); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-zapret-native-'));
const folder = path.join(temp, 'Zapret & (test) %literal% !');
fs.mkdirSync(path.join(folder, 'bin'), { recursive: true });
const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
try {
  const fixture = path.join(temp, 'Fixture.cs');
  fs.writeFileSync(fixture, `using System; using System.IO; using System.Diagnostics; using System.Threading;
class Fixture { static void Main(string[] args) {
  File.AppendAllText(args[0], Process.GetCurrentProcess().Id + "\\n");
  if (args.Length == 1) Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "\\\"" + args[0] + "\\\" child") { UseShellExecute=false, CreateNoWindow=true });
  Thread.Sleep(60000);
} }`);
  const fixtureExe = path.join(temp, 'FixtureEngine.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', '/out:' + fixtureExe, fixture], { windowsHide: true, stdio: 'pipe' });
  fs.writeFileSync(path.join(folder, 'general (EMPTY).bat'), '@echo off\r\nrem no engine in this own job\r\n');
  const testSource = path.join(temp, 'Test.cs');
  fs.writeFileSync(testSource, `using System; using System.IO; using System.Diagnostics; using System.Threading; using System.Collections.Generic; using System.Web.Script.Serialization;
namespace CapriWindows {
static class Program {
  public static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  public static Dictionary<string,object> Parse(string s) { return Json.DeserializeObject(s) as Dictionary<string,object>; }
  public static string Text(Dictionary<string,object> d, string key) { return Convert.ToString(d[key]); }
  public static void Emit(object data) { Console.WriteLine(Json.Serialize(data)); }
  public static string RandomSecret() { return new string('a',64); }
}
class Test {
  static string Hash(string file) { using(var sha=System.Security.Cryptography.SHA256.Create()) using(var s=File.OpenRead(file)) return BitConverter.ToString(sha.ComputeHash(s)).Replace("-", "").ToLowerInvariant(); }
  static bool Alive(int id) { try { using (var p=Process.GetProcessById(id)) return !p.HasExited; } catch (ArgumentException) { return false; } }
  static void Main(string[] args) {
    var engine="bin/"+args[1]; var enginePath=Path.Combine(args[0],engine); var enginePaths=new string[] { enginePath };
    var files=new Dictionary<string,object>(); files["general (TEST).bat"]=Hash(Path.Combine(args[0],"general (TEST).bat")); files[engine]=Hash(enginePath);
    var spec=new Dictionary<string,object>(); spec["folder"]=args[0]; spec["batch"]="general (TEST).bat"; spec["files"]=files;
    using(var locked=new ZapretFiles(spec)) {
      if(locked.Engines.Count!=1 || !String.Equals(locked.Engines[0],Path.GetFullPath(enginePath),StringComparison.OrdinalIgnoreCase)) throw new Exception("Selected engine inventory wrong");
      var blocked=false; try { using(var writer=new FileStream(enginePath,FileMode.Open,FileAccess.Write)) { } } catch(IOException) { blocked=true; }
      if(!blocked) throw new Exception("Pinned executable was writable");
    }
    files[engine]=new string('0',64); var rejected=false;
    try { using(var invalid=new ZapretFiles(spec)) { } } catch(Exception) { rejected=true; }
    if(!rejected) throw new Exception("Replaced executable hash accepted");
    files[engine]=Hash(enginePath); files["../escape.exe"]=new string('0',64); rejected=false;
    try { using(var invalid=new ZapretFiles(spec)) { } } catch(Exception) { rejected=true; }
    if(!rejected) throw new Exception("Path escape accepted"); files.Remove("../escape.exe");
    var logfile=Path.Combine(args[0],"pids.txt"); string[] pids=null;
    using(var job=new ZapretJob(args[0],"general (TEST).bat",enginePaths)) {
      var deadline=DateTime.UtcNow.AddSeconds(8);
      while(DateTime.UtcNow<deadline) { Thread.Sleep(100); if(File.Exists(logfile)) { pids=File.ReadAllLines(logfile); if(pids.Length>=2) break; } }
      if(pids==null || pids.Length!=2 || job.Active<2 || !job.HasEngine) throw new Exception("Fixture tree did not start inside job");
      if(!ZapretJob.AnyRunningEngine(enginePaths)) throw new Exception("Existing same-path engine not detected");
      using(var empty=new ZapretJob(args[0],"general (EMPTY).bat",enginePaths)) if(empty.HasEngine) throw new Exception("Foreign job engine counted as owned");
      using(var wrongPath=new ZapretJob(args[0],"general (PATH).bat",enginePaths)) {
        var pathLog=Path.Combine(args[0],"alternate-pids.txt"); var pathDeadline=DateTime.UtcNow.AddSeconds(5);
        while(DateTime.UtcNow<pathDeadline && (!File.Exists(pathLog) || File.ReadAllLines(pathLog).Length<2)) Thread.Sleep(100);
        if(wrongPath.Active<2) throw new Exception("Same-name path fixture did not start");
        if(wrongPath.HasEngine) throw new Exception("Unpinned executable with the same name counted as engine");
      }
      Console.WriteLine("owned: " + String.Join(",",pids));
    }
    var stopped=DateTime.UtcNow.AddSeconds(5);
    while(DateTime.UtcNow<stopped && (Alive(Int32.Parse(pids[0])) || Alive(Int32.Parse(pids[1])))) Thread.Sleep(100);
    foreach(var pid in pids) if(Alive(Int32.Parse(pid))) throw new Exception("Job left a fixture process alive");
    Console.WriteLine("PASS " + args[1] + ": file hash/lock, path escape rejection, special-character path, actual pinned engine, wrong path/foreign job rejected, child+grandchild cleanup");
  }
} }`);
  const exe = path.join(temp, 'OwnershipTest.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/out:' + exe, '/r:System.Web.Extensions.dll', path.resolve(__dirname, '../native/ZapretHost.cs'), testSource], { windowsHide: true, stdio: 'pipe' });
  for (const engine of ['winws.exe', 'winwx.exe', 'Capri-Renamed-Engine.exe']) {
    fs.copyFileSync(fixtureExe, path.join(folder, 'bin', engine));
    fs.mkdirSync(path.join(folder, 'alternate'), { recursive: true });
    fs.copyFileSync(fixtureExe, path.join(folder, 'alternate', engine));
    fs.writeFileSync(path.join(folder, 'general (TEST).bat'), '@echo off\r\nstart "fixture" /b "%~dp0bin\\' + engine + '" "%~dp0pids.txt"\r\n');
    fs.writeFileSync(path.join(folder, 'general (PATH).bat'), '@echo off\r\nstart "fixture" /b "%~dp0alternate\\' + engine + '" "%~dp0alternate-pids.txt"\r\n');
    const output = execFileSync(exe, [folder, engine], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
    assert.match(output, /PASS /); console.log(output.trim());
    fs.unlinkSync(path.join(folder, 'pids.txt'));
    fs.unlinkSync(path.join(folder, 'alternate-pids.txt'));
  }
} finally {
  assert.ok(temp.startsWith(path.join(os.tmpdir(), 'capri-zapret-native-')));
  fs.rmSync(temp, { recursive: true, force: true });
}
