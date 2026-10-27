// Independently implemented Windows infrastructure. No Clash Verge Rev code.
using System;
using System.IO;
using System.IO.Pipes;
using System.Drawing;
using System.Drawing.Imaging;
using System.Diagnostics;
using System.Collections;
using System.Collections.Generic;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Net;
using System.Net.Sockets;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace CapriWindows {
  static class Program {
    public const string ServiceName = "CapriVpn";
    public const string PipeName = "CapriVpn.Control.v1";
    public static readonly string InstallRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "CapriVPN");
    public static readonly string DataRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "CapriVPN");
    public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024, RecursionLimit = 48 };
    public static string Hash(string file) { using (var sha = SHA256.Create()) using (var stream = File.OpenRead(file)) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    public static string RandomSecret() { var b = new byte[32]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b); return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant(); }
    public static Dictionary<string, object> Parse(string json) { var d = Json.DeserializeObject(json) as Dictionary<string, object>; if (d == null) throw new Exception("Expected a JSON object"); return d; }
    public static string Text(Dictionary<string, object> d, string key, string fallback = "") { object v; return d.TryGetValue(key, out v) && v != null ? Convert.ToString(v) : fallback; }
    public static void Emit(object data) { try { Console.WriteLine(Json.Serialize(data)); } catch (IOException) { /* Elevated/SCM processes may not have console handles. */ } }
    static int ErrorCode(Exception ex) {
      for (var cause = ex; cause != null; cause = cause.InnerException) {
        var win32 = cause as System.ComponentModel.Win32Exception; if (win32 != null) return win32.NativeErrorCode;
        if (cause is System.ServiceProcess.TimeoutException || cause is System.TimeoutException) return 1460;
        if (cause is UnauthorizedAccessException) return 5;
      }
      return 1;
    }
    static int Main(string[] args) {
      try {
        // Services have no console. Reach the SCM dispatcher before touching Console.
        if (args.Length == 0) { ServiceBase.Run(new VpnService()); return 0; }
        try { Console.InputEncoding = new UTF8Encoding(false); } catch (IOException) { }
        try { Console.OutputEncoding = new UTF8Encoding(false); } catch (IOException) { }
        if (args[0] == "--watch-windows" && args.Length == 3) { WindowTracker.Run(long.Parse(args[1]), int.Parse(args[2])); return 0; }
        if (args[0] == "--zapret") { ZapretBridge.Broker(); return 0; }
        if (args[0] == "--zapret-host" && args.Length == 3) { ZapretBridge.Host(args[1], args[2]); return 0; }
        if (args[0] == "--icon") { Emit(Icons.Read(Parse(Console.In.ReadToEnd()))); return 0; }
        if (args[0] == "--identity") { Emit(new { sid = WindowsIdentity.GetCurrent().User.Value }); return 0; }
        if (args[0] == "--check-policy") { Policy.Validate(Parse(Console.In.ReadToEnd())); Emit(new { ok = true }); return 0; }
        if (args[0] == "--check-api") { ApiPolicy.Check(Parse(Console.In.ReadToEnd())); Emit(new { ok = true }); return 0; }
        if (args[0] == "--client") { Client(); return 0; }
        if (args[0] == "--sidecar" && args.Length == 4) { Sidecar(args[1], args[2], args[3]); return 0; }
        if (args[0] == "--install" && args.Length == 3) { Install(args[1], args[2]); return 0; }
        if (args[0] == "--uninstall") { Uninstall(); return 0; }
        if (args[0] == "--service-start" || args[0] == "--service-stop") {
          RequireAdmin(); using (var service = new ServiceController(ServiceName)) {
            if (args[0] == "--service-start" && service.Status != ServiceControllerStatus.Running) { service.Start(); service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20)); }
            if (args[0] == "--service-stop" && service.Status != ServiceControllerStatus.Stopped) { service.Stop(); service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(25)); }
          } Emit(new { ok = true }); return 0;
        }
        throw new Exception("Unknown operation");
      } catch (Exception ex) { int code = ErrorCode(ex); Emit(new { ok = false, error = ex.Message, code }); return code; }
    }
    static void RequireAdmin() { if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) throw new Exception("Administrator approval is required for service installation/removal"); }
    static void NoReparse(string path) {
      for (var d = new DirectoryInfo(path); d != null; d = d.Parent) if (d.Exists && (d.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("Reparse points are not allowed in service paths");
    }
    static void SecureDirectory(string dir, bool readable) {
      Directory.CreateDirectory(dir); NoReparse(dir);
      var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
      acl.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
      var inheritance = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
      acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, inheritance, PropagationFlags.None, AccessControlType.Allow));
      acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), FileSystemRights.FullControl, inheritance, PropagationFlags.None, AccessControlType.Allow));
      if (readable) acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute, inheritance, PropagationFlags.None, AccessControlType.Allow));
      Directory.SetAccessControl(dir, acl);
    }
    static void SecureFile(string file) {
      var acl = new FileSecurity(); acl.SetAccessRuleProtection(true, false); acl.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
      acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, AccessControlType.Allow));
      acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), FileSystemRights.FullControl, AccessControlType.Allow));
      acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null), FileSystemRights.ReadAndExecute, AccessControlType.Allow));
      File.SetAccessControl(file, acl);
    }
    static int Sc(string args) { using (var p = Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "sc.exe"), args) { UseShellExecute = false, CreateNoWindow = true })) { if (!p.WaitForExit(20000)) { p.Kill(); throw new Exception("SCM timeout"); } return p.ExitCode; } }
    static void Install(string owner, string core) {
      RequireAdmin(); new SecurityIdentifier(owner);
      if (!owner.StartsWith("S-1-5-21-")) throw new Exception("A local Windows user SID is required");
      if (Hash(core) != BuildInfo.CoreSha256) throw new Exception("Mihomo checksum mismatch");
      try { using (var old = new ServiceController(ServiceName)) { if (old.Status != ServiceControllerStatus.Stopped) { old.Stop(); old.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20)); } } } catch (InvalidOperationException) { }
      SecureDirectory(InstallRoot, true); SecureDirectory(DataRoot, false);
      var helper = Path.Combine(InstallRoot, "Capri.Windows.exe");
      var self = Process.GetCurrentProcess().MainModule.FileName;
      if (!String.Equals(self, helper, StringComparison.OrdinalIgnoreCase)) {
        for (int attempt = 0; ; attempt++) { try { File.Copy(self, helper, true); break; } catch (IOException) { if (attempt >= 10) throw; Thread.Sleep(200); } }
      }
      File.Copy(core, Path.Combine(InstallRoot, "mihomo.exe"), true);
      File.WriteAllText(Path.Combine(InstallRoot, "owner.json"), Json.Serialize(new { sid = owner }), new UTF8Encoding(false));
      foreach (var name in new[] { "Capri.Windows.exe", "mihomo.exe", "owner.json" }) SecureFile(Path.Combine(InstallRoot, name));
      if (Hash(Path.Combine(InstallRoot, "mihomo.exe")) != BuildInfo.CoreSha256) throw new Exception("Installed core integrity failed");
      int code = Sc("create " + ServiceName + " binPath= \"\\\"" + helper + "\\\"\" start= auto");
      if (code != 0 && code != 1073) throw new Exception("Service registration failed: " + code);
      Sc("description " + ServiceName + " \"Capri Mihomo TUN service\"");
      Sc("failure " + ServiceName + " reset= 900 actions= restart/5000/restart/15000/restart/30000");
      using (var service = new ServiceController(ServiceName)) { service.Start(); service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20)); }
      Emit(new { ok = true });
    }
    static void Uninstall() {
      RequireAdmin(); NoReparse(InstallRoot); NoReparse(DataRoot);
      try { using (var service = new ServiceController(ServiceName)) { if (service.Status != ServiceControllerStatus.Stopped) { service.Stop(); service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(25)); } } } catch (InvalidOperationException) { }
      int code = Sc("delete " + ServiceName); if (code != 0 && code != 1060 && code != 1072) throw new Exception("Service deletion failed: " + code);
      if (Directory.Exists(DataRoot)) Directory.Delete(DataRoot, true);
      foreach (var name in new[] { "mihomo.exe", "owner.json" }) { var f = Path.Combine(InstallRoot, name); if (File.Exists(f)) File.Delete(f); }
      var own = Path.Combine(InstallRoot, "Capri.Windows.exe");
      if (File.Exists(own)) { try { File.Delete(own); } catch (IOException) { Native.MoveFileEx(own, null, 4); } }
      try { if (Directory.Exists(InstallRoot)) Directory.Delete(InstallRoot, false); } catch (IOException) { Native.MoveFileEx(InstallRoot, null, 4); }
      Emit(new { ok = true });
    }
    static void Client() {
      var input = Console.In.ReadToEnd(); if (input.Length > 3 * 1024 * 1024) throw new Exception("Request too large");
      using (var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.None)) {
        pipe.Connect(3000);
        string exe; uint servicePid = Native.ServiceIdentity(ServiceName, out exe);
        uint pid; if (!Native.GetNamedPipeServerProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out pid) || pid != servicePid || pid == 0) throw new Exception("Untrusted service pipe");
        // Query SCM's protected configuration instead of opening the LocalSystem process,
        // whose DACL need not grant a standard user PROCESS_QUERY_LIMITED_INFORMATION.
        if (!String.Equals(exe.Trim().Trim('"'), Path.Combine(InstallRoot, "Capri.Windows.exe"), StringComparison.OrdinalIgnoreCase)) throw new Exception("Untrusted service executable");
        var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
        var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, true);
        writer.WriteLine(input.Replace("\r", "").Replace("\n", ""));
        var line = reader.ReadLine(); if (line == null) throw new Exception("Service connection closed"); Console.WriteLine(line);
      }
    }
    static void Sidecar(string coreFile, string directory, string configFile) {
      if (Hash(coreFile) != BuildInfo.CoreSha256) throw new Exception("Core integrity failed");
      using (var process = new Process { StartInfo = new ProcessStartInfo(coreFile, "-d \"" + directory + "\" -f \"" + configFile + "\"") { WorkingDirectory = directory, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true } }) {
        process.Start();
        using (var job = new OwnedJob(process)) {
          process.BeginOutputReadLine(); process.BeginErrorReadLine();
          var parentClosed = System.Threading.Tasks.Task.Run(() => Console.In.ReadToEnd());
          while (!parentClosed.IsCompleted && !process.WaitForExit(100)) { }
          if (!process.HasExited) process.Kill(); process.WaitForExit(5000);
          if (!parentClosed.IsCompleted && process.ExitCode != 0) throw new Exception("Core stopped unexpectedly");
        }
      }
    }
  }

  sealed class VpnService : ServiceBase {
    readonly object gate = new object();
    volatile bool exiting; bool desired; bool suspended; Process core; OwnedJob coreJob; string config; string secret = Program.RandomSecret(); int port; int failures; DateTime retryAt; DateTime lastLease = DateTime.UtcNow;
    string lastError = ""; string networkSignature = ""; string tunName = "CapriVPN"; Timer watchdog; NamedPipeServerStream server;
    string CoreFile { get { return Path.Combine(Program.InstallRoot, "mihomo.exe"); } }
    public VpnService() { ServiceName = Program.ServiceName; CanStop = true; CanShutdown = true; CanHandlePowerEvent = true; }
    protected override void OnStart(string[] args) {
      if (Program.Hash(CoreFile) != BuildInfo.CoreSha256) throw new Exception("Core integrity failed");
      exiting = false;
      networkSignature = PhysicalNetwork();
      new Thread(Serve) { IsBackground = true }.Start();
      watchdog = new Timer(CheckCore, null, 2000, 2000);
      NetworkChange.NetworkAddressChanged += NetworkChanged;
    }
    protected override void OnStop() {
      exiting = true; NetworkChange.NetworkAddressChanged -= NetworkChanged;
      if (watchdog != null) watchdog.Dispose();
      lock (gate) { desired = false; StopCore(); }
      if (server != null) server.Dispose();
    }
    protected override void OnShutdown() { OnStop(); }
    protected override bool OnPowerEvent(PowerBroadcastStatus status) {
      if (status == PowerBroadcastStatus.Suspend) lock (gate) { suspended = true; StopCore(); }
      else if (status == PowerBroadcastStatus.ResumeAutomatic || status == PowerBroadcastStatus.ResumeSuspend) lock (gate) { suspended = false; lastLease = DateTime.UtcNow; retryAt = DateTime.UtcNow.AddSeconds(3); }
      return true;
    }
    string PhysicalNetwork() {
      var adapters = new List<string>();
      foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces()) {
        if (adapter.OperationalStatus != OperationalStatus.Up || adapter.NetworkInterfaceType == NetworkInterfaceType.Loopback || adapter.NetworkInterfaceType == NetworkInterfaceType.Tunnel || String.Equals(adapter.Name, tunName, StringComparison.OrdinalIgnoreCase) || adapter.Description.IndexOf("wintun", StringComparison.OrdinalIgnoreCase) >= 0 || adapter.Description.IndexOf("sing-tun", StringComparison.OrdinalIgnoreCase) >= 0) continue;
        try { var addresses = new List<string>(); foreach (var address in adapter.GetIPProperties().UnicastAddresses) addresses.Add(address.Address.ToString()); addresses.Sort(StringComparer.Ordinal); adapters.Add(adapter.Id + ":" + String.Join(",", addresses)); } catch { }
      }
      adapters.Sort(StringComparer.Ordinal); return String.Join("|", adapters);
    }
    void NetworkChanged(object sender, EventArgs e) {
      lock (gate) {
        var next = PhysicalNetwork(); if (next == networkSignature) return; networkSignature = next;
        if (desired) { StopCore(); retryAt = DateTime.UtcNow.AddSeconds(3); }
      }
    }
    bool Running { get { return core != null && !core.HasExited; } }
    void CheckCore(object state) {
      lock (gate) {
        if (exiting || !desired || suspended) return;
        if ((DateTime.UtcNow - lastLease).TotalSeconds > 30) { desired = false; StopCore(); return; }
        if (Running || DateTime.UtcNow < retryAt) return;
        try { StartCore(); } catch { lastError = "Core recovery failed; check profile and network"; failures++; retryAt = DateTime.UtcNow.AddSeconds(Math.Min(60, 2 << Math.Min(failures, 5))); }
      }
    }
    void Serve() {
      var owner = Program.Text(Program.Parse(File.ReadAllText(Path.Combine(Program.InstallRoot, "owner.json"))), "sid");
      while (!exiting) {
        try {
          var security = new PipeSecurity(); security.SetAccessRuleProtection(true, false);
          security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(owner), PipeAccessRights.ReadWrite, AccessControlType.Allow));
          security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
          security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
          using (server = new NamedPipeServerStream(Program.PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security)) {
            server.WaitForConnection();
            var read = ReadBounded(new StreamReader(server, Encoding.UTF8, false, 4096, true));
            if (!read.Wait(10000) || read.Result == null || read.Result.Length > 3 * 1024 * 1024) continue;
            object response;
            try { lock (gate) { response = Dispatch(Program.Parse(read.Result)); } }
            catch { response = new { ok = false, error = "Service rejected request or core configuration; no unsafe settings were applied" }; }
            using (var writer = new StreamWriter(server, new UTF8Encoding(false), 4096, true) { AutoFlush = true }) writer.WriteLine(Program.Json.Serialize(response));
          }
        } catch { if (!exiting) Thread.Sleep(300); }
      }
    }
    async System.Threading.Tasks.Task<string> ReadBounded(StreamReader reader) {
      var text = new StringBuilder(); var buffer = new char[1024];
      while (text.Length <= 3 * 1024 * 1024) {
        int count = await reader.ReadAsync(buffer, 0, buffer.Length); if (count == 0) break;
        int newline = Array.IndexOf(buffer, '\n', 0, count);
        text.Append(buffer, 0, newline >= 0 ? newline : count); if (newline >= 0) return text.ToString();
      }
      throw new Exception("Incomplete or oversized service request");
    }
    object Dispatch(Dictionary<string, object> request) {
      var action = Program.Text(request, "action");
      if (action == "status") { lastLease = DateTime.UtcNow; return new { ok = true, running = Running, desired, error = lastError }; }
      if (action == "stop") { desired = false; StopCore(); return new { ok = true }; }
      if (action == "api") {
        if (!Running) throw new Exception("Core is not running");
        ApiPolicy.Check(request); lastLease = DateTime.UtcNow;
        var method = Program.Text(request, "method"); var target = Program.Text(request, "target");
        if (method == "PATCH" && target == "/configs") { desired = false; StopCore(); return new { ok = true, data = new Dictionary<string, object>() }; }
        var text = Api(method, target, request.ContainsKey("body") ? Program.Json.Serialize(request["body"]) : null);
        var data = String.IsNullOrEmpty(text) ? new Dictionary<string, object>() : Program.Parse(text);
        if (method == "GET" && target == "/connections") data = new Dictionary<string, object> { { "downloadTotal", data.ContainsKey("downloadTotal") ? data["downloadTotal"] : 0 }, { "uploadTotal", data.ContainsKey("uploadTotal") ? data["uploadTotal"] : 0 } };
        return new { ok = true, data };
      }
      if (action != "start") throw new Exception("Unknown service action");
      lastLease = DateTime.UtcNow;
      var doc = request.ContainsKey("config") ? request["config"] as Dictionary<string, object> : null;
      if (doc == null) throw new Exception("Missing config");
      Policy.Validate(doc);
      if (doc.ContainsKey("tun")) tunName = Program.Text((Dictionary<string, object>)doc["tun"], "device", "CapriVPN");
      networkSignature = PhysicalNetwork();
      var nextSecret = Program.RandomSecret();
      var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); int nextPort = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
      doc["external-controller"] = "127.0.0.1:" + nextPort; doc["secret"] = nextSecret;
      doc["allow-lan"] = false; doc["bind-address"] = "127.0.0.1";
      var file = Path.Combine(Program.DataRoot, "candidate.json");
      File.WriteAllText(file, Program.Json.Serialize(doc), new UTF8Encoding(false));
      using (var validation = MakeProcess("-t -d \"" + Program.DataRoot + "\" -f \"" + file + "\"")) {
        validation.Start(); validation.BeginOutputReadLine(); validation.BeginErrorReadLine();
        if (!validation.WaitForExit(20000)) { validation.Kill(); throw new Exception("Validation timeout"); }
        if (validation.ExitCode != 0) throw new Exception("Invalid configuration");
      }
      string previous = config, previousSecret = secret; int previousPort = port;
      bool wasDesired = desired; StopCore();
      config = Program.Json.Serialize(doc); secret = nextSecret; port = nextPort; desired = true; lastLease = DateTime.UtcNow;
      try { StartCore(); failures = 0; lastError = ""; }
      catch { config = previous; secret = previousSecret; port = previousPort; desired = wasDesired; if (desired && config != null) StartCore(); throw; }
      return new { ok = true, running = true };
    }
    Process MakeProcess(string args) {
      var p = new Process { StartInfo = new ProcessStartInfo(CoreFile, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = Program.DataRoot } };
      p.StartInfo.EnvironmentVariables.Remove("SAFE_PATHS");
      return p;
    }
    void StartCore() {
      if (Running || config == null) return;
      if (coreJob != null) coreJob.Dispose(); coreJob = null; if (core != null) core.Dispose(); core = null;
      if (Program.Hash(CoreFile) != BuildInfo.CoreSha256) throw new Exception("Core integrity failed");
      var file = Path.Combine(Program.DataRoot, "runtime.json"); File.WriteAllText(file, config, new UTF8Encoding(false));
      core = MakeProcess("-d \"" + Program.DataRoot + "\" -f \"" + file + "\"");
      core.Start(); coreJob = new OwnedJob(core); core.BeginOutputReadLine(); core.BeginErrorReadLine();
      for (int i = 0; i < 80; i++) { if (core.HasExited) throw new Exception("Core exited"); try { Api("GET", "/version", null); return; } catch { Thread.Sleep(100); } }
      StopCore(); throw new Exception("Core readiness timeout");
    }
    string Api(string method, string endpoint, string body) {
      var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + endpoint); request.Proxy = null; request.Method = method; request.Timeout = 2500;
      request.Headers["Authorization"] = "Bearer " + secret;
      if (body != null) { request.ContentType = "application/json"; var bytes = Encoding.UTF8.GetBytes(body); using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length); }
      using (var response = request.GetResponse()) using (var reader = new StreamReader(response.GetResponseStream())) {
        var text = new StringBuilder(); var buffer = new char[4096]; int count;
        while ((count = reader.Read(buffer, 0, buffer.Length)) > 0) { text.Append(buffer, 0, count); if (text.Length > 4 * 1024 * 1024) throw new Exception("Core response too large"); }
        return text.ToString();
      }
    }
    void StopCore() {
      if (core == null) return;
      try { if (!core.HasExited) { try { Api("PATCH", "/configs", "{\"tun\":{\"enable\":false}}"); } catch { } if (!core.WaitForExit(500)) core.Kill(); core.WaitForExit(5000); } } finally { if (coreJob != null) coreJob.Dispose(); coreJob = null; core.Dispose(); core = null; }
    }
  }

  static class ApiPolicy {
    public static void Check(Dictionary<string, object> request) {
      foreach (var key in request.Keys) if (key != "action" && key != "method" && key != "target" && key != "body") throw new Exception("Invalid API request field");
      string method = Program.Text(request, "method"), target = Program.Text(request, "target");
      bool body = request.ContainsKey("body") && request["body"] != null;
      if (method == "GET" && (target == "/version" || target == "/connections" || target == "/proxies") && !body) return;
      if (method == "DELETE" && target == "/connections" && !body) return;
      if (target.StartsWith("/proxies/", StringComparison.Ordinal)) {
        var rest = target.Substring(9); var path = rest.Split('?')[0];
        bool delay = path.EndsWith("/delay", StringComparison.Ordinal);
        var name = Uri.UnescapeDataString(delay ? path.Substring(0, path.Length - 6) : path);
        if (String.IsNullOrEmpty(name) || name.IndexOfAny(new[] { '\\', '\r', '\n', '\0' }) >= 0) throw new Exception("Invalid proxy API path");
        foreach (var segment in name.Split('/')) if (segment == "." || segment == "..") throw new Exception("Proxy path traversal is forbidden");
        if (method == "GET" && delay && !body && rest.Substring(path.Length) == "?timeout=5000&url=" + Uri.EscapeDataString("https://www.gstatic.com/generate_204")) return;
        if (method == "PUT" && !delay && !rest.Contains("?") && body) {
          var doc = request["body"] as Dictionary<string, object>;
          if (doc != null && doc.Count == 1 && doc.ContainsKey("name") && doc["name"] is string && ((string)doc["name"]).Length <= 200) return;
        }
      }
      if (method == "PATCH" && target == "/configs" && body) {
        var doc = request["body"] as Dictionary<string, object>; object value;
        if (doc != null && doc.Count == 1 && doc.TryGetValue("tun", out value)) {
          var tun = value as Dictionary<string, object>;
          if (tun != null && tun.Count == 1 && tun.ContainsKey("enable") && tun["enable"] is bool && !(bool)tun["enable"]) return;
        }
      }
      throw new Exception("API operation is not allowed");
    }
  }

  sealed class OwnedJob : IDisposable {
    IntPtr handle;
    [StructLayout(LayoutKind.Sequential)] struct BASIC { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IO { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC Basic; public IO Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int info, ref EXTENDED data, uint size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public OwnedJob(Process process) {
      handle = CreateJobObject(IntPtr.Zero, null); var data = new EXTENDED(); data.Basic.Flags = 0x2000;
      if (handle == IntPtr.Zero || !SetInformationJobObject(handle, 9, ref data, (uint)Marshal.SizeOf(data)) || !AssignProcessToJobObject(handle, process.Handle)) {
        if (!process.HasExited) process.Kill(); Dispose(); throw new Exception("Cannot establish Windows process ownership");
      }
    }
    public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
  }

  static class Policy {
    static readonly HashSet<string> Root = new HashSet<string>(new[] { "mode", "log-level", "ipv6", "mixed-port", "allow-lan", "bind-address", "external-controller", "secret", "dns", "tun", "proxies", "proxy-groups", "proxy-providers", "rule-providers", "rules", "hosts", "profile", "unified-delay", "tcp-concurrent", "find-process-mode", "global-client-fingerprint", "geodata-mode" });
    public static void Validate(Dictionary<string, object> doc) {
      foreach (var key in doc.Keys) if (!Root.Contains(key)) throw new Exception("Unsupported root setting");
      Walk(doc, "", 0);
      object value;
      if (doc.TryGetValue("mixed-port", out value) && (Convert.ToInt32(value) < 1024 || Convert.ToInt32(value) > 65535)) throw new Exception("Invalid port");
      if (doc.TryGetValue("tun", out value)) {
        var tun = value as Dictionary<string, object>; if (tun == null) throw new Exception("Invalid TUN");
        var allowed = new HashSet<string>(new[] { "enable", "stack", "device", "auto-route", "strict-route", "auto-detect-interface", "dns-hijack", "mtu", "inet4-address", "inet6-address", "route-address", "route-exclude-address", "exclude-interface" });
        foreach (var key in tun.Keys) if (!allowed.Contains(key)) throw new Exception("Invalid TUN setting");
        if (!new HashSet<string>(new[] { "system", "gvisor", "mixed" }).Contains(Program.Text(tun, "stack", "mixed"))) throw new Exception("Invalid stack");
        if (tun.ContainsKey("mtu") && (Convert.ToInt32(tun["mtu"]) < 1280 || Convert.ToInt32(tun["mtu"]) > 9000)) throw new Exception("Invalid MTU");
        if (!System.Text.RegularExpressions.Regex.IsMatch(Program.Text(tun, "device", "CapriVPN"), "^[A-Za-z0-9 _-]{1,40}$")) throw new Exception("Invalid interface name");
      }
      foreach (var collection in new[] { "proxy-providers", "rule-providers" }) if (doc.TryGetValue(collection, out value)) {
        var providers = value as Dictionary<string, object>; if (providers == null) throw new Exception("Invalid providers");
        foreach (var entry in providers) {
          var provider = entry.Value as Dictionary<string, object>; if (provider == null) throw new Exception("Invalid provider");
          if (Program.Text(provider, "type") != "http") throw new Exception("Only HTTPS providers are allowed in service mode");
          Uri url; if (!Uri.TryCreate(Program.Text(provider, "url"), UriKind.Absolute, out url) || url.Scheme != "https" || url.IsLoopback || !String.IsNullOrEmpty(url.UserInfo)) throw new Exception("Invalid provider URL");
          var hash = BitConverter.ToString(SHA256.Create().ComputeHash(Encoding.UTF8.GetBytes(collection + entry.Key))).Replace("-", "").ToLowerInvariant();
          provider["path"] = "./providers/" + hash + (Program.Text(provider, "format") == "mrs" ? ".mrs" : ".yaml");
        }
      }
      if (doc.TryGetValue("dns", out value)) {
        var dns = value as Dictionary<string, object>; if (dns == null) throw new Exception("Invalid DNS");
        dns["listen"] = "127.0.0.1:1053";
      }
    }
    static void Walk(object value, string parent, int depth) {
      if (depth > 32) throw new Exception("Configuration too deep");
      var scalar = value as string;
      if (scalar != null && (scalar.StartsWith("file:", StringComparison.OrdinalIgnoreCase) || scalar.StartsWith("\\\\") || System.Text.RegularExpressions.Regex.IsMatch(scalar, "^[A-Za-z]:[\\\\/]"))) throw new Exception("Local file references are not allowed");
      var dict = value as Dictionary<string, object>;
      if (dict != null) foreach (var pair in dict) {
        if (new HashSet<string>(new[] { "__proto__", "constructor", "prototype", "script", "command", "executable", "plugin", "external-ui", "external-ui-url", "external-controller-unix", "external-controller-pipe", "private-key-file", "certificate", "ca", "safe-paths", "geox-url", "mmdb-url" }).Contains(pair.Key)) throw new Exception("Unsafe setting");
        if (pair.Key == "path" && parent != "ws-opts" && parent != "h2-opts" && !parent.StartsWith("provider:")) throw new Exception("Local paths are not accepted");
        var child = (parent == "proxy-providers" || parent == "rule-providers") ? "provider:" + pair.Key : pair.Key;
        Walk(pair.Value, child, depth + 1);
      } else if (value is IEnumerable && !(value is string)) foreach (var child in (IEnumerable)value) Walk(child, parent, depth + 1);
    }
  }

  static class Icons {
    public static object Read(Dictionary<string, object> request) {
      var file = Program.Text(request, "file"); int index = 0; Int32.TryParse(Program.Text(request, "index"), out index);
      IntPtr large = IntPtr.Zero, small = IntPtr.Zero;
      try {
        var images = new IntPtr[1]; var ids = new uint[1];
        Native.PrivateExtractIcons(file, index, 96, 96, images, ids, 1, 0); large = images[0];
        if (large == IntPtr.Zero) Native.ExtractIconEx(file, index, out large, out small, 1);
        if (large == IntPtr.Zero && small == IntPtr.Zero) {
          Native.SHFILEINFO info = new Native.SHFILEINFO();
          Native.SHGetFileInfo(file, 0, ref info, (uint)Marshal.SizeOf(info), 0x100); large = info.hIcon;
        }
        var handle = large != IntPtr.Zero ? large : small;
        if (handle == IntPtr.Zero) return new { ok = false };
        using (var icon = Icon.FromHandle(handle)) using (var bitmap = icon.ToBitmap()) using (var stream = new MemoryStream()) {
          bitmap.Save(stream, ImageFormat.Png); return new { ok = true, icon = "data:image/png;base64," + Convert.ToBase64String(stream.ToArray()) };
        }
      } finally { if (large != IntPtr.Zero) Native.DestroyIcon(large); if (small != IntPtr.Zero && small != large) Native.DestroyIcon(small); }
    }
  }
  static class Native {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SHFILEINFO { public IntPtr hIcon; public int iIcon; public uint attributes; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string displayName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string typeName; }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern uint ExtractIconEx(string file, int index, out IntPtr large, out IntPtr small, uint count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint PrivateExtractIcons(string file, int index, int width, int height, [Out] IntPtr[] icons, [Out] uint[] ids, uint count, uint flags);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SHGetFileInfo(string file, uint attrs, ref SHFILEINFO info, uint size, uint flags);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool MoveFileEx(string oldPath, string newPath, int flags);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint pid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern IntPtr OpenSCManager(string machine, string database, uint access);
    [DllImport("advapi32.dll", SetLastError = true)] static extern IntPtr OpenService(IntPtr manager, string name, uint access);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool QueryServiceStatusEx(IntPtr service, int level, IntPtr buffer, uint size, out uint needed);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryServiceConfig(IntPtr service, IntPtr config, uint size, out uint needed);
    [DllImport("advapi32.dll")] static extern bool CloseServiceHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential)] struct SERVICE_CONFIG { public uint Type, Start, Error; public IntPtr BinaryPath, Group; public uint Tag; public IntPtr Dependencies, Account, DisplayName; }
    public static uint ServiceIdentity(string name, out string image) {
      IntPtr scm = OpenSCManager(null, null, 1), service = IntPtr.Zero, buffer = Marshal.AllocHGlobal(36), config = IntPtr.Zero;
      try {
        service = OpenService(scm, name, 5); uint needed;
        if (service == IntPtr.Zero || !QueryServiceStatusEx(service, 0, buffer, 36, out needed)) throw new Exception("Service is not installed/running");
        uint pid = (uint)Marshal.ReadInt32(buffer, 28);
        QueryServiceConfig(service, IntPtr.Zero, 0, out needed);
        if (needed == 0 || needed > 65536) throw new Exception("Cannot authenticate service configuration");
        config = Marshal.AllocHGlobal((int)needed);
        if (!QueryServiceConfig(service, config, needed, out needed)) throw new Exception("Cannot authenticate service configuration");
        image = Marshal.PtrToStringUni(((SERVICE_CONFIG)Marshal.PtrToStructure(config, typeof(SERVICE_CONFIG))).BinaryPath);
        return pid;
      }
      finally { Marshal.FreeHGlobal(buffer); if (config != IntPtr.Zero) Marshal.FreeHGlobal(config); if (service != IntPtr.Zero) CloseServiceHandle(service); if (scm != IntPtr.Zero) CloseServiceHandle(scm); }
    }
  }
}
