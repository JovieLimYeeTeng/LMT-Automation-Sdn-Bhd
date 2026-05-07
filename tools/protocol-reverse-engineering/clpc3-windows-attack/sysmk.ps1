$mdb="C:\Program Files (x86)\CLICK\TMS\Pay_data.mdb"
$c=New-Object System.Data.OleDb.OleDbConnection
$c.ConnectionString="Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$mdb;Jet OLEDB:Database Password=eClick"
$c.Open()
$cmd=$c.CreateCommand()
$cmd.CommandText="SELECT * FROM SystemMasterKey"
$r=$cmd.ExecuteReader()
$cols=@()
for($i=0;$i -lt $r.FieldCount;$i++){$cols+=$r.GetName($i)}
Write-Host ("cols: "+($cols -join ','))
while($r.Read()){
  $vals=@()
  for($i=0;$i -lt $r.FieldCount;$i++){$vals+=$r[$i]}
  Write-Host ("row: "+($vals -join '|'))
}
$r.Close()
$c.Close()
