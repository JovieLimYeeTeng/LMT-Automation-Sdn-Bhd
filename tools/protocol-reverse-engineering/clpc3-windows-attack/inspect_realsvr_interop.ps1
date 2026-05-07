$asmPath = "C:\Program Files (x86)\CLICK\TMS\Interop.RealSvrOcxTcpLib.dll"
$asm = [Reflection.Assembly]::LoadFrom($asmPath)

foreach ($type in $asm.GetTypes()) {
  if ($type.FullName -like "*RealSvr*") {
    Write-Host "TYPE $($type.FullName) base=$($type.BaseType)"
    foreach ($event in $type.GetEvents()) {
      Write-Host "  EVENT $($event.Name) handler=$($event.EventHandlerType.FullName)"
      $invoke = $event.EventHandlerType.GetMethod("Invoke")
      foreach ($p in $invoke.GetParameters()) {
        Write-Host "    PARAM $($p.ParameterType.FullName) $($p.Name)"
      }
    }
    foreach ($method in $type.GetMethods()) {
      if ($method.DeclaringType.FullName -like "*RealSvr*") {
        $params = ($method.GetParameters() | ForEach-Object { "$($_.ParameterType.Name) $($_.Name)" }) -join ", "
        Write-Host "  METHOD $($method.ReturnType.Name) $($method.Name)($params)"
      }
    }
  }
}
