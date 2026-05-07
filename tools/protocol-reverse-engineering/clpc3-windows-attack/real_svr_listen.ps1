param(
  [int]$Port = 18080,
  [int]$Seconds = 90
)

$ErrorActionPreference = "Stop"
$interop = "C:\Program Files (x86)\CLICK\TMS\Interop.RealSvrOcxTcpLib.dll"
Add-Type -Path $interop

$server = New-Object RealSvrOcxTcpLib.RealSvrOcxTcpClass

function Print-Args($label, $args) {
  $stamp = Get-Date -Format "HH:mm:ss.fff"
  Write-Host ""
  Write-Host "[$stamp] EVENT $label"
  for ($i = 0; $i -lt $args.Count; $i++) {
    Write-Host ("  arg{0}: {1}" -f $i, $args[$i])
  }
}

Register-ObjectEvent -InputObject $server -EventName OnReceiveGLogData -SourceIdentifier GLogData -Action {
  Print-Args "OnReceiveGLogData" $Event.SourceArgs
} | Out-Null

Register-ObjectEvent -InputObject $server -EventName OnReceiveGLogDataExtend -SourceIdentifier GLogDataExtend -Action {
  Print-Args "OnReceiveGLogDataExtend" $Event.SourceArgs
} | Out-Null

Register-ObjectEvent -InputObject $server -EventName OnReceiveGLogText -SourceIdentifier GLogText -Action {
  Print-Args "OnReceiveGLogText" $Event.SourceArgs
  try {
    $clientIP = [string]$Event.SourceArgs[0]
    $clientPort = [int]$Event.SourceArgs[1]
    $r1 = $Event.Sender.SendResponse($clientIP, $clientPort, "OK")
    $r2 = $Event.Sender.SendRtLogResponseV1($clientIP, $clientPort, "OK")
    $r3 = $Event.Sender.SendRtLogResponseV3($clientIP, $clientPort, "OK")
    Write-Host "  responses: SendResponse=$r1 V1=$r2 V3=$r3"
  } catch {
    Write-Host "  response error: $($_.Exception.Message)"
  }
} | Out-Null

Register-ObjectEvent -InputObject $server -EventName OnReceiveGLogTextAndImage -SourceIdentifier GLogTextAndImage -Action {
  Print-Args "OnReceiveGLogTextAndImage" $Event.SourceArgs
} | Out-Null

Register-ObjectEvent -InputObject $server -EventName OnReceiveGLogTextOnDoorOpen -SourceIdentifier GLogTextOnDoorOpen -Action {
  Print-Args "OnReceiveGLogTextOnDoorOpen" $Event.SourceArgs
} | Out-Null

Write-Host "Opening RealSvrOcxTcp on port $Port ..."
$openResult = $server.OpenNetwork($Port)
Write-Host "OpenNetwork($Port) => $openResult"
Write-Host "Listening for $Seconds seconds."

$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  Wait-Event -Timeout 1 | Out-Null
}

Write-Host "Closing RealSvrOcxTcp port $Port ..."
$closeResult = $server.CloseNetwork($Port)
Write-Host "CloseNetwork($Port) => $closeResult"
