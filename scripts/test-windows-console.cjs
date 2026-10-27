'use strict';
const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
test('native CLI tolerates missing Windows console handles (no SCM or elevation)', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-console-test-'));
  try {
    const source = path.join(temp, 'Harness.cs'), exe = path.join(temp, 'Harness.exe'), result = path.join(temp, 'result.txt');
    fs.writeFileSync(source, `using System; using System.IO; using System.Reflection; using System.Runtime.InteropServices;
class Harness {
 [DllImport("kernel32.dll")] static extern bool SetStdHandle(int n, IntPtr h);
 static void Main(string[] args) {
  SetStdHandle(-10, IntPtr.Zero); SetStdHandle(-11, IntPtr.Zero); SetStdHandle(-12, IntPtr.Zero);
  try { var type = Assembly.LoadFrom(args[0]).GetType("CapriWindows.Program");
   var code = type.GetMethod("Main", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, new object[] { new string[] { "--identity" } });
   File.WriteAllText(args[1], Convert.ToString(code));
  } catch(Exception ex) { File.WriteAllText(args[1], (ex.InnerException ?? ex).GetType().FullName); }
 }
}`);
    execFileSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', ['/nologo', '/target:winexe', '/platform:x64', '/out:' + exe, source], { windowsHide: true, stdio: 'pipe' });
    const helper = process.env.CAPRI_CONSOLE_TEST_HELPER || path.resolve(__dirname, '../native/bin/Capri.Windows.exe');
    execFileSync(exe, [helper, result], { windowsHide: true, timeout: 10000, stdio: 'ignore' });
    assert.equal(fs.readFileSync(result, 'utf8'), '0');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
