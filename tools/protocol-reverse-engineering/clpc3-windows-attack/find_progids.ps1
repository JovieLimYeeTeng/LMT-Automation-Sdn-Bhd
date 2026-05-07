# Find CLICK / Click / Riss / FP / FK COM ProgIDs
Write-Host "=== HKLM\SOFTWARE\Classes (64-bit) ==="
Get-ChildItem 'HKLM:\SOFTWARE\Classes' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'FP_?CLOCK|Riss|TMPCCOMM|FPClock|RealSvr|FKAttend|Riss\.Devices' } |
  Select-Object -ExpandProperty Name

Write-Host ""
Write-Host "=== HKLM\SOFTWARE\WOW6432Node\Classes (32-bit, where 32-bit OCX register) ==="
Get-ChildItem 'HKLM:\SOFTWARE\WOW6432Node\Classes' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'FP_?CLOCK|Riss|TMPCCOMM|FPClock|RealSvr|FKAttend|Riss\.Devices' } |
  Select-Object -ExpandProperty Name

Write-Host ""
Write-Host "=== TypeLib defaults containing FP/Riss/TMS/Click ==="
Get-ChildItem 'HKLM:\SOFTWARE\Classes\TypeLib' -ErrorAction SilentlyContinue |
  ForEach-Object {
    $tl = $_.PSPath
    Get-ChildItem $tl -ErrorAction SilentlyContinue | ForEach-Object {
      $val = (Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue).'(default)'
      if ($val -match 'FP|Riss|TMS|Click|FK') { Write-Host "  $($_.Name) = $val" }
    }
  }

Write-Host ""
Write-Host "=== 32-bit TypeLib ==="
Get-ChildItem 'HKLM:\SOFTWARE\WOW6432Node\Classes\TypeLib' -ErrorAction SilentlyContinue |
  ForEach-Object {
    $tl = $_.PSPath
    Get-ChildItem $tl -ErrorAction SilentlyContinue | ForEach-Object {
      $val = (Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue).'(default)'
      if ($val -match 'FP|Riss|TMS|Click|FK') { Write-Host "  $($_.Name) = $val" }
    }
  }

Write-Host ""
Write-Host "=== Riss.Devices ProgID (it's .NET regasm'd) ==="
Get-ChildItem 'HKLM:\SOFTWARE\Classes' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'Riss' } | Select-Object -ExpandProperty Name | Select-Object -First 20

Get-ChildItem 'HKLM:\SOFTWARE\WOW6432Node\Classes' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'Riss' } | Select-Object -ExpandProperty Name | Select-Object -First 20
