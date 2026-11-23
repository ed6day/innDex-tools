# Stops the STS2 Helper server: the process listening on the port (default 3000).
param([int]$Port = 3000)

$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
  Write-Host "  STS2 Helper isn't running on port $Port."
} else {
  foreach ($procId in ($conns.OwningProcess | Sort-Object -Unique)) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq 'node') {
      Stop-Process -Id $procId -Force
      Write-Host "  Stopped STS2 Helper (node, PID $procId)."
    } elseif ($p) {
      Write-Host "  Port $Port is used by $($p.ProcessName) (PID $procId), not the helper; leaving it alone."
    }
  }
}
Start-Sleep -Seconds 2
