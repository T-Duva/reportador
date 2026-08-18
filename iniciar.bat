@echo off
cd /d "%~dp0"
if not exist dist\index.html (
  echo Compilando Reportador...
  call npm run build
)
start "Reportador servidor" /min cmd /c "node server\index.mjs"
timeout /t 2 /nobreak >nul
start "Reportador escuchador" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File tools\escuchar.ps1
timeout /t 1 /nobreak >nul
start "Reportador keep-alive" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File tools\keep-alive.ps1
echo Reportador arriba. Keep-alive: activo 9-19h. No cierra Once ni Reposicion.
exit /b 0
