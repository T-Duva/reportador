# Reportador keep-alive: servidor + escuchador + Tunnelmole en puerto 8789.
# No mata tuneles de Once (8787) ni Reposicion (8788).
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$serverJson = Join-Path $root 'server.json'
$tunnelLog = Join-Path $root 'tools\_tunnelmole.log'
$keepLog = Join-Path $root 'tools\_keep-alive.log'
$pollSecActive = 90
$pollSecSleep = 20   # corto para que /prender de Telegram se note ya
$wakeHour = 9
$sleepHour = 23
$localHealth = 'http://127.0.0.1:8789/api/health'
$script:ModeActive = $null
$script:PublicFailCount = 0
$script:LastTunnelRestart = [datetime]::MinValue
$minRestartGapSec = 900   # 15 min entre reinicios de tunel
$failThreshold = 3        # 3 chequeos seguidos antes de reiniciar

function Write-Keep([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Write-Host $line
  try { Add-Content -Path $keepLog -Value $line -Encoding UTF8 } catch {}
}

function Test-TelegramForce {
  $forceRoot = 'E:\escuchadores-bot\data\force'
  return (Test-Path (Join-Path $forceRoot 'all')) -or (Test-Path (Join-Path $forceRoot 'reportador'))
}

function Test-ActiveHours {
  if (Test-TelegramForce) { return $true }
  $h = (Get-Date).Hour
  return ($h -ge $wakeHour -and $h -lt $sleepHour)
}

function Test-HealthOk([string]$baseUrl, [int]$timeoutSec = 8) {
  if (-not $baseUrl) { return $false }
  $url = "$($baseUrl.Trim().TrimEnd('/'))/api/health?t=$((Get-Date).Ticks)"
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec -ErrorAction Stop
    if ($r.StatusCode -lt 200 -or $r.StatusCode -ge 300) { return $false }
    $j = $r.Content | ConvertFrom-Json
    return [bool]$j.ok
  } catch {
    return $false
  }
}

function Test-UrlOk([string]$url, [int]$timeoutSec = 8) {
  return Test-HealthOk $url $timeoutSec
}

function Get-PublishedUrl {
  try {
    $j = Get-Content $serverJson -Raw -ErrorAction Stop | ConvertFrom-Json
    return ([string]$j.url).Trim().TrimEnd('/')
  } catch {
    return ''
  }
}

function Set-PublishedUrl([string]$url) {
  $url = $url.Trim().TrimEnd('/')
  '{"url":"' + $url + '"}' | Set-Content -Path $serverJson -Encoding UTF8 -NoNewline
  $serverTs = Join-Path $root 'src\lib\server.ts'
  if (Test-Path $serverTs) {
    try {
      $txt = Get-Content $serverTs -Raw
      $txt2 = [regex]::Replace(
        $txt,
        "const FALLBACKS = \[[\s\S]*?\]",
        "const FALLBACKS = [`r`n  '$url',`r`n]"
      )
      if ($txt2 -ne $txt) { Set-Content -Path $serverTs -Value $txt2 -Encoding UTF8 }
    } catch {}
  }
}

function Push-ServerJson([string]$url) {
  try {
    & git -C $root add -- server.json 2>$null | Out-Null
    $st = & git -C $root status --porcelain -- server.json 2>$null
    if (-not $st) {
      Write-Keep "git: server.json sin cambios ($url)"
      return
    }
    & git -C $root commit -m "Update public Tunnelmole URL (keep-alive)." 2>&1 | Out-Null
    & git -C $root push origin master 2>&1 | Out-Null
    Write-Keep "git: push OK -> $url"
  } catch {
    Write-Keep "git push FAIL: $($_.Exception.Message)"
  }
}

function Ensure-Server {
  if (Test-UrlOk $localHealth 5) { return $true }
  Write-Keep 'local health FAIL -> reinicio servidor'
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'reportador[/\\]server[/\\]index\.mjs' -and $_.CommandLine -match 'node' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Start-Process -FilePath 'node' -ArgumentList 'server/index.mjs' -WorkingDirectory $root -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2
  return (Test-UrlOk $localHealth 5)
}

function Ensure-Escuchador {
  $alive = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'reportador\\tools\\escuchar\.ps1' }
  if ($alive) { return }
  Write-Keep 'escuchador ausente -> arranque'
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', (Join-Path $root 'tools\escuchar.ps1')
  ) -WorkingDirectory $root -WindowStyle Hidden | Out-Null
}

