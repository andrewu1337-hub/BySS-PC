; BySS.exe — запуск BySS: Firefox из папки BySS со своим профилем.
; Ярлыки, «Браузер по умолчанию» и ссылки из других программ открывают BySS через него.
; Перед каждым запуском возвращает «паспорт» BySS для панели задач Windows и значок окна —
; обновление Firefox может их сбросить, и тогда на панели задач снова был бы значок Firefox.
; Собирается в build.sh: makensis -DVERSION=2.0.N launcher.nsi
Unicode true
ManifestDPIAware true
SilentInstall silent
RequestExecutionLevel user
SetCompressor /SOLID lzma

!include "FileFunc.nsh"
!include "WordFunc.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "2.0.0"
!endif

Name "BySS"
OutFile "BySS.exe"
Icon "byss.ico"
LoadLanguageFile "${NSISDIR}\Contrib\Language files\Russian.nlf"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "ProductName" "BySS"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "FileDescription" "BySS"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "CompanyName" "BySS"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_RUSSIAN} "LegalCopyright" "BySS. Firefox — товарный знак Mozilla Foundation"

Section
  ; профиль BySS — тот, что выбрал установщик
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BySS-Firefox" "ProfileDir"
  ${If} $0 == ""
    StrCpy $0 "$APPDATA\BySS\firefox-profile"
  ${EndIf}

  ; значок и имя BySS на панели задач
  WriteRegStr HKCU "Software\Mozilla\Firefox\TaskBarIDs" "$EXEDIR\firefox" "BySS.Browser"
  ${IfNot} ${FileExists} "$EXEDIR\firefox\browser\chrome\icons\default\main-window.ico"
    CreateDirectory "$EXEDIR\firefox\browser\chrome\icons\default"
    CopyFiles /SILENT "$EXEDIR\byss.ico" "$EXEDIR\firefox\browser\chrome\icons\default\main-window.ico"
  ${EndIf}
  ; значок окна и сердечко на «+» (byss.cfg) — после обновления Firefox вернуть, если пропали
  ${IfNot} ${FileExists} "$EXEDIR\firefox\byss.cfg"
    CopyFiles /SILENT "$EXEDIR\byss.cfg" "$EXEDIR\firefox\byss.cfg"
  ${EndIf}
  ${IfNot} ${FileExists} "$EXEDIR\firefox\defaults\pref\autoconfig.js"
    CreateDirectory "$EXEDIR\firefox\defaults\pref"
    CopyFiles /SILENT "$EXEDIR\autoconfig.js" "$EXEDIR\firefox\defaults\pref\autoconfig.js"
  ${EndIf}

  ${GetParameters} $1
  StrCpy $2 $1 12
  ${If} $2 == "-osint -url "
    ; ссылка из другой программы: одна ссылка, без кавычек внутри — чтобы её нельзя было выдать за другие параметры
    StrCpy $3 $1 "" 12
    StrCpy $4 $3 1
    ${If} $4 == '"'
      StrCpy $3 $3 "" 1
      StrCpy $4 $3 1 -1
      ${If} $4 == '"'
        StrCpy $3 $3 -1
      ${EndIf}
    ${EndIf}
    ${WordReplace} $3 '"' "%22" "+" $3
    Exec '"$EXEDIR\firefox\firefox.exe" -profile "$0" -url "$3"'
  ${Else}
    Exec '"$EXEDIR\firefox\firefox.exe" -profile "$0" $1'
  ${EndIf}
SectionEnd
