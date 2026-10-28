'use strict';
// Real process/job cleanup and Mihomo readiness on owned loopback fixtures only.
// Never contacts an installed service, enables TUN or touches another VPN process.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const http = require('node:http'), net = require('node:net'), dgram = require('node:dgram');
const { freePort } = require('../src/main/vpn/manager');
if (process.platform !== 'win32') { console.log('Windows-only VPN startup gate skipped.'); process.exit(0); }
const root = path.resolve(__dirname, '..'), compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-vpn-startup-native-'));
const baseline = process.argv.includes('--baseline');
const source = path.join(temp, 'Capri.Windows.cs');
fs.writeFileSync(source, baseline ? execFileSync('git', ['show', (process.env.CAPRI_VPN_BASELINE_REF || 'cab1264') + ':native/Capri.Windows.cs'], { cwd: root }) : fs.readFileSync(path.join(root, 'native/Capri.Windows.cs')));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function compile(output, coreHash, additional, entry) {
  const info = path.join(temp, path.basename(output) + '.info.cs');
  fs.writeFileSync(info, `namespace CapriWindows { static class BuildInfo { public const string CoreSha256 = "${coreHash}"; } }`);
  execFileSync(compiler, ['/nologo', '/target:exe', '/platform:x64', '/out:' + output, ...(entry ? ['/main:' + entry] : []), '/r:System.ServiceProcess.dll', '/r:System.Web.Extensions.dll', '/r:System.Drawing.dll', source, path.join(root, 'native/WindowTracker.cs'), path.join(root, 'src/main/window-activity.cs'), path.join(root, 'native/ZapretHost.cs'), info, ...additional], { windowsHide: true, stdio: 'pipe' });
}
function version(endpoint, secret) {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port: endpoint, path: '/version', headers: { Authorization: 'Bearer ' + secret }, timeout: 300 }, response => { response.resume(); resolve(response.statusCode === 200); });
    request.on('error', () => resolve(false)); request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}
