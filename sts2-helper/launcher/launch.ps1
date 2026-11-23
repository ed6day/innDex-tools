# STS2 Helper launcher: updates (optional), installs dependencies when they change, starts the
# server if it isn't already running, waits until it answers, then opens the dashboard.
# Usage: launch.ps1 [-NoUpdate] [-NoBrowser] [-Port 3000]
param(
  [switch]$NoUpdate,
  [switch]$NoBrowser,
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot          # ...\sts2-helper
$repo = Split-Path -Parent $app                  # ...\innDex-tools
$url = "http://localhost:$Port"
$host.UI.RawUI.WindowTitle = 'STS2 Helper launcher'

function Say($text, $color = 'Gray') { Write-Host "  $text" -ForegroundColor $color }
function Fail($text) {
  Write-Host ''
  Say $text 'Red'
  Write-Host ''
  Read-Host '  Press Enter to close'
  exit 1
}

function Test-Server {
  try {
    # 127.0.0.1, not localhost: the server listens on IPv4, and Windows tries ::1 first.
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/api/state/latest"
    return $true
  } catch {
    # 404 means the server is up but has no state yet.
    return ($_.Exception.Response -ne $null)
  }
}

Write-Host ''
Say 'STS2 Helper' 'Cyan'
Write-Host ''

# 1. Already running? Just open the dashboard.
if (Test-Server) {
  Say "Server already running at $url" 'Green'
  if (-not $NoBrowser) { Start-Process $url }
  exit 0
}

# 2. Node.js is required.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js was not found. Install the LTS version from https://nodejs.org/ and run this again.' }
Say "Node.js $(node --version)"

# 3. Pull updates (best effort; the repo may be owned by another Windows account).
if (-not $NoUpdate -and (Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $repo '.git'))) {
  Say 'Checking for updates...'
  $branch = (git -c safe.directory=* -C $repo rev-parse --abbrev-ref HEAD 2>$null)
  if ($branch) {
    git -c safe.directory=* -C $repo pull --ff-only origin $branch 2>&1 | ForEach-Object { Say $_ 'DarkGray' }
  }
}

# 4. Install dependencies when package-lock.json changed since the last install.
$lock = Join-Path $app 'package-lock.json'
$stamp = Join-Path $app 'node_modules\.sts2-lock-hash'
$hash = (Get-FileHash $lock -Algorithm SHA256).Hash
$installed = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { '' }
if ($hash -ne $installed) {
  Say 'Installing dependencies (first run or after an update)...' 'Yellow'
  Push-Location $app
  try {
    & npm install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { Fail 'npm install failed. See the messages above.' }
  } finally { Pop-Location }
  Set-Content -Path $stamp -Value $hash -Encoding ascii
}

# 5. Start the server in its own minimised window (close that window to stop it).
Say "Starting server on $url ..."
$env:PORT = "$Port"
Start-Process -FilePath 'cmd.exe' -WorkingDirectory $app -WindowStyle Minimized `
  -ArgumentList "/k title STS2 Helper server & node server.js" | Out-Null

# 6. Wait until it answers (up to 30 s), then open the dashboard.
$deadline = (Get-Date).AddSeconds(30)
while (-not (Test-Server)) {
  if ((Get-Date) -gt $deadline) { Fail "The server didn't start. Open the minimised 'STS2 Helper server' window to see why." }
  Start-Sleep -Milliseconds 500
}
Say "Ready: $url" 'Green'
Say "The server runs in the minimised 'STS2 Helper server' window. Close it (or run Stop STS2 Helper) to stop." 'DarkGray'
if (-not $NoBrowser) { Start-Process $url }
Start-Sleep -Seconds 2
