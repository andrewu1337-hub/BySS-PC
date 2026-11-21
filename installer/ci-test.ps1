# Проверка установщика на чистой Windows в GitHub Actions: ставим BySS «с нуля» поверх настроек
# «старого BySS», запускаем, снимаем экран. Снимки и журнал кладутся в папку shots.
$ErrorActionPreference = 'Stop'
$out = Join-Path $PWD 'shots'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$res = Join-Path $out 'result.txt'
function Note([string]$m) { Add-Content -LiteralPath $res -Value $m -Encoding UTF8; Write-Host $m }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Shot([string]$name) {
  try {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $bmp.Save((Join-Path $out ($name + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
  } catch {
    Note ('screenshot failed: ' + $_.Exception.Message)
  }
}

# «старый BySS»: его настройки должны переехать
$old = Join-Path $env:APPDATA 'BySS'
New-Item -ItemType Directory -Force -Path $old | Out-Null
$oldJson = '{"name":"BySS","theme":"dark","wallpaper":"waves","engine":"yandex","restoreTabs":true,' +
  '"engines":["google","yandex","currency"],"currency":{"base":"EUR","list":["MDL","USD","RON"],"amount":100},' +
  '"cities":[{"name":"Rotterdam","lat":51.9225,"lon":4.47917}],' +
  '"shortcuts":[{"title":"YouTube","url":"https://www.youtube.com/"},{"title":"Wikipedia","url":"https://www.wikipedia.org/"},{"title":"GitHub","url":"https://github.com/"}],' +
  '"downloads":[],"window":{"width":1200,"height":800}}'
[IO.File]::WriteAllText((Join-Path $old 'settings.json'), $oldJson, (New-Object Text.UTF8Encoding($true)))

$setup = (Resolve-Path 'out\BySS-Setup.exe').Path
$t0 = Get-Date
$p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
Note ('installer exit code: ' + $p.ExitCode + ', took ' + [int]((Get-Date) - $t0).TotalSeconds + ' s')
$log = Join-Path $env:TEMP 'byss-setup.log'
if (Test-Path $log) { Note (Get-Content -LiteralPath $log -Raw -Encoding UTF8) }

$dir = Join-Path $env:LOCALAPPDATA 'BySS'
$ff = Join-Path $dir 'firefox\firefox.exe'
$prof = Join-Path $env:APPDATA 'BySS\firefox-profile'
$checks = [ordered]@{
  'firefox.exe' = (Test-Path $ff)
  'policies.json' = (Test-Path (Join-Path $dir 'firefox\distribution\policies.json'))
  'byss.xpi' = (Test-Path (Join-Path $dir 'byss.xpi'))
  'main-window.ico' = (Test-Path (Join-Path $dir 'firefox\browser\chrome\icons\default\main-window.ico'))
  'user.js' = (Test-Path (Join-Path $prof 'user.js'))
  'userChrome.css' = (Test-Path (Join-Path $prof 'chrome\userChrome.css'))
  'desktop shortcut' = (Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'BySS.lnk'))
  'uninstaller' = (Test-Path (Join-Path $dir 'Uninstall BySS.exe'))
}
$bad = 0
foreach ($k in $checks.Keys) {
  Note ($k + ': ' + $checks[$k])
  if (-not $checks[$k]) { $bad++ }
}
try {
  $pol = Get-Content -LiteralPath (Join-Path $dir 'firefox\distribution\policies.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $imp = $pol.policies.'3rdparty'.Extensions.'byss@byss.app'
  Note ('policies ok; default engine: ' + $pol.policies.SearchEngines.Default + '; start: ' + $pol.policies.Homepage.StartPage)
  Note ('import: ' + (($imp.import | ConvertTo-Json -Compress -Depth 5)))
} catch {
  Note ('policies.json broken: ' + $_.Exception.Message)
  $bad++
}
if ($bad -gt 0) { Note ('FAILED checks: ' + $bad) }

if (Test-Path $ff) {
  $base = @('-profile', ('"' + $prof + '"'))
  Start-Process -FilePath $ff -ArgumentList $base
  Start-Sleep -Seconds 40
  Shot '1-start'
  foreach ($pg in @(
      @('2-newtab', 'about:newtab', 6),
      @('3-policies', 'about:policies', 6),
      @('4-addons', 'about:addons', 6),
      @('5-settings', 'moz-extension://a90f5681-e157-4e8e-8725-17a034929c49/settings/index.html', 6),
      @('6-youtube', 'https://www.youtube.com/', 14),
      @('7-history', 'about:preferences#privacy', 6))) {
    Start-Process -FilePath $ff -ArgumentList ($base + @('-new-tab', $pg[1]))
    Start-Sleep -Seconds $pg[2]
    Shot $pg[0]
  }
  Get-Process firefox -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
if ($bad -gt 0) { exit 1 }
exit 0
