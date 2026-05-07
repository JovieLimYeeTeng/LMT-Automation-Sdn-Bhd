$ErrorActionPreference = 'Continue'
$fp = New-Object -ComObject 'FP_CLOCK.FP_CLOCKCtrl.1'

Write-Host "1. SetTCPTimeout"
$null = $fp.SetTCPTimeout(5000)

Write-Host "2. SetIPAddress with ByRef"
$ip = '192.168.100.153'
try {
    $r = $fp.SetIPAddress([ref]$ip, 5005, 1)
    Write-Host ("  result: " + $r)
} catch {
    Write-Host ("  err: " + $_.Exception.Message)
}

Write-Host "3. OpenCommPort(1)"
try {
    $r = $fp.OpenCommPort(1)
    Write-Host ("  result: " + $r)
} catch {
    Write-Host ("  err: " + $_.Exception.Message)
}
Start-Sleep -Milliseconds 700

Write-Host "4. GetSerialNumber"
try {
    $sn = ''
    $r = $fp.GetSerialNumber(1, [ref]$sn)
    Write-Host ("  result=" + $r + " SN=[" + $sn + "]")
} catch {
    Write-Host ("  err: " + $_.Exception.Message)
}

Write-Host "5. GetDeviceTime"
try {
    $y = 0; $m = 0; $d = 0; $h = 0; $mi = 0; $s = 0
    $r = $fp.GetDeviceTime(1, [ref]$y, [ref]$m, [ref]$d, [ref]$h, [ref]$mi, [ref]$s)
    Write-Host ("  result=" + $r + " time=" + $y + "-" + $m + "-" + $d + " " + $h + ":" + $mi + ":" + $s)
} catch {
    Write-Host ("  err: " + $_.Exception.Message)
}

Write-Host "6. ReadAllUserID then loop"
try {
    $r = $fp.ReadAllUserID(1)
    Write-Host ("  ReadAllUserID=" + $r)
    if ($r) {
        for ($i=0; $i -lt 30; $i++) {
            $eid = 0; $bk = 0; $adm = 0; $en = 0; $more = 0
            $rr = $fp.GetAllUserID(1, [ref]$eid, [ref]$bk, [ref]$adm, [ref]$en, [ref]$more)
            if (-not $rr) { Write-Host ("  loop end after " + $i); break }
            Write-Host ("  user eid=" + $eid + " backup=" + $bk + " admin=" + $adm + " en=" + $en + " more=" + $more)
            if ($more -eq 0) { break }
        }
    }
} catch {
    Write-Host ("  err: " + $_.Exception.Message)
}

Write-Host "7. ReadAllGLogData then loop"
try {
    $r = $fp.ReadAllGLogData(1)
    Write-Host ("  ReadAllGLogData=" + $r)
    if ($r) {
        for ($i=0; $i -lt 30; $i++) {
            $eid = 0; $vf = 0; $io = 0; $y = 0; $mo = 0; $d = 0; $h = 0; $mi = 0; $more = 0
            $rr = $fp.GetAllGLogData(1, [ref]$eid, [ref]$vf, [ref]$io, [ref]$y, [ref]$mo, [ref]$d, [ref]$h, [ref]$mi, [ref]$more)
            if (-not $rr) { Write-Host ("  loop end after " + $i); break }
            Write-Host ("  log eid=" + $eid + " vf=" + $vf + " io=" + $io + " " + $y + "-" + $mo + "-" + $d + " " + $h + ":" + $mi + " more=" + $more)
            if ($more -eq 0) { break }
        }
    }
} catch {
    Write-Host ("  err: " + $_.Exception.Message)
}

Write-Host "8. CloseCommPort"
$fp.CloseCommPort()
Write-Host "done"
