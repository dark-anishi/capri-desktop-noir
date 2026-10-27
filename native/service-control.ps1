param(
  [Parameter(Mandatory=$true)][ValidateSet('install','uninstall','start','stop')][string]$Operation,
  [Parameter(Mandatory=$true)][string]$Helper,
  [string]$Core,
  [string]$Owner
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
if ($Helper.Contains('"') -or $Core.Contains('"')) { throw 'Invalid component path' }
if ($Operation -eq 'install') {
  if ($Owner -notmatch '^S-1-5-21-[0-9-]+$') { throw 'Invalid owner SID' }
  $componentArgs = @('--install', $Owner, ('"' + $Core + '"'))
} elseif ($Operation -eq 'uninstall') { $componentArgs = @('--uninstall') }
elseif ($Operation -eq 'start') { $componentArgs = @('--service-start') }
else { $componentArgs = @('--service-stop') }
$serviceOperation = Start-Process -FilePath $Helper -ArgumentList $componentArgs -Verb RunAs -WindowStyle Hidden -Wait -PassThru
$code = $serviceOperation.ExitCode
if ($null -eq $code) { $code = 1 }
@{ok=($code -eq 0);code=[int]$code} | ConvertTo-Json -Compress
exit $code
} catch {
  $code = 1
  for ($cause = $_.Exception; $null -ne $cause; $cause = $cause.InnerException) {
    if ($cause -is [System.ComponentModel.Win32Exception]) { $code = $cause.NativeErrorCode; break }
  }
  @{ok=$false;code=[int]$code} | ConvertTo-Json -Compress
  exit $code
}
