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
  'BySS.exe' = (Test-Path (Join-Path $dir 'BySS.exe'))
  'browser registered' = ($null -ne (Get-ItemProperty -LiteralPath 'HKCU:\Software\RegisteredApplications' -Name 'BySS' -ErrorAction SilentlyContinue))
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
try {
  $tb = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Mozilla\Firefox\TaskBarIDs' -ErrorAction Stop).PSObject.Properties |
    Where-Object { $_.Name -like '*firefox' } | ForEach-Object { $_.Name + ' = ' + $_.Value }
  Note ('taskbar id: ' + ($tb -join '; '))
} catch {
  Note 'taskbar id: none'
}
try {
  Note ('url handler: ' + (Get-ItemProperty -LiteralPath 'HKCU:\Software\Classes\BySSURL\shell\open\command' -ErrorAction Stop).'(default)')
  Note ('browser name: ' + (Get-ItemProperty -LiteralPath 'HKCU:\Software\Clients\StartMenuInternet\BySS\Capabilities' -ErrorAction Stop).ApplicationName)
} catch {
  Note 'url handler: none'
}
if ($bad -gt 0) { Note ('FAILED checks: ' + $bad) }

# навести мышь на кнопку BySS на панели задач — снимок подсказки (значок и имя окна)
function Hover-Taskbar {
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    Add-Type 'using System.Runtime.InteropServices; public static class ByssCur { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }'
    $A = [System.Windows.Automation.AutomationElement]
    $tray = $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,
      (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, 'Shell_TrayWnd')))
    if (-not $tray) { Note 'taskbar: not found'; return }
    $all = $tray.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $names = @()
    $hit = $null
    foreach ($e in $all) {
      $n = [string]$e.Current.Name
      if (-not $n) { continue }
      $names += $n
      if (-not $hit -and $n -match 'BySS|Firefox|Mozilla' -and $e.Current.BoundingRectangle.Width -gt 0) { $hit = $e }
    }
    Note ('taskbar items: ' + ($names -join ' | '))
    if (-not $hit) { return }
    $r = $hit.Current.BoundingRectangle
    [ByssCur]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
    Start-Sleep -Seconds 3
    Shot '1b-hover'
    [ByssCur]::SetCursorPos(400, 300) | Out-Null
    Start-Sleep -Seconds 1
  } catch {
    Note ('hover failed: ' + $_.Exception.Message)
  }
}

if (Test-Path $ff) {
  $base = @('-profile', ('"' + $prof + '"'))
  # первый запуск — как с ярлыка, через BySS.exe
  $launcher = Join-Path $dir 'BySS.exe'
  if (Test-Path $launcher) { Start-Process -FilePath $launcher } else { Start-Process -FilePath $ff -ArgumentList $base }
  Start-Sleep -Seconds 40
  Shot '1-start'
  Hover-Taskbar
  if (Test-Path $launcher) {
    # ссылка из другой программы (так её откроет Windows, когда BySS — браузер по умолчанию)
    Start-Process -FilePath $launcher -ArgumentList @('-osint', '-url', '"https://example.com/"')
    Start-Sleep -Seconds 8
    Shot '1c-link'
  }
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
