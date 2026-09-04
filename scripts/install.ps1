# Spotcheck installer for Windows.
# Usage (PowerShell): irm https://raw.githubusercontent.com/relauts/spotcheck/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"

$SpotcheckHome = if ($env:SPOTCHECK_HOME) { $env:SPOTCHECK_HOME } else { Join-Path $env:USERPROFILE "spotcheck" }
$NodeDir = Join-Path $SpotcheckHome ".node"
$BinDir = if ($env:SPOTCHECK_BIN_DIR) { $env:SPOTCHECK_BIN_DIR } else { Join-Path $SpotcheckHome "bin" }
$Wrapper = Join-Path $BinDir "spotcheck.cmd"
$NodeVersion = if ($env:SPOTCHECK_NODE_VERSION) { $env:SPOTCHECK_NODE_VERSION } else { "22.19.0" }
$Package = "@relauts/spotcheck"
$UiUrl = "http://127.0.0.1:18733"
$MinMajor = 18
$MinMinor = 18

function Write-Info([string]$Message) {
  Write-Host $Message
}

function Test-NodeVersionOk {
  try {
    $ver = (& node -p "process.versions.node" 2>$null)
    if (-not $ver) { return $false }
    $parts = $ver.Split(".")
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    if ($major -gt $MinMajor) { return $true }
    if ($major -eq $MinMajor -and $minor -ge $MinMinor) { return $true }
    return $false
  } catch {
    return $false
  }
}

function Get-NodePlatform {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  switch ($arch) {
    "x64" { return "win-x64" }
    "arm64" { return "win-arm64" }
    default { throw "Unsupported CPU: $arch" }
  }
}

function Install-PortableNode {
  if ((Test-Path (Join-Path $NodeDir "node.exe")) -and (Test-NodeVersionOkWithPath $NodeDir)) {
    Write-Info "Using Node at $NodeDir"
    return
  }

  $platform = Get-NodePlatform
  $zipName = "node-v$NodeVersion-$platform.zip"
  $url = "https://nodejs.org/dist/v$NodeVersion/$zipName"
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("spotcheck-node-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $zipPath = Join-Path $tmp $zipName
  $extractName = "node-v$NodeVersion-$platform"

  Write-Info "Downloading Node.js v$NodeVersion ($platform)..."
  Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  Expand-Archive -Path $zipPath -DestinationPath $tmp -Force

  if (Test-Path $NodeDir) {
    Remove-Item -Recurse -Force $NodeDir
  }
  New-Item -ItemType Directory -Path $SpotcheckHome -Force | Out-Null
  Move-Item -Path (Join-Path $tmp $extractName) -Destination $NodeDir
  Remove-Item -Recurse -Force $tmp
  Write-Info "Installed Node.js to $NodeDir"
}

function Test-NodeVersionOkWithPath([string]$Dir) {
  $oldPath = $env:Path
  try {
    $env:Path = "$Dir;$oldPath"
    return Test-NodeVersionOk
  } finally {
    $env:Path = $oldPath
  }
}

function Ensure-Node {
  New-Item -ItemType Directory -Path $SpotcheckHome -Force | Out-Null
  if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-NodeVersionOk)) {
    $ver = & node -p "process.versions.node"
    Write-Info "Using system Node $ver"
    return
  }
  Install-PortableNode
  $env:Path = "$NodeDir;$env:Path"
}

function Ensure-UserPath {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $userPath) { $userPath = "" }
  $parts = $userPath -split ";" | Where-Object { $_ -ne "" }
  if ($parts -contains $BinDir) {
    return
  }
  $newPath = if ($userPath) { "$BinDir;$userPath" } else { $BinDir }
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  $env:Path = "$BinDir;$env:Path"
  Write-Info "Added $BinDir to your user PATH"
  Write-Info "Open a new terminal if 'spotcheck' is not found in this one."
}

function Write-Wrapper {
  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  $content = @"
@echo off
set "SPOTCHECK_HOME=$SpotcheckHome"
if exist "%SPOTCHECK_HOME%\.node\node.exe" set "PATH=%SPOTCHECK_HOME%\.node;%PATH%"
cd /d "%SPOTCHECK_HOME%"
npx --yes $Package %*
"@
  Set-Content -Path $Wrapper -Value $content -Encoding ASCII
  Write-Info "Installed command: spotcheck ($Wrapper)"
  Ensure-UserPath
}

Write-Info "Spotcheck installer"
Write-Info "Install folder: $SpotcheckHome"
Ensure-Node
Write-Wrapper
if (Test-Path (Join-Path $NodeDir "node.exe")) {
  $env:Path = "$NodeDir;$env:Path"
}
$env:Path = "$BinDir;$env:Path"

Write-Info ""
Write-Info "Starting Spotcheck..."
Write-Info "Open $UiUrl in your browser."
Write-Info "Later, just type: spotcheck"
Write-Info ""

Set-Location $SpotcheckHome
& npx --yes $Package
