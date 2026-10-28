// Shared by the native WinEvent watcher and the PowerShell fallback. No elevation.
namespace CapriWindows {
  using System;
  using System.Diagnostics;
  using System.Runtime.InteropServices;
  using System.Text;

  public static class ForegroundActivity {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int capacity);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder image, ref int size);

    static uint cachedPid; static string executable = "", imagePath = "";
    static void Identity(uint pid) {
      if (cachedPid == pid) return;
      cachedPid = pid; executable = imagePath = "";
      try { using (var process = Process.GetProcessById((int)pid)) executable = process.ProcessName + ".exe"; } catch { }
      IntPtr handle = OpenProcess(0x1000, false, pid);
      if (handle == IntPtr.Zero) return;
      try { int capacity = 32768; var image = new StringBuilder(capacity); if (QueryFullProcessImageName(handle, 0, image, ref capacity)) imagePath = image.ToString(); }
      finally { CloseHandle(handle); }
    }
    static string Quote(string text) {
      var result = new StringBuilder("\"");
      foreach (char c in text) {
        if (c == '\\' || c == '"') result.Append('\\').Append(c);
        else if (c < 32) result.Append("\\u").Append(((int)c).ToString("x4"));
        else result.Append(c);
      }
      return result.Append('"').ToString();
    }
    public static string Json(long self) {
      return JsonForWindow(self, GetForegroundWindow());
    }
    // Kept internal so native regression fixtures can query their own HWND
    // without activating a window or taking keyboard focus from the user.
    internal static string JsonForWindow(long self, IntPtr foreground) {
      uint pid, selfPid;
      GetWindowThreadProcessId(foreground, out pid); GetWindowThreadProcessId(new IntPtr(self), out selfPid);
      bool own = pid != 0 && pid == selfPid;
      var name = new StringBuilder(128); GetClassName(foreground, name, name.Capacity);
      string windowClass = name.ToString();
      bool desktop = windowClass == "Progman" || windowClass == "WorkerW" || windowClass == "Shell_TrayWnd" || windowClass == "Shell_SecondaryTrayWnd";
      bool fullscreen = false, exclusive = false, gamePath = false;
      string display = "null";
      bool eligible = !own && !desktop && pid != 0 && !IsIconic(foreground);
      if (eligible) {
        Identity(pid);
        RECT frame; var monitor = new MONITORINFO(); monitor.Size = Marshal.SizeOf(typeof(MONITORINFO));
        if (GetWindowRect(foreground, out frame) && GetMonitorInfo(MonitorFromWindow(foreground, 2), ref monitor)) {
          display = "{\"x\":" + monitor.Monitor.Left + ",\"y\":" + monitor.Monitor.Top + ",\"width\":" + (monitor.Monitor.Right - monitor.Monitor.Left) + ",\"height\":" + (monitor.Monitor.Bottom - monitor.Monitor.Top) + "}";
          fullscreen = Math.Abs(frame.Left - monitor.Monitor.Left) <= 2 && Math.Abs(frame.Top - monitor.Monitor.Top) <= 2 && Math.Abs(frame.Right - monitor.Monitor.Right) <= 2 && Math.Abs(frame.Bottom - monitor.Monitor.Bottom) <= 2;
        }
        int state; if (SHQueryUserNotificationState(out state) == 0) exclusive = state == 3;
        gamePath = imagePath.IndexOf("\\steamapps\\common\\", StringComparison.OrdinalIgnoreCase) >= 0;
      }
      return "{\"display\":" + display + ",\"own\":" + (own || desktop ? "true" : "false") + ",\"fullscreen\":" + (fullscreen ? "true" : "false") + ",\"exclusive\":" + (exclusive ? "true" : "false") + ",\"gamePath\":" + (gamePath ? "true" : "false") + ",\"executable\":" + Quote(eligible ? executable : "") + ",\"windowClass\":" + Quote(eligible ? windowClass : "") + "}";
    }
  }
}
