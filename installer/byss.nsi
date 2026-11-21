; BySS 2 для Windows: Firefox ESR от Mozilla + настройки и расширение BySS.
; Собирается makensis в GitHub Actions: makensis -DVERSION=2.0.N -DSETUP_REV=1 byss.nsi
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "2.0.0"
!endif
!ifndef SETUP_REV
  !define SETUP_REV "1"
!endif
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\BySS-Firefox"
!define PS '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\payload\setup.ps1"'

Name "BySS"
Caption "BySS ${VERSION}"
OutFile "BySS-Setup.exe"
InstallDir "$LOCALAPPDATA\BySS"
RequestExecutionLevel user
BrandingText "BySS ${VERSION}"
ShowInstDetails show

!define MUI_ICON "byss.ico"
!define MUI_UNICON "byss.ico"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Прервать установку BySS?"

Var Updating
Var ProfileDir

!define MUI_WELCOMEPAGE_TITLE "BySS ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "BySS теперь работает на Firefox ESR от Mozilla: вход в Google и на любые сайты, полный uBlock Origin против рекламы, история не сохраняется.$\r$\n$\r$\nУстановщик скачает Firefox ESR (около 70 МБ), настроит его под BySS и перенесёт главную: плитки, города погоды, валюты и фон.$\r$\n$\r$\nЕсли стоит старый BySS, он будет заменён новым."
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfUpdating
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfUpdating
!insertmacro MUI_PAGE_DIRECTORY
!define MUI_PAGE_CUSTOMFUNCTION_SHOW InstShow
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "BySS установлен"
!define MUI_FINISHPAGE_TEXT "Ярлык BySS — на рабочем столе и в меню «Пуск».$\r$\n$\r$\nПри первом запуске BySS сам поставит uBlock Origin — это займёт несколько секунд."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Запустить BySS"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchBySS
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfUpdating
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Russian"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "ProductName" "BySS"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "FileDescription" "Установка BySS"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "CompanyName" "BySS"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "LegalCopyright" "BySS. Firefox — товарный знак Mozilla Foundation"


Function .onInit
  StrCpy $Updating 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--updated" $1
  ${IfNot} ${Errors}
    ; обновление из старого BySS: показываем ход установки, а не молчим
    StrCpy $Updating 1
    SetSilent normal
  ${EndIf}
  StrCpy $ProfileDir "$APPDATA\BySS\firefox-profile"
  ; BySS уже стоит — это обновление: без страниц мастера, одно окошко с ходом, потом BySS откроется сам
  ReadRegStr $2 HKCU "${UNKEY}" "InstallLocation"
  ${If} $2 != ""
  ${AndIf} ${FileExists} "$2\firefox\firefox.exe"
    StrCpy $INSTDIR $2
    StrCpy $Updating 1
    ReadRegStr $3 HKCU "${UNKEY}" "ProfileDir"
    ${If} $3 != ""
      StrCpy $ProfileDir $3
    ${EndIf}
  ${EndIf}
FunctionEnd

Function InstShow
  ${If} $Updating == 1
    !insertmacro MUI_HEADER_TEXT "Обновление BySS ${VERSION}" "Закладки, вкладки и настройки остаются. BySS откроется сам."
  ${EndIf}
FunctionEnd

Function SkipIfUpdating
  ${If} $Updating == 1
    Abort
  ${EndIf}
FunctionEnd

Function LaunchBySS
  Exec '"$INSTDIR\BySS.exe"'
FunctionEnd

Function Fail
  ; $0 — что не получилось
  MessageBox MB_ICONSTOP|MB_OK "$0$\r$\n$\r$\nПодробности — в файле $TEMP\byss-setup.log" /SD IDOK
  Abort
FunctionEnd

