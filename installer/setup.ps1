# BySS: шаги установщика, которые проще сделать в PowerShell.
#   firefox   — скачать Firefox ESR у Mozilla, проверить подпись Mozilla и распаковать в папку BySS;
#   configure — политики Firefox (без истории, uBlock Origin, BySS), профиль, значок окна, перенос настроек старого BySS;
#   oldapp    — убрать старый BySS (Electron), если он установлен; его настройки уже перенесены.
# Пишет журнал в %TEMP%\byss-setup.log. Код выхода 0 — успех.
param(
  [Parameter(Mandatory = $true)][string]$Step,
  [string]$InstallDir = '',
  [string]$ProfileDir = '',
  [string]$Version = '2.0.0',
  [int]$SetupRev = 1,
  [string]$Payload = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$LogFile = Join-Path $env:TEMP 'byss-setup.log'

# Если установщик запустили из PowerShell 7, Windows PowerShell наследует чужой путь модулей
# и не может загрузить свои (например, проверку подписи). Возвращаем обычный путь модулей.
try {
  $machineModules = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
  $env:PSModulePath = (@((Join-Path $PSHOME 'Modules'), $machineModules) | Where-Object { $_ }) -join ';'
} catch { }

function Log([string]$m) {
  try { Add-Content -LiteralPath $LogFile -Value ('[' + (Get-Date -Format 's') + '] ' + $m) -Encoding UTF8 } catch { }
}

function ShortPath([string]$p) {
  try { return (New-Object -ComObject Scripting.FileSystemObject).GetFolder($p).ShortPath } catch { return $p }
}

function WriteUtf8([string]$path, [string]$text) {
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

function ReadUtf8([string]$path) {
  return [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
}

# ---------------------------------------------------------------- Firefox

function Step-Firefox {
  $ff = Join-Path $InstallDir 'firefox'
  if (Test-Path -LiteralPath (Join-Path $ff 'firefox.exe')) {
    Log 'Firefox already installed, it updates itself'
    return
  }
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('byss-ff-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $tmp = ShortPath $tmp
  $exe = Join-Path $tmp 'firefox-esr.exe'
  $url = 'https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=win64&lang=ru'
  $ok = $false
  for ($i = 1; $i -le 3 -and -not $ok; $i++) {
    try {
      Log ('download try ' + $i)
      Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing -TimeoutSec 900
      $ok = $true
    } catch {
      Log ('download failed: ' + $_.Exception.Message)
      Start-Sleep -Seconds 3
    }
  }
  if (-not $ok) { throw 'NO_DOWNLOAD' }
  Log ('downloaded ' + (Get-Item -LiteralPath $exe).Length + ' bytes')

  # только настоящий Firefox: файл подписан Mozilla
  try { Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop } catch { }
  $sig = Get-AuthenticodeSignature -FilePath $exe
  $subject = ''
  if ($sig.SignerCertificate) { $subject = $sig.SignerCertificate.Subject }
  Log ('signature: ' + $sig.Status + ' / ' + $subject)
  if ($sig.Status -ne 'Valid' -or $subject -notmatch 'Mozilla Corporation') { throw 'BAD_SIGNATURE' }

  # распаковать без установки: Firefox живёт в папке BySS и обновляется сам
  $x = Join-Path $tmp 'x'
  $p = Start-Process -FilePath $exe -ArgumentList ('/ExtractDir=' + $x) -Wait -PassThru -WindowStyle Hidden
  $core = Join-Path $x 'core'
  if (-not (Test-Path -LiteralPath (Join-Path $core 'firefox.exe'))) {
    Log ('extract exit code ' + $p.ExitCode)
    throw 'NO_EXTRACT'
  }
  New-Item -ItemType Directory -Force -Path $ff | Out-Null
  Copy-Item -Path (Join-Path $core '*') -Destination $ff -Recurse -Force
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Log 'Firefox ready'
}

# ---------------------------------------------------------------- политики и профиль

function JsonString([string]$s) {
  $b = New-Object Text.StringBuilder
  [void]$b.Append('"')
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($ch -eq '"') { [void]$b.Append('\"') }
    elseif ($ch -eq '\') { [void]$b.Append('\\') }
    elseif ($c -lt 32) { [void]$b.Append(('\u{0:x4}' -f $c)) }
    else { [void]$b.Append($ch) }
  }
  [void]$b.Append('"')
  return $b.ToString()
}

function Step-Configure {
  $ff = Join-Path $InstallDir 'firefox'
  if (-not (Test-Path -LiteralPath (Join-Path $ff 'firefox.exe'))) { throw 'NO_FIREFOX' }

  # настройки старого BySS (Electron)
  $oldDir = Join-Path $env:APPDATA 'BySS'
  $oldFile = Join-Path $oldDir 'settings.json'
  $importRaw = 'null'
  $engine = 'Google'
  $startPage = 'previous-session'
  $wallpaper = ''
  if (Test-Path -LiteralPath $oldFile) {
    try {
      $raw = ReadUtf8 $oldFile
      $obj = $raw | ConvertFrom-Json
      $importRaw = $raw
      switch ([string]$obj.engine) {
        'yandex' { $engine = 'Яндекс' }
        'ddg' { $engine = 'DuckDuckGo' }
        'bing' { $engine = 'Bing' }
        default { $engine = 'Google' }
      }
      if ($obj.restoreTabs -eq $false) { $startPage = 'homepage' }
      if ([string]$obj.wallpaper -eq 'custom') {
        foreach ($ext in @('jpg', 'png', 'webp')) {
          $wf = Join-Path $oldDir ('wallpaper.' + $ext)
          if ((Test-Path -LiteralPath $wf) -and ((Get-Item -LiteralPath $wf).Length -lt 6MB)) {
            $mime = @{ jpg = 'image/jpeg'; png = 'image/png'; webp = 'image/webp' }[$ext]
            $wallpaper = 'data:' + $mime + ';base64,' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($wf))
            break
          }
        }
      }
      Log 'old BySS settings found'
    } catch {
      Log ('old settings unreadable: ' + $_.Exception.Message)
      $importRaw = 'null'
    }
  }

  $xpi = Join-Path $InstallDir 'byss.xpi'
  $xpiUrl = ([Uri]$xpi).AbsoluteUri
  $third = '{"version":' + (JsonString $Version) + ',"setup":' + $SetupRev + ',"import":' + $importRaw + ',"wallpaper":"__WALLPAPER__"}'

  $tpl = ReadUtf8 (Join-Path $Payload 'policies.template.json')
  $json = $tpl.Replace('"__THIRDPARTY__"', $third).Replace('__XPI_URL__', $xpiUrl).Replace('__STARTPAGE__', $startPage).Replace('__ENGINE__', $engine)
  # проверка: файл политик должен быть правильным JSON (картинку вставляем после — она бывает большой)
  try {
    $null = $json.Replace('"__WALLPAPER__"', '""') | ConvertFrom-Json
  } catch {
    Log ('policies invalid with import, retry without it: ' + $_.Exception.Message)
    $third = '{"version":' + (JsonString $Version) + ',"setup":' + $SetupRev + ',"import":null,"wallpaper":"__WALLPAPER__"}'
    $json = $tpl.Replace('"__THIRDPARTY__"', $third).Replace('__XPI_URL__', $xpiUrl).Replace('__STARTPAGE__', $startPage).Replace('__ENGINE__', $engine)
    $null = $json.Replace('"__WALLPAPER__"', '""') | ConvertFrom-Json
  }
  $json = $json.Replace('"__WALLPAPER__"', (JsonString $wallpaper))

  $dist = Join-Path $ff 'distribution'
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  WriteUtf8 (Join-Path $dist 'policies.json') $json
  Log 'policies written'

  # значок окна BySS вместо значка Firefox
  $icoDir = Join-Path $ff 'browser\chrome\icons\default'
  New-Item -ItemType Directory -Force -Path $icoDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $InstallDir 'byss.ico') -Destination (Join-Path $icoDir 'main-window.ico') -Force

  # профиль BySS
  $chrome = Join-Path $ProfileDir 'chrome'
  New-Item -ItemType Directory -Force -Path $chrome | Out-Null
  Copy-Item -LiteralPath (Join-Path $Payload 'user.js') -Destination (Join-Path $ProfileDir 'user.js') -Force
  Copy-Item -LiteralPath (Join-Path $Payload 'userChrome.css') -Destination (Join-Path $chrome 'userChrome.css') -Force
  Copy-Item -LiteralPath (Join-Path $Payload 'userContent.css') -Destination (Join-Path $chrome 'userContent.css') -Force
  WriteUtf8 (Join-Path $InstallDir 'byss-install.json') ('{"version":' + (JsonString $Version) + ',"setup":' + $SetupRev + '}')
  Log 'profile ready'
}

# ---------------------------------------------------------------- старый BySS (Electron)

function Step-OldApp {
  $keys = @()
  foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (-not (Test-Path $root)) { continue }
    foreach ($k in Get-ChildItem $root -ErrorAction SilentlyContinue) {
      $p = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
      if ($p -and ([string]$p.DisplayName) -like 'BySS*' -and ([string]$p.UninstallString) -match 'Uninstall BySS\.exe' -and $k.PSChildName -ne 'BySS-Firefox') {
        $keys += $p
      }
    }
  }
  if ($keys.Count -eq 0) {
    Log 'no old BySS'
    return
  }
  foreach ($p in $keys) {
    $us = [string]$p.UninstallString
    $exe = $us
    if ($us -match '^"([^"]+)"') { $exe = $Matches[1] } else { $exe = ($us -split ' /')[0] }
    $dir = Split-Path -Parent $exe
    if ($InstallDir -and $dir.TrimEnd('\') -ieq $InstallDir.TrimEnd('\')) { continue }
    Log ('old BySS at ' + $dir)

    # дождаться, пока старый BySS закроется (он сам запустил это обновление)
    for ($i = 0; $i -lt 40; $i++) {
      $run = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) })
      if ($run.Count -eq 0) { break }
      if ($i -eq 30) { $run | Stop-Process -Force -ErrorAction SilentlyContinue }
      Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Path -LiteralPath $exe)) { continue }
    try {
      Start-Process -FilePath $exe -ArgumentList '/S' -Wait -WindowStyle Hidden | Out-Null
    } catch {
      Log ('old uninstall failed: ' + $_.Exception.Message)
      continue
    }
    # удаление идёт ещё немного после выхода — ждём, пока исчезнет программа
    for ($i = 0; $i -lt 120; $i++) {
      if (-not (Test-Path -LiteralPath (Join-Path $dir 'BySS.exe'))) { break }
      Start-Sleep -Milliseconds 500
    }
    Start-Sleep -Seconds 2
    Log 'old BySS removed'
  }
}

# ---------------------------------------------------------------- запуск шага

try {
  Log ('step ' + $Step + ' dir=' + $InstallDir + ' version=' + $Version)
  switch ($Step) {
    'firefox' { Step-Firefox }
    'configure' { Step-Configure }
    'oldapp' { Step-OldApp }
    default { throw ('unknown step ' + $Step) }
  }
  exit 0
} catch {
  Log ('ERROR: ' + $_.Exception.Message)
  exit 1
}
