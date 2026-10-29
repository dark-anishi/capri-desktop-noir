# Watches the top-level windows so Capri can sit on them.
# Prints one JSON line whenever something changes: the foreground window and the visible
# windows in z-order (front first), as physical-pixel frame bounds. No titles, no contents.
#
#   powershell -File windows.ps1 <capri hwnd> <capri pid>

param([long]$Self = 0, [int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'

$capriActivitySource = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'window-activity.cs'))
$capriTrackerSource = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CapriWindowSnapshot {
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

  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: real pixels everywhere
  }

  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr RegisterPowerSettingNotification(IntPtr recipient, ref Guid setting, uint flags);
  [DllImport("user32.dll")] static extern bool UnregisterPowerSettingNotification(IntPtr handle);
  public static IntPtr WatchDisplay(long self) {
    Guid setting = new Guid("2B84C20E-AD23-4DDF-93DB-05FFBD7EFCA5");
    return RegisterPowerSettingNotification(new IntPtr(self), ref setting, 0);
  }
  public static void StopDisplay(IntPtr handle) { if (handle != IntPtr.Zero) UnregisterPowerSettingNotification(handle); }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr h, IntPtr after, string cls, string caption);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
  public static bool RepairInput(long self, int parentPid) {
    IntPtr parent = new IntPtr(self); uint owner;
    GetWindowThreadProcessId(parent, out owner);
    if (owner != parentPid || !IsWindowVisible(parent) || IsIconic(parent)) return false;
    IntPtr child = FindWindowEx(parent, IntPtr.Zero, "Chrome_RenderWidgetHostHWND", null);
    if (child == IntPtr.Zero || IsWindowVisible(child)) return false;
    GetWindowThreadProcessId(child, out owner);
    if (owner != parentPid) return false;
    ShowWindow(child, 8);
    return IsWindowVisible(child);
  }

  public static string Snapshot(long self) {
    var sb = new StringBuilder();
    sb.Append("{\"fg\":").Append(GetForegroundWindow().ToInt64()).Append(",\"activity\":").Append(CapriWindows.ForegroundActivity.Json(self)).Append(",\"wins\":[");
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
"@
Add-Type -TypeDefinition ($capriTrackerSource + [Environment]::NewLine + $capriActivitySource)

[CapriWindowSnapshot]::Init()
$displayPower = [CapriWindowSnapshot]::WatchDisplay($Self)
if ($displayPower -eq [IntPtr]::Zero) { [Console]::Error.WriteLine('Display power notification registration failed') }
$last = ''
$tick = 0
try {
while ($true) {
  if (($tick % 15 -eq 0) -and [CapriWindowSnapshot]::RepairInput($Self, $ParentPid)) {
    [Console]::Out.WriteLine('{"inputRecovered":true}')
    [Console]::Out.Flush()
  }
  $snap = [CapriWindowSnapshot]::Snapshot($Self)
  if ($snap -ne $last) {
    [Console]::Out.WriteLine($snap)
    [Console]::Out.Flush()
    $last = $snap
  }
  # stop with Capri, even if she crashed without telling us
  $tick++
  if ($ParentPid -and ($tick % 20 -eq 0) -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 33
}
} finally { [CapriWindowSnapshot]::StopDisplay($displayPower) }
