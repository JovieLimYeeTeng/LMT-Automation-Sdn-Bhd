$mdb = "C:\Program Files (x86)\CLICK\TMS\Pay_data.mdb"
$conn = New-Object System.Data.OleDb.OleDbConnection
$conn.ConnectionString = "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$mdb;Jet OLEDB:Database Password=eClick"
$conn.Open()
# 不带 WHERE 全表 UPDATE（只有一行）
$sql = "UPDATE ConnectionSetting SET ipaddress = '192.168.100.153'"
$cmd2 = $conn.CreateCommand()
$cmd2.CommandText = $sql
try {
  $rows = $cmd2.ExecuteNonQuery()
  Write-Host ("step1 rows: $rows")
} catch { Write-Host ("step1 err: " + $_.Exception.Message) }
$conn.Close()

# Reopen and verify
$c = New-Object System.Data.OleDb.OleDbConnection
$c.ConnectionString = "Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$mdb;Jet OLEDB:Database Password=eClick"
$c.Open()
$cmd3 = $c.CreateCommand()
$cmd3.CommandText = "SELECT ipaddress, Portno FROM ConnectionSetting"
$r3 = $cmd3.ExecuteReader()
while ($r3.Read()) { Write-Host ("after: ip=$($r3[0]) port=$($r3[1])") }
$r3.Close()
$c.Close()
