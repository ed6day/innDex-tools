# Creates "STS2 Helper" and "Stop STS2 Helper" shortcuts on the Desktop and in the Start menu.
# Uses the game's icon when Slay the Spire 2 is installed in the default Steam folder.
$app = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$gameExe = 'C:\Program Files (x86)\Steam\steamapps\common\Slay the Spire 2\SlayTheSpire2.exe'
$icon = if (Test-Path $gameExe) { "$gameExe,0" } else { "$env:SystemRoot\System32\shell32.dll,13" }

$targets = @(
  @{ Name = 'STS2 Helper'; Cmd = (Join-Path $app 'STS2 Helper.cmd'); Desc = 'Start the STS2 Helper server and open the dashboard' },
  @{ Name = 'Stop STS2 Helper'; Cmd = (Join-Path $app 'launcher\Stop STS2 Helper.cmd'); Desc = 'Stop the STS2 Helper server' }
)
$folders = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'STS2 Helper'))

foreach ($folder in $folders) {
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  foreach ($t in $targets) {
    # Only the launcher goes on the Desktop; both go in the Start menu folder.
    if ($folder -eq $folders[0] -and $t.Name -ne 'STS2 Helper') { continue }
    $lnk = $shell.CreateShortcut((Join-Path $folder "$($t.Name).lnk"))
    $lnk.TargetPath = $t.Cmd
    $lnk.WorkingDirectory = $app
    $lnk.IconLocation = $icon
    $lnk.Description = $t.Desc
    $lnk.WindowStyle = 1  # normal, so any error message is visible
    $lnk.Save()
    Write-Host "  Created $(Join-Path $folder "$($t.Name).lnk")"
  }
}
Write-Host ''
Write-Host '  Done. Double-click "STS2 Helper" on your Desktop to start.'
Start-Sleep -Seconds 3