(async () => {
  try {
    const fixtureSource = path.join(temp, 'Fixture.cs'), fixture = path.join(temp, 'mihomo.exe');
    fs.writeFileSync(fixtureSource, `using System; using System.IO; using System.Diagnostics; using System.Threading;
      class Fixture { static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--hold") { Thread.Sleep(60000); return 0; }
        string dir=args[Array.IndexOf(args,"-d")+1]; Thread.Sleep(300);
        var child=Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--hold"){UseShellExecute=false,CreateNoWindow=true});
        File.WriteAllText(Path.Combine(dir,"owned-child.pid"),child.Id.ToString()); Thread.Sleep(150); return 3;
      } }`);
    execFileSync(compiler, ['/nologo', '/target:exe', '/out:' + fixture, fixtureSource], { windowsHide: true, stdio: 'pipe' });
    const harnessSource = path.join(temp, 'Harness.cs'), harness = path.join(temp, 'Lifecycle.exe');
    fs.writeFileSync(harnessSource, `using System; using System.IO; using System.Reflection; using System.Diagnostics; using System.Threading;
      namespace CapriWindows { class LifecycleHarness {
        static void Main(string[] args) {
          typeof(Program).GetField("InstallRoot").SetValue(null,args[0]); typeof(Program).GetField("DataRoot").SetValue(null,args[0]);
          var service=new VpnService(); var flags=BindingFlags.Instance|BindingFlags.NonPublic; var type=typeof(VpnService);
          type.GetField("config",flags).SetValue(service,"{\\"mixed-port\\":22222,\\"dns\\":{\\"enable\\":false}}");
          type.GetField("port",flags).SetValue(service,Int32.Parse(args[1])); bool failed=false,alive=false,cleared=false;
          var stop=type.GetMethod("StopCore",flags); int pid=0;
          try {
            try { type.GetMethod("StartCore",flags).Invoke(service,null); } catch(TargetInvocationException) { failed=true; }
            var file=Path.Combine(args[0],"owned-child.pid"); if(File.Exists(file))pid=Int32.Parse(File.ReadAllText(file));
            if(pid!=0)try{using(var child=Process.GetProcessById(pid))alive=!child.WaitForExit(1500);}catch(ArgumentException){}
            cleared=type.GetField("core",flags).GetValue(service)==null&&type.GetField("coreJob",flags).GetValue(service)==null;
          } finally {
            try{stop.Invoke(service,null);}catch{}
            if(pid!=0)try{using(var child=Process.GetProcessById(pid)){if(!child.HasExited&&String.Equals(child.MainModule.FileName,Path.Combine(args[0],"mihomo.exe"),StringComparison.OrdinalIgnoreCase))child.Kill();child.WaitForExit(5000);}}catch(ArgumentException){}
            service.Dispose();
          }
          Console.WriteLine(Program.Json.Serialize(new{failed,alive,cleared,childWasCreated=pid!=0}));
        }
      } }`);
    compile(harness, digest(fixture), [harnessSource], 'CapriWindows.LifecycleHarness');
    const cleanup = JSON.parse(execFileSync(harness, [temp, String(await freePort())], { windowsHide: true, encoding: 'utf8', timeout: 20000 }));
    console.log(JSON.stringify({ fixture: 'service-startup-failure', baseline, ...cleanup }));
    assert.equal(cleanup.failed, true); assert.equal(cleanup.childWasCreated, true);
    assert.equal(cleanup.alive, false, 'failed startup must close the job and its owned descendant');
    assert.equal(cleanup.cleared, true, 'failed startup must release both process and job fields');
    if (baseline) return;
    const core = path.join(root, 'vendor/mihomo/mihomo.exe');
    assert.equal(digest(core), 'a4fbf2b8bc2b5416ce2d0d392ac59f2e0a234ea4fcf635b66bd21e62ea9641b9');
    const helper = path.join(temp, 'Sidecar.exe'); compile(helper, digest(core), []);
    for (const scenario of ['healthy', 'dns-occupied', 'proxy-occupied']) {
      const directory = path.join(temp, scenario); fs.mkdirSync(directory);
      const udp = dgram.createSocket('udp4'), tcp = net.createServer(); let child;
      try {
        const proxy = await freePort(), dns = await freePort(), api = await freePort(), secret = crypto.randomBytes(32).toString('hex');
        if (scenario === 'dns-occupied') await new Promise(resolve => udp.bind(dns, '127.0.0.1', resolve));
        if (scenario === 'proxy-occupied') await new Promise(resolve => tcp.listen(proxy, '127.0.0.1', resolve));
        const config = { 'mixed-port': proxy, 'allow-lan': false, 'bind-address': '127.0.0.1', 'external-controller': '127.0.0.1:' + api, secret, mode: 'direct', 'log-level': 'silent', tun: { enable: false }, dns: { enable: true, listen: '127.0.0.1:' + dns, 'enhanced-mode': 'redir-host', nameserver: ['127.0.0.1:9'] }, rules: ['MATCH,DIRECT'] };
        const file = path.join(directory, 'runtime.json'); fs.writeFileSync(file, JSON.stringify(config));
        child = spawn(helper, ['--sidecar', core, directory, file], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let output = ''; child.stdout.on('data', bytes => { output += bytes.toString(); }); child.stderr.resume(); child.stdin.on('error', () => {});
        const exited = new Promise(resolve => child.once('exit', code => resolve(code))); let controllerAnswered = false;
        const end = Date.now() + 13000;
        while (Date.now() < end && child.exitCode === null) {
          controllerAnswered ||= await version(api, secret);
          if (scenario === 'healthy' && /"ready":true/.test(output)) { child.stdin.end(); break; }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (child.exitCode === null && scenario !== 'healthy') child.stdin.end();
        const code = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Owned sidecar did not terminate')), 6000).unref())]);
        assert.equal(controllerAnswered, true, 'controller API availability alone must be demonstrably insufficient');
        if (scenario === 'healthy') { assert.match(output, /"ready":true/); assert.equal(code, 0); }
        else { assert.doesNotMatch(output, /"ready":true/); assert.notEqual(code, 0); }
        assert.equal(await freePort(api), api, 'owned controller listener released');
        if (scenario !== 'proxy-occupied') assert.equal(await freePort(proxy), proxy, 'owned proxy listener released');
        if (scenario === 'dns-occupied') assert.equal(udp.address().port, dns, 'competing fixture UDP listener untouched');
        if (scenario === 'proxy-occupied') assert.equal(tcp.address().port, proxy, 'competing fixture TCP listener untouched');
        console.log(JSON.stringify({ scenario, controllerAnswered, ready: /"ready":true/.test(output), exitCode: code, noTun: true }));
      } finally {
        if (child && child.exitCode === null) { child.stdin.end(); await new Promise(resolve => { child.once('exit', resolve); setTimeout(() => { child.kill(); resolve(); }, 5000).unref(); }); }
        try { udp.close(); } catch { }
        await new Promise(resolve => tcp.close(resolve));
      }
    }
    console.log('VPN STARTUP NATIVE PASS: failed service startup releases owned job/descendants; real Mihomo requires its own proxy and DNS TCP/UDP listeners before readiness; occupied foreign fixture listeners survive. No installed service, real TUN, remote account or foreign processes touched.');
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'capri-vpn-startup-native-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
