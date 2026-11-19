; Установщик BySS: можно выбрать папку и решить, добавлять ли «мои сайты» на главную.
; electron-builder подключает этот файл (nsis.include). Всё описано внутри макросов:
; они вставляются туда, где страницы и секции уже подготовлены (MUI2, LogicLib).
; Файл в UTF-8 с BOM — чтобы русские буквы в установщике были правильными.

!macro customPageAfterChangeDir
  !include nsDialogs.nsh
  Var BySSSitesBox
  Page custom BySSSitesPage BySSSitesLeave

  Function BySSSitesPage
    !insertmacro MUI_HEADER_TEXT "Главная страница" "Какие сайты показать на плитках главной BySS"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 30u "Google, Яндекс, DuckDuckGo, Переводчик и YouTube будут на главной всегда. Плитки потом можно менять прямо в браузере."
    Pop $0
    ${NSD_CreateCheckbox} 0 40u 100% 14u "Добавить мои сайты: Sauto, mobile.de, AutoScout24"
    Pop $BySSSitesBox
    ${NSD_Check} $BySSSitesBox
    nsDialogs::Show
  FunctionEnd

  Function BySSSitesLeave
    Push $0
    Push $1
    ${NSD_GetState} $BySSSitesBox $0
    FileOpen $1 "$PLUGINSDIR\install-options.json" w
    ${If} $0 == ${BST_CHECKED}
      FileWrite $1 '{"mySites":true}'
    ${Else}
      FileWrite $1 '{"mySites":false}'
    ${EndIf}
    FileClose $1
    Pop $1
    Pop $0
  FunctionEnd
!macroend

!macro customInstall
  ; при тихом обновлении из браузера страницы не было — файла нет, главную не трогаем
  ${If} ${FileExists} "$PLUGINSDIR\install-options.json"
    CopyFiles /SILENT /FILESONLY "$PLUGINSDIR\install-options.json" "$INSTDIR\resources"
  ${EndIf}
!macroend

; Старая версия не удалилась (сломанный деинсталлятор, антивирус, занятый файл) —
; не останавливаемся с ошибкой «Не удалось удалить старые файлы», а ставим новую версию поверх.
; Настройки и данные браузера при этом не трогаются.
!macro customUnInstallCheck
  ${If} $R0 != 0
    DetailPrint "Старая версия не удалилась (код $R0) — устанавливаем поверх"
  ${EndIf}
  ClearErrors
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend
