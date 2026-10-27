param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$coreArchive = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $coreEntry = $coreArchive.GetEntry('mihomo-windows-amd64-v1.exe')
  if (-not $coreEntry) { throw 'Expected core executable missing from verified archive' }
  [IO.Compression.ZipFileExtensions]::ExtractToFile($coreEntry, $Output, $true)
} finally { $coreArchive.Dispose() }
