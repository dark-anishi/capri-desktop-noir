// Geometry and window events only; runs without elevation.
using System;
using System.Diagnostics;
using System.Threading;
using System.Runtime.InteropServices;
using System.Text;

namespace CapriWindows {
static class WindowTracker {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int WS_EX_NOACTIVATE = 0x08000000;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const int DWMWA_CLOAKED = 14;

  delegate void WinEventProc(IntPtr hook, uint evt, IntPtr hwnd, int obj, int child, uint thread, uint time);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; public uint extra; }
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc, uint process, uint thread, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr hwnd, UIntPtr id, uint interval, IntPtr proc);
  [DllImport("user32.dll")] static extern bool KillTimer(IntPtr hwnd, UIntPtr id);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hwnd, uint min, uint max, uint flags);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread, uint msg, UIntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  public static void Run(long self, int parentPid) {
    if (self <= 0 || parentPid <= 0) throw new ArgumentException("Invalid window watcher owner");
    Init(); bool dirty = true;
    WinEventProc callback = (hook, evt, hwnd, obj, child, thread, time) => {
      if (hwnd.ToInt64() != self && (evt < 0x8000 || (obj == 0 && child == 0))) dirty = true;
    };
    var callbackRoot = GCHandle.Alloc(callback);
    IntPtr systemHook = IntPtr.Zero, objectHook = IntPtr.Zero; UIntPtr timer = UIntPtr.Zero;
    try {
      systemHook = SetWinEventHook(3, 0x17, IntPtr.Zero, callback, 0, 0, 2);
      objectHook = SetWinEventHook(0x8000, 0x800B, IntPtr.Zero, callback, 0, 0, 2);
      if (systemHook == IntPtr.Zero || objectHook == IntPtr.Zero) throw new Exception("Window event hook unavailable");
      timer = SetTimer(IntPtr.Zero, UIntPtr.Zero, 16, IntPtr.Zero);
      if (timer == UIntPtr.Zero) throw new Exception("Window event timer unavailable");
      MSG initial; PeekMessage(out initial, IntPtr.Zero, 0, 0, 0);
      uint threadId = GetCurrentThreadId();
      ThreadPool.QueueUserWorkItem(_ => { try { Console.In.ReadToEnd(); } catch { } PostThreadMessage(threadId, 0x12, UIntPtr.Zero, IntPtr.Zero); });
      var clock = Stopwatch.StartNew(); long lastScan = -500, lastParentCheck = -1000; string last = null;
      using (var parent = Process.GetProcessById(parentPid)) {
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
          if (msg.message == 0x113 && msg.wParam.Equals(timer)) {
            long now = clock.ElapsedMilliseconds;
            if (now - lastParentCheck >= 1000) { if (parent.HasExited) break; lastParentCheck = now; }
            if (dirty || now - lastScan >= 500) {
              dirty = false; lastScan = now; string snap = Snapshot(self);
              if (snap != last) { Console.WriteLine(snap); Console.Out.Flush(); last = snap; }
            }
          }
          TranslateMessage(ref msg); DispatchMessage(ref msg);
        }
      }
    } finally {
      if (timer != UIntPtr.Zero) KillTimer(IntPtr.Zero, timer);
      if (systemHook != IntPtr.Zero) UnhookWinEvent(systemHook);
      if (objectHook != IntPtr.Zero) UnhookWinEvent(objectHook);
      callbackRoot.Free();
    }
  }

  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: real pixels everywhere
  }

  public static string Snapshot(long self) {
    var sb = new StringBuilder();
    sb.Append("{\"fg\":").Append(GetForegroundWindow().ToInt64()).Append(",\"activity\":").Append(ForegroundActivity.Json(self)).Append(",\"wins\":[");
    int count = 0;
    EnumWindows((h, l) => {
      if (count >= 40) return false;
      if (h.ToInt64() == self || !IsWindowVisible(h) || IsIconic(h)) return true;
      int ex = GetWindowLong(h, GWL_EXSTYLE);
      if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_NOACTIVATE) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
      var cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      RECT r;
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0) return true;
      if (r.Right - r.Left < 200 || r.Bottom - r.Top < 120) return true;
      if (count > 0) sb.Append(',');
      count++;
      sb.Append("{\"id\":").Append(h.ToInt64())
        .Append(",\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top)
        .Append(",\"w\":").Append(r.Right - r.Left).Append(",\"h\":").Append(r.Bottom - r.Top)
        .Append(",\"max\":").Append(IsZoomed(h) ? "true" : "false").Append('}');
      return true;
    }, IntPtr.Zero);
    sb.Append("]}");
    return sb.ToString();
  }
}
}
