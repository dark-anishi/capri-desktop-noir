// Capri owns only the batch tree it creates. No Zapret service control or name-based killing.
using System;
using System.IO;
using System.IO.Pipes;
using System.Diagnostics;
using System.Collections.Generic;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.ComponentModel;

namespace CapriWindows {
  static class ZapretBridge {
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
    public static void Broker() {
      RunBroker(delegate(string name, string secret) {
        var executable = Process.GetCurrentProcess().MainModule.FileName;
        return Process.Start(new ProcessStartInfo(executable, "--zapret-host " + name + " " + secret) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden });
      });
    }
    // A launcher seam lets the integration fixture exercise the actual protocol without UAC.
    internal static void RunBroker(Func<string, string, Process> launchHost) {
      var request = Console.ReadLine();
      if (request == null || request.Length > 128 * 1024) throw new Exception("Invalid Zapret request");
      var spec = Program.Parse(request);
      var name = "CapriZapret." + Guid.NewGuid().ToString("N");
      var secret = Program.RandomSecret();
      var security = new PipeSecurity(); security.SetAccessRuleProtection(true, false);
      security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
      security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
      using (var pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security)) {
        // Any end of the stdin lease, including an Electron crash, tears down our pipe and job.
        var leaseEnded = new ManualResetEvent(false);
        var lease = new Thread(delegate() { try { Console.ReadLine(); } catch { } finally { leaseEnded.Set(); try { pipe.Dispose(); } catch { } } }); lease.IsBackground = true; lease.Start();
        using (var host = launchHost(name, secret)) {
          if (leaseEnded.WaitOne(0)) return;
          var connection = pipe.BeginWaitForConnection(null, null);
          if (!connection.AsyncWaitHandle.WaitOne(15000)) throw new Exception("Компонент Zapret не подключился после UAC.");
          pipe.EndWaitForConnection(connection);
          uint client;
          if (host == null || !GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out client) || client != (uint)host.Id) throw new Exception("Unexpected Zapret pipe client");
          using (var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, true))
          using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true }) {
            if (reader.ReadLine() != secret) throw new Exception("Zapret authentication failed");
            writer.WriteLine(Program.Json.Serialize(spec));
            string line;
            while ((line = reader.ReadLine()) != null) {
              var result = Program.Parse(line); Program.Emit(result);
              if (Program.Text(result, "phase") == "stopped" || (result.ContainsKey("ok") && result["ok"] is bool && !(bool)result["ok"])) break;
            }
          }
        }
      }
    }

    public static void Host(string name, string secret) {
      if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator)) throw new Exception("Zapret требует подтверждение UAC.");
      RunHost(name, secret);
    }
    internal static void RunHost(string name, string secret) {
      if (!name.StartsWith("CapriZapret.") || name.Length != 44 || secret.Length != 64) throw new Exception("Invalid Zapret lease");
      // The lease reader remains pending while status is written. A synchronous Windows
      // pipe handle serializes these operations and blocks "running" behind that read.
      using (var pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Identification)) {
        pipe.Connect(15000);
        using (var reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, true))
        using (var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true }) {
          writer.WriteLine(secret);
          try {
            var request = reader.ReadLine(); if (request == null || request.Length > 128 * 1024) throw new Exception("Invalid Zapret request");
            var spec = Program.Parse(request);
            using (var locked = new ZapretFiles(spec))
            {
            if (ZapretJob.AnyRunningEngine(locked.Engines)) throw new Exception("Этот движок Zapret уже запущен. Останови его вручную перед запуском из Capri.");
            using (var job = new ZapretJob(locked.Folder, locked.Batch, locked.Engines)) {
              var ended = new ManualResetEvent(false);
              var monitor = new Thread(delegate() { try { reader.ReadLine(); } catch { } finally { ended.Set(); } }); monitor.IsBackground = true; monitor.Start();
              // The batch may exit after `start`; readiness belongs to its pinned engine in this job.
              var startupDeadline = DateTime.UtcNow.AddSeconds(10);
              while (!ended.WaitOne(250) && !job.HasEngine) {
                if (job.Active == 0 || DateTime.UtcNow >= startupDeadline) throw new Exception("Стратегия Zapret не запустила свой движок из папки bin. Проверь совместимость и другой запущенный Zapret.");
              }
              if (ended.WaitOne(750)) return;
              if (!job.HasEngine) throw new Exception("Стратегия Zapret сразу завершилась. Проверь совместимость и другой запущенный Zapret.");
              writer.WriteLine(Program.Json.Serialize(new { ok = true, phase = "running" }));
              while (!ended.WaitOne(500)) if (!job.HasEngine) throw new Exception("Процесс Zapret завершился. Проверь выбранную стратегию.");
            }
            }
          } catch (Exception e) {
            try { writer.WriteLine(Program.Json.Serialize(new { ok = false, error = e.Message })); } catch { }
          }
        }
      }
    }
  }

  sealed class ZapretFiles : IDisposable {
    readonly List<FileStream> locks = new List<FileStream>();
    public readonly string Folder, Batch;
    public readonly List<string> Engines = new List<string>();
    public ZapretFiles(Dictionary<string, object> spec) {
      try {
        Folder = Path.GetFullPath(Program.Text(spec, "folder")); Batch = Program.Text(spec, "batch");
        if (!Path.IsPathRooted(Folder) || Folder.StartsWith("\\\\") || Batch != Path.GetFileName(Batch) || !Batch.StartsWith("general", StringComparison.OrdinalIgnoreCase) || !Batch.EndsWith(".bat", StringComparison.OrdinalIgnoreCase)) throw new Exception("Invalid Zapret strategy");
        for (var current = new DirectoryInfo(Folder); current != null; current = current.Parent) if ((current.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("Zapret folder must not contain directory links");
        object value; var files = spec.TryGetValue("files", out value) ? value as Dictionary<string, object> : null;
        if (files == null || files.Count < 2 || files.Count > 512 || !files.ContainsKey(Batch)) throw new Exception("Invalid Zapret file inventory");
        foreach (var entry in files) {
          var relative = entry.Key.Replace('/', Path.DirectorySeparatorChar);
          if (Path.IsPathRooted(relative) || relative.IndexOf(':') >= 0 || relative.IndexOf('\0') >= 0) throw new Exception("Invalid Zapret path");
          var file = Path.GetFullPath(Path.Combine(Folder, relative));
          if (!file.StartsWith(Folder.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("Invalid Zapret path");
          for (var parent = new FileInfo(file).Directory; parent != null && parent.FullName.Length >= Folder.Length; parent = parent.Parent) if ((parent.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("Zapret directory link rejected");
          if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new Exception("Zapret file link rejected");
          var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read); locks.Add(stream);
          using (var sha = System.Security.Cryptography.SHA256.Create()) {
            var actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            if (actual != Convert.ToString(entry.Value)) throw new Exception("Файлы Zapret изменились во время запуска. Повтори запуск.");
          }
          if (String.Equals(Path.GetDirectoryName(relative), "bin", StringComparison.OrdinalIgnoreCase) && String.Equals(Path.GetExtension(relative), ".exe", StringComparison.OrdinalIgnoreCase)) Engines.Add(file);
        }
        var source = File.ReadAllText(Path.Combine(Folder, Batch));
        Engines.RemoveAll(delegate(string engine) { return source.IndexOf(Path.GetFileName(engine), StringComparison.OrdinalIgnoreCase) < 0; });
        if (Engines.Count == 0) throw new Exception("Стратегия Zapret не ссылается на проверенный движок из bin.");
      } catch { Dispose(); throw; }
    }
    public void Dispose() { foreach (var stream in locks) stream.Dispose(); locks.Clear(); }
  }

  sealed class ZapretJob : IDisposable {
    IntPtr job;
    readonly string[] engines;
    [StructLayout(LayoutKind.Sequential)] struct BASIC { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct IO { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct EXTENDED { public BASIC Basic; public IO Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long UserTime, KernelTime, PeriodUser, PeriodKernel; public uint PageFaults, Total, Active, Terminated; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUP { public uint cb; public string reserved, desktop, title; public uint x, y, width, height, charsX, charsY, fill, flags; public short show, reserved2; public IntPtr bytes, input, output, error; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS { public IntPtr process, thread; public uint pid, tid; }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attr, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int info, ref EXTENDED data, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int info, out ACCOUNTING data, uint size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttr, IntPtr threadAttr, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUP startup, out PROCESS process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public uint Active { get { ACCOUNTING data; if (!QueryInformationJobObject(job, 1, out data, (uint)Marshal.SizeOf(typeof(ACCOUNTING)), IntPtr.Zero)) throw new Win32Exception(); return data.Active; } }
    static bool FindEngine(IEnumerable<string> engines, IntPtr job) {
      foreach (var engine in engines) foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(engine))) using (process) {
        IntPtr handle = IntPtr.Zero;
        try {
          handle = OpenProcess(0x1000, false, process.Id); if (handle == IntPtr.Zero) continue; // QUERY_LIMITED_INFORMATION.
          bool member;
          if (job != IntPtr.Zero && (!IsProcessInJob(handle, job, out member) || !member)) continue;
          var image = new StringBuilder(32768); uint size = (uint)image.Capacity;
          if (QueryFullProcessImageName(handle, 0, image, ref size) && String.Equals(Path.GetFullPath(image.ToString()), Path.GetFullPath(engine), StringComparison.OrdinalIgnoreCase) && !process.HasExited) return true;
        } catch (InvalidOperationException) { /* An observed process may exit while queried. */ }
        finally { if (handle != IntPtr.Zero) CloseHandle(handle); }
      }
      return false;
    }
    public static bool AnyRunningEngine(IEnumerable<string> engines) { return FindEngine(engines, IntPtr.Zero); }
    public bool HasEngine { get { return FindEngine(engines, job); } }
    public ZapretJob(string folder, string batch, IEnumerable<string> enginePaths) {
      engines = new List<string>(enginePaths).ToArray();
      PROCESS process = new PROCESS();
      try {
        job = CreateJobObject(IntPtr.Zero, null); var data = new EXTENDED(); data.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway.
        if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref data, (uint)Marshal.SizeOf(data))) throw new Win32Exception();
        // Environment expansion avoids injecting paths through a command-string encoder.
        // /v:off prevents exclamation marks in user folder names being interpreted.
        Environment.SetEnvironmentVariable("CAPRI_ZAPRET_BATCH", Path.Combine(folder, batch));
        Environment.SetEnvironmentVariable("NO_UPDATE_CHECK", "1");
        var cmd = Path.Combine(Environment.SystemDirectory, "cmd.exe");
        var command = new StringBuilder("\"" + cmd + "\" /d /v:off /s /c \"\"%CAPRI_ZAPRET_BATCH%\"\"");
        var startup = new STARTUP(); startup.cb = (uint)Marshal.SizeOf(startup);
        if (!CreateProcess(cmd, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000004, IntPtr.Zero, folder, ref startup, out process)) throw new Win32Exception();
        // Suspend-before-assign closes the fast `start` race: descendants always inherit ownership.
        if (!AssignProcessToJobObject(job, process.process)) throw new Win32Exception();
        if (ResumeThread(process.thread) == uint.MaxValue) throw new Win32Exception();
      } catch { if (process.process != IntPtr.Zero) TerminateProcess(process.process, 1); Dispose(); throw; }
      finally { if (process.thread != IntPtr.Zero) CloseHandle(process.thread); if (process.process != IntPtr.Zero) CloseHandle(process.process); }
    }
    public void Dispose() { if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; } }
  }
}
