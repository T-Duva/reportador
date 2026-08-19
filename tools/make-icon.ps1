# Genera iconos LIGUX desde la foto que mandó Tomás.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$py = Join-Path $PSScriptRoot 'make-ligux-icon.py'
if (-not (Test-Path $py)) { throw "Falta $py" }
python $py
Write-Output 'icons ok (foto de Tomás)'