Section "BySS" SecMain
  SetOutPath "$INSTDIR"
  File "byss.ico"
  File "byss.xpi"
  File "BySS.exe"
  File "byss.cfg"
  File "autoconfig.js"

  InitPluginsDir
  SetOutPath "$PLUGINSDIR\payload"
  File "setup.ps1"
  File "policies.template.json"
  File "user.js"
  File "userChrome.css"
  File "userContent.css"
  SetOutPath "$INSTDIR"

  ${If} $Updating == 1
    DetailPrint "Закрываю BySS — он откроется снова через несколько секунд…"
    nsExec::Exec '${PS} -Step close -InstallDir "$INSTDIR"'
    Pop $0
    DetailPrint "Обновляю BySS…"
  ${Else}
    DetailPrint "Скачиваю Firefox ESR у Mozilla (около 70 МБ) — пара минут…"
  ${EndIf}
  nsExec::Exec '${PS} -Step firefox -InstallDir "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    StrCpy $0 "Не получилось скачать или распаковать Firefox ESR. Проверьте интернет и запустите установку ещё раз."
    Call Fail
  ${EndIf}

  ${If} $Updating != 1
    DetailPrint "Настраиваю BySS и переношу главную…"
  ${EndIf}
  nsExec::Exec '${PS} -Step configure -InstallDir "$INSTDIR" -ProfileDir "$ProfileDir" -Version "${VERSION}" -SetupRev ${SETUP_REV} -Payload "$PLUGINSDIR\payload"'
  Pop $0
  ${If} $0 != 0
    StrCpy $0 "Не получилось настроить BySS."
    Call Fail
  ${EndIf}

  ${If} $Updating != 1
    DetailPrint "Убираю старую версию BySS (если она есть)…"
    nsExec::Exec '${PS} -Step oldapp -InstallDir "$INSTDIR"'
    Pop $0
    DetailPrint "Создаю ярлыки…"
  ${EndIf}
  ; ярлыки запускают BySS.exe: он открывает Firefox с профилем BySS
  CreateShortCut "$DESKTOP\BySS.lnk" "$INSTDIR\BySS.exe" "" "$INSTDIR\byss.ico" 0 SW_SHOWNORMAL "" "BySS"
  CreateShortCut "$SMPROGRAMS\BySS.lnk" "$INSTDIR\BySS.exe" "" "$INSTDIR\byss.ico" 0 SW_SHOWNORMAL "" "BySS"
  ; свой значок и имя BySS на панели задач и в списке браузеров Windows (а не Firefox)
  ${If} $Updating != 1
    DetailPrint "Добавляю BySS в список браузеров Windows…"
  ${EndIf}
  nsExec::Exec '${PS} -Step shortcuts -InstallDir "$INSTDIR" -Links "$DESKTOP\BySS.lnk|$SMPROGRAMS\BySS.lnk"'
  Pop $0

  WriteUninstaller "$INSTDIR\Uninstall BySS.exe"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "BySS"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "BySS"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\byss.ico"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall BySS.exe"'
  WriteRegStr HKCU "${UNKEY}" "ProfileDir" "$ProfileDir"
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $1 $2 $3
  IntFmt $1 "0x%08X" $1
  WriteRegDWORD HKCU "${UNKEY}" "EstimatedSize" $1

  ${If} $Updating == 1
    DetailPrint "Готово — открываю новый BySS"
    Call LaunchBySS
    SetAutoClose true
  ${EndIf}
SectionEnd

Function un.onInit
  ReadRegStr $ProfileDir HKCU "${UNKEY}" "ProfileDir"
  ${If} $ProfileDir == ""
    StrCpy $ProfileDir "$APPDATA\BySS\firefox-profile"
  ${EndIf}
FunctionEnd

Section "Uninstall"
  ; закрыть BySS (только его Firefox, не чужой)
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'firefox.exe' -and $$_.ExecutablePath -like '$INSTDIR\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
  Pop $0
  Sleep 1000
  Delete "$DESKTOP\BySS.lnk"
  Delete "$SMPROGRAMS\BySS.lnk"
  RMDir /r "$INSTDIR\firefox"
  Delete "$INSTDIR\byss.xpi"
  Delete "$INSTDIR\byss.ico"
  Delete "$INSTDIR\BySS.exe"
  Delete "$INSTDIR\byss.cfg"
  Delete "$INSTDIR\autoconfig.js"
  Delete "$INSTDIR\byss-install.json"
  Delete "$INSTDIR\Uninstall BySS.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegValue HKCU "Software\Mozilla\Firefox\TaskBarIDs" "$INSTDIR\firefox"
  ; BySS в списке браузеров Windows
  DeleteRegValue HKCU "Software\RegisteredApplications" "BySS"
  DeleteRegKey HKCU "Software\Clients\StartMenuInternet\BySS"
  DeleteRegKey HKCU "Software\Classes\BySSURL"
  DeleteRegKey HKCU "Software\Classes\BySSHTML"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  IfSilent done
  MessageBox MB_YESNO|MB_ICONQUESTION "Удалить и данные BySS — входы на сайтах, пароли и настройки?" IDNO done
  RMDir /r "$ProfileDir"
  done:
SectionEnd
