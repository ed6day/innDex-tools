#Requires -Version 5.1
<#
.SYNOPSIS
    Installs STS2 Decision Helper and its dependencies, then builds the mod.

.DESCRIPTION
    1. Checks for .NET 9 SDK
    2. Downloads and installs ModSmith into STS2's mods folder
    3. Downloads and installs RitsuLib into STS2's mods folder
    4. Builds STS2DecisionHelper and deploys it to the mods folder

.NOTES
    Run from PowerShell as: .\install.ps1
    If STS2 is in a non-standard Steam location, edit Directory.Build.props first.
#>

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"

Write-Host ""
Write-Host "  STS2 Decision Helper -- Installer" -ForegroundColor Cyan
Write-Host "  ===================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Check .NET 9 SDK -----------------------------------------------------

Write-Host "[1/4] Checking .NET SDK..." -ForegroundColor Yellow
try {
    $dotnetVer = (& dotnet --version 2>&1).Trim()
} catch {
    Write-Host "  ERROR: 'dotnet' not found. Install .NET 9 SDK from:" -ForegroundColor Red
    Write-Host "  https://dotnet.microsoft.com/download/dotnet/9.0" -ForegroundColor Red
    exit 1
}
if (-not $dotnetVer.StartsWith("9.")) {
    Write-Host "  ERROR: .NET 9 SDK required but found: $dotnetVer" -ForegroundColor Red
    Write-Host "  https://dotnet.microsoft.com/download/dotnet/9.0" -ForegroundColor Red
    exit 1
}
Write-Host "  .NET $dotnetVer OK" -ForegroundColor Green

# --- 2. Find STS2 installation ------------------------------------------------

Write-Host "[2/4] Locating Slay the Spire 2..." -ForegroundColor Yellow

$sts2Path = $null
$steamReg = Get-ItemProperty "HKCU:\Software\Valve\Steam" -Name "SteamPath" -ErrorAction SilentlyContinue
$candidates = @()
if ($steamReg) { $candidates += "$($steamReg.SteamPath)\steamapps\common\Slay the Spire 2" }
$candidates += "C:\Program Files (x86)\Steam\steamapps\common\Slay the Spire 2"
$candidates += "C:\Program Files\Steam\steamapps\common\Slay the Spire 2"
$candidates += "D:\SteamLibrary\steamapps\common\Slay the Spire 2"

foreach ($c in $candidates) {
    if (Test-Path $c) { $sts2Path = $c; break }
}

if (-not $sts2Path) {
    Write-Host "  ERROR: STS2 not found in any of these locations:" -ForegroundColor Red
    $candidates | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "  Fix: open Directory.Build.props and uncomment the SteamLibraryPath line." -ForegroundColor Yellow
    exit 1
}

$modsPath = "$sts2Path\mods"
Write-Host "  Found: $sts2Path" -ForegroundColor Green

if (-not (Test-Path $modsPath)) {
    New-Item -ItemType Directory -Path $modsPath -Force | Out-Null
    Write-Host "  Created mods folder: $modsPath" -ForegroundColor Green
}

# --- 3. Download and install mod frameworks ----------------------------------

Write-Host "[3/4] Installing mod frameworks..." -ForegroundColor Yellow

function Install-ModZip {
    param(
        [string]$Name,
        [string]$Url,
        [string]$ModFolderName
    )

    $dest = "$modsPath\$ModFolderName"
    if (Test-Path "$dest\$ModFolderName.json") {
        Write-Host "  $Name already installed, skipping." -ForegroundColor DarkGray
        return
    }

    $zip = "$env:TEMP\$Name-install.zip"
    Write-Host "  Downloading $Name..." -ForegroundColor Cyan
    try {
        Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing
    } catch {
        Write-Host "  ERROR downloading $Name`: $_" -ForegroundColor Red
        exit 1
    }

    $extract = "$env:TEMP\$Name-extract"
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $extract -Force

    # Find the mod folder inside the zip (folder that contains the .json manifest)
    $modFolder = Get-ChildItem $extract -Recurse -Filter "*.json" |
                 Where-Object { $_.BaseName -eq $ModFolderName } |
                 Select-Object -First 1 |
                 ForEach-Object { $_.Directory }

    if (-not $modFolder) {
        $modFolder = Get-ChildItem $extract -Directory | Select-Object -First 1
    }
    if (-not $modFolder) {
        $modFolder = Get-Item $extract
    }

    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Copy-Item $modFolder.FullName -Destination $dest -Recurse -Force
    Write-Host "  $Name installed to: $dest" -ForegroundColor Green

    Remove-Item $zip     -Force -ErrorAction SilentlyContinue
    Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
}

Install-ModZip -Name "ModSmith" `
               -Url "https://github.com/cpimhoff/Sts2-ModSmith/releases/download/v0.0.2/ModSmith.zip" `
               -ModFolderName "ModSmith"

Install-ModZip -Name "STS2-RitsuLib" `
               -Url "https://github.com/BAKAOLC/STS2-RitsuLib/releases/download/v0.3.0/STS2-RitsuLib.0.3.0.variant-pack.zip" `
               -ModFolderName "STS2-RitsuLib"

# --- 4. Build and install our mod --------------------------------------------

Write-Host "[4/4] Building STS2 Decision Helper..." -ForegroundColor Yellow

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir
try {
    & dotnet build -c Release --nologo 2>&1 | ForEach-Object {
        $line = "$_"
        if ($line -match " error ") { Write-Host "  $line" -ForegroundColor Red }
        elseif ($line -match " warning ") { Write-Host "  $line" -ForegroundColor Yellow }
        elseif ($line.Trim() -ne "") { Write-Host "  $line" -ForegroundColor DarkGray }
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "  Build failed. Common causes:" -ForegroundColor Red
        Write-Host "  - STS2 path not found (edit Directory.Build.props)" -ForegroundColor Red
        Write-Host "  - .NET 9 SDK not installed" -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

# --- Done --------------------------------------------------------------------

Write-Host ""
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "  1. Start the Node server: open a new terminal, cd to sts2-helper, run 'npm install' then 'npm start'" -ForegroundColor White
Write-Host "  2. Open the dashboard:    http://localhost:3000/" -ForegroundColor White
Write-Host "  3. Launch STS2 - the dashboard updates live as you play" -ForegroundColor White
Write-Host ""
Write-Host "  NOTE: GameStateSerializer.cs has TODO stubs for game state properties." -ForegroundColor Yellow
Write-Host "  Use ILSpy or dnSpy to browse sts2.dll and fill them in." -ForegroundColor Yellow
Write-Host ""
