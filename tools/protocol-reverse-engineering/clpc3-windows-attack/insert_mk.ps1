$mdb="C:\Program Files (x86)\CLICK\TMS\Pay_data.mdb"
$c=New-Object System.Data.OleDb.OleDbConnection
$c.ConnectionString="Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$mdb;Jet OLEDB:Database Password=eClick"
$c.Open()
# Insert master key with 10 year validity
$key = "11475-2295-26775-2550-AF-7905-5355-13770-0-1530"
$expiry = "2036-12-31"
$cmd=$c.CreateCommand()
$cmd.CommandText="INSERT INTO SystemMasterKey (MasterKey, ValidDate) VALUES ('$key', #$expiry#)"
try {
  $rows = $cmd.ExecuteNonQuery()
  Write-Host ("inserted rows: $rows")
} catch { Write-Host ("err: "+$_.Exception.Message) }
# Verify
$cmd2=$c.CreateCommand()
$cmd2.CommandText="SELECT MasterKey, ValidDate FROM SystemMasterKey"
$r=$cmd2.ExecuteReader()
while($r.Read()){
  Write-Host ("row: key="+$r[0]+" valid="+$r[1])
}
$r.Close()
$c.Close()