function Stop-Tunnelmole {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'tunnelmole' -and $_.CommandLine -match '8789' } |
    ForEach-Object {
      Write-Keep "kill tunnelmole pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-Localtunnel {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'localtunnel' -and $_.CommandLine -match '8789' } |
    ForEach-Object {
      Write-Keep "kill localtunnel pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-PublicTunnel {
  Stop-Tunnelmole
  Stop-Localtunnel
}

function Start-LocaltunnelAndWaitUrl {
  $outLog = Join-Path $root 'tools\_localtunnel.out.log'
  $errLog = Join-Path $root 'tools\_localtunnel.err.log'
  foreach ($f in @($outLog, $errLog)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
  }
  Write-Keep 'arrancando localtunnel 8789...'
  $p = Start-Process -FilePath 'npx.cmd' -ArgumentList @('--yes', 'localtunnel', '--port', '8789') `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $raw = ''
    foreach ($f in @($outLog, $errLog)) {
      if (Test-Path $f) {
        try { $raw += (Get-Content $f -Raw -ErrorAction SilentlyContinue) } catch {}
      }
    }
    if ($raw -match 'https://([a-z0-9-]+\.loca\.lt)') {
      $url = 'https://' + $Matches[1]
      Write-Keep "localtunnel URL $url (pid=$($p.Id))"
      return $url
    }
  }
  Write-Keep 'localtunnel: no aparecio URL a tiempo'
  return $null
}

function Start-TunnelmoleAndWaitUrl {
  $outLog = Join-Path $root 'tools\_tunnelmole.out.log'
  $errLog = Join-Path $root 'tools\_tunnelmole.err.log'
  foreach ($f in @($tunnelLog, $outLog, $errLog)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
  }
  Write-Keep 'arrancando tunnelmole 8789...'
  $p = Start-Process -FilePath 'npx.cmd' -ArgumentList @('--yes', 'tunnelmole', '8789') `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru

  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $raw = ''
    foreach ($f in @($outLog, $errLog, $tunnelLog)) {
      if (Test-Path $f) {
        try { $raw += (Get-Content $f -Raw -ErrorAction SilentlyContinue) } catch {}
      }
    }
    if ($raw -match 'https://([a-z0-9-]+\.tunnelmole\.net)') {
      $url = 'https://' + $Matches[1]
      try { Set-Content -Path $tunnelLog -Value $raw -Encoding UTF8 } catch {}
      Write-Keep "tunnelmole URL $url (pid=$($p.Id))"
      return $url
    }
  }
  Write-Keep 'tunnelmole: no aparecio URL a tiempo'
  $err = ''
  if (Test-Path $errLog) {
    try { $err = Get-Content $errLog -Raw -ErrorAction SilentlyContinue } catch {}
  }
  if ($err -match 'limited to 10 tunnels') {
    Write-Keep 'tunnelmole rate limit -> probando localtunnel'
    return Start-LocaltunnelAndWaitUrl
  }
  return $null
}

function Wait-TunnelHealth([string]$newUrl) {
  for ($i = 0; $i -lt 12; $i++) {
    if (Test-HealthOk $newUrl 10) { return $true }
    Start-Sleep -Seconds 3
  }
  Write-Keep "tunel nuevo no responde health: $newUrl"
  return $false
}

function Ensure-PublicTunnel {
  $url = Get-PublishedUrl
  if ($url -and (Test-HealthOk $url 12)) {
    $script:PublicFailCount = 0
    return $true
  }

  $script:PublicFailCount++
  Write-Keep "publico FAIL ($url) intento $($script:PublicFailCount)/$failThreshold"
  if ($script:PublicFailCount -lt $failThreshold) { return $false }

  $since = ((Get-Date) - $script:LastTunnelRestart).TotalSeconds
  if ($since -lt $minRestartGapSec) {
    $wait = [math]::Ceiling($minRestartGapSec - $since)
    Write-Keep "cooldown tunel: faltan ${wait}s (no reinicio todavia)"
    return $false
  }

  Write-Keep 'reinicio tunel (tras varios fallos seguidos)'
  Stop-PublicTunnel
  Start-Sleep -Seconds 2
  $newUrl = Start-LocaltunnelAndWaitUrl
  if (-not $newUrl) { $newUrl = Start-TunnelmoleAndWaitUrl }
  if (-not $newUrl) { return $false }
  if (-not (Wait-TunnelHealth $newUrl)) { return $false }

  $script:LastTunnelRestart = Get-Date
  $script:PublicFailCount = 0
  $prev = Get-PublishedUrl
  Set-PublishedUrl $newUrl
  if ($prev -ne $newUrl) {
    Push-ServerJson $newUrl
  }
  return $true
}

function Stop-Escuchador {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'reportador\\tools\\escuchar\.ps1' } |
    ForEach-Object {
      Write-Keep "kill escuchador pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-Server {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'reportador[/\\]server[/\\]index\.mjs' -and $_.CommandLine -match 'node' } |
    ForEach-Object {
      Write-Keep "kill servidor pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Send-WatcherOff {
  try {
    $body = '{"status":"off","pendingCount":0}'
    Invoke-RestMethod -Uri 'http://127.0.0.1:8789/api/watcher/beat' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 4 | Out-Null
  } catch {}
}

function Enter-SleepMode {
  Write-Keep "horario reposo ($sleepHour`:00-$($wakeHour - 1):59) -> apagando"
  Stop-PublicTunnel
  Stop-Escuchador
  Send-WatcherOff
  Stop-Server
}

function Enter-ActiveMode {
  Write-Keep "horario activo ($wakeHour`:00-$($sleepHour - 1):59) -> arranque"
  $null = Ensure-Server
  Ensure-Escuchador
  $null = Ensure-PublicTunnel
}

Write-Keep "=== Reportador keep-alive iniciado (activo $wakeHour`:00-$($sleepHour - 1):59) ==="
while ($true) {
  try {
    $active = Test-ActiveHours
    if ($active -and $script:ModeActive -ne $true) {
      Enter-ActiveMode
      $script:ModeActive = $true
    } elseif (-not $active -and $script:ModeActive -ne $false) {
      Enter-SleepMode
      $script:ModeActive = $false
    } elseif ($active) {
      $null = Ensure-Server
      Ensure-Escuchador
      $null = Ensure-PublicTunnel
    }
  } catch {
    Write-Keep "loop error: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds ($(if (Test-ActiveHours) { $pollSecActive } else { $pollSecSleep }))
}
