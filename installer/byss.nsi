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
Caption "Установка BySS ${VERSION}"
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
FunctionEnd

Function SkipIfUpdating
  ${If} $Updating == 1
    Abort
  ${EndIf}
FunctionEnd

Function LaunchBySS
  Exec '"$INSTDIR\firefox\firefox.exe" -profile "$ProfileDir"'
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

  InitPluginsDir
  SetOutPath "$PLUGINSDIR\payload"
  File "setup.ps1"
  File "policies.template.json"
  File "user.js"
  File "userChrome.css"
  File "userContent.css"
  SetOutPath "$INSTDIR"

  DetailPrint "Скачиваю Firefox ESR у Mozilla (около 70 МБ) — пара минут…"
  nsExec::Exec '${PS} -Step firefox -InstallDir "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    StrCpy $0 "Не получилось скачать или распаковать Firefox ESR. Проверьте интернет и запустите установку ещё раз."
    Call Fail
  ${EndIf}

  DetailPrint "Настраиваю BySS и переношу главную…"
  nsExec::Exec '${PS} -Step configure -InstallDir "$INSTDIR" -ProfileDir "$ProfileDir" -Version "${VERSION}" -SetupRev ${SETUP_REV} -Payload "$PLUGINSDIR\payload"'
  Pop $0
  ${If} $0 != 0
    StrCpy $0 "Не получилось настроить BySS."
    Call Fail
  ${EndIf}

  DetailPrint "Убираю старую версию BySS (если она есть)…"
  nsExec::Exec '${PS} -Step oldapp -InstallDir "$INSTDIR"'
  Pop $0

  DetailPrint "Создаю ярлыки…"
  CreateShortCut "$DESKTOP\BySS.lnk" "$INSTDIR\firefox\firefox.exe" '-profile "$ProfileDir"' "$INSTDIR\byss.ico" 0 SW_SHOWNORMAL "" "BySS"
  CreateShortCut "$SMPROGRAMS\BySS.lnk" "$INSTDIR\firefox\firefox.exe" '-profile "$ProfileDir"' "$INSTDIR\byss.ico" 0 SW_SHOWNORMAL "" "BySS"
  ; свой значок и имя BySS на панели задач (а не Firefox)
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
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "Get-Process firefox -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Pop $0
  Sleep 1000
  Delete "$DESKTOP\BySS.lnk"
  Delete "$SMPROGRAMS\BySS.lnk"
  RMDir /r "$INSTDIR\firefox"
  Delete "$INSTDIR\byss.xpi"
  Delete "$INSTDIR\byss.ico"
  Delete "$INSTDIR\byss-install.json"
  Delete "$INSTDIR\Uninstall BySS.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegValue HKCU "Software\Mozilla\Firefox\TaskBarIDs" "$INSTDIR\firefox"
  IfSilent done
  MessageBox MB_YESNO|MB_ICONQUESTION "Удалить и данные BySS — входы на сайтах, пароли и настройки?" IDNO done
  RMDir /r "$ProfileDir"
  done:
SectionEnd
