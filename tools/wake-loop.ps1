$ErrorActionPreference = 'Continue'
$wake = 'E:\reportador\inbox\AGENT_WAKE.json'
if (Test-Path $wake) {
  Write-Output 'AGENT_LOOP_WAKE_reportador {"prompt":"Procesar pedido Reportador pendiente: leer inbox/AGENT_WAKE.json, aplicar el cambio en E:\\reportador, npm run build, crear DONE, limpiar WORKING/BUSY/WAKE"}'
}
