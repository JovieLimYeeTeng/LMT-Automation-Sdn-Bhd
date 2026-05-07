$ErrorActionPreference = "Continue"

$ocx = New-Object -ComObject "RealSvrOcxTcp.RealSvrOcxTcpCtrl.1"
Write-Host "COM object created: RealSvrOcxTcp.RealSvrOcxTcpCtrl.1"
Write-Host ""
Write-Host "Members:"
$ocx | Get-Member | Select-Object MemberType, Name, Definition | Format-Table -AutoSize

Write-Host ""
Write-Host "Event registration probe:"
$events = @(
  "OnReceiveGLogData",
  "OnReceiveGLogDataExtend",
  "OnReceiveGLogTextAndImage",
  "OnReceiveGLogText",
  "OnReceiveGLogTextOnDoorOpen"
)

foreach ($eventName in $events) {
  try {
    Register-ObjectEvent -InputObject $ocx -EventName $eventName -SourceIdentifier $eventName -Action {
      Write-Host "EVENT $($Event.SourceIdentifier)"
      Write-Host ($Event.SourceEventArgs | Out-String)
    } | Out-Null
    Write-Host "OK   $eventName"
  } catch {
    Write-Host "FAIL $eventName :: $($_.Exception.Message)"
  }
}

Get-EventSubscriber | Format-Table -AutoSize
