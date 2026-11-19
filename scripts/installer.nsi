Unicode true

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!include "StrFunc.nsh"

${StrStr}
${UnStrRep}

!ifndef APP_SOURCE
  !error "APP_SOURCE não definido"
!endif
!ifndef OUTFILE
  !error "OUTFILE não definido"
!endif
!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif
!ifndef APP_ARCH
  !define APP_ARCH "x64"
!endif

!define APP_NAME "Hefesto"
!define APP_PUBLISHER "SaladaDeFlutter"
!define APP_URL "https://github.com/SaladaDeFlutter/Hefesto"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Hefesto"

Name "${APP_NAME} ${APP_VERSION} (${APP_ARCH})"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Hefesto"
InstallDirRegKey HKCU "Software\Hefesto" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalar o Hefesto"
!define MUI_WELCOMEPAGE_TEXT "O Hefesto já vem com Node.js e opencode incluídos.$\r$\n$\r$\nA instalação é feita só para o seu usuário, sem administrador.$\r$\n$\r$\nClique em Avançar para continuar."
!define MUI_FINISHPAGE_RUN "$INSTDIR\hefesto.cmd"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o Hefesto agora"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\LEIA-ME.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Abrir o LEIA-ME"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

!macro CheckArch
  !if "${APP_ARCH}" == "arm64"
    ${IfNot} ${IsNativeARM64}
      MessageBox MB_OK|MB_ICONSTOP "Este instalador é para Windows arm64. Baixe a versão x64." /SD IDOK
      Abort
    ${EndIf}
  !else
    ${If} ${IsNativeARM64}
      MessageBox MB_OK|MB_ICONSTOP "Este instalador é para Windows x64. Baixe a versão arm64." /SD IDOK
      Abort
    ${EndIf}
  !endif
!macroend

Function .onInit
  SetShellVarContext current
  !insertmacro CheckArch
FunctionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

Function AddToPath
  ReadRegStr $0 HKCU "Environment" "Path"
  ${If} $0 == ""
    StrCpy $0 "$INSTDIR"
    WriteRegExpandStr HKCU "Environment" "Path" "$0"
  ${Else}
    ${StrStr} $1 ";$0;" ";$INSTDIR;"
    ${If} $1 == ""
      StrCpy $2 "$0" 1 -1
      ${If} $2 == ";"
        StrCpy $0 "$0$INSTDIR"
      ${Else}
        StrCpy $0 "$0;$INSTDIR"
      ${EndIf}
      WriteRegExpandStr HKCU "Environment" "Path" "$0"
    ${EndIf}
  ${EndIf}
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
FunctionEnd

Section "Hefesto" SecMain
  SetOutPath "$INSTDIR"
  File /r "${APP_SOURCE}/*"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Hefesto"
  CreateShortcut "$SMPROGRAMS\Hefesto\Hefesto.lnk" "$INSTDIR\hefesto.cmd" "" "$INSTDIR\hefesto.cmd" 0
  CreateShortcut "$SMPROGRAMS\Hefesto\Desinstalar Hefesto.lnk" "$INSTDIR\uninstall.exe"
  CreateShortcut "$DESKTOP\Hefesto.lnk" "$INSTDIR\hefesto.cmd" "" "$INSTDIR\hefesto.cmd" 0

  WriteRegStr HKCU "Software\Hefesto" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Hefesto" "Version" "${APP_VERSION}"

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "${APP_URL}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\hefesto.cmd,0"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0

  Call AddToPath
SectionEnd

Function un.RemoveFromPath
  ReadRegStr $0 HKCU "Environment" "Path"
  ${UnStrRep} $0 "$0" ";$INSTDIR" ""
  ${UnStrRep} $0 "$0" "$INSTDIR;" ""
  ${UnStrRep} $0 "$0" "$INSTDIR" ""
  WriteRegExpandStr HKCU "Environment" "Path" "$0"
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
FunctionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Hefesto\Hefesto.lnk"
  Delete "$SMPROGRAMS\Hefesto\Desinstalar Hefesto.lnk"
  RMDir "$SMPROGRAMS\Hefesto"
  Delete "$DESKTOP\Hefesto.lnk"

  Call un.RemoveFromPath

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\Hefesto"

  MessageBox MB_YESNO|MB_ICONQUESTION "Remover também as conversas e configurações salvas em %LOCALAPPDATA%\Hefesto?" /SD IDNO IDNO keepData
  RMDir /r "$LOCALAPPDATA\Hefesto"
  keepData:

  RMDir /r "$INSTDIR"
SectionEnd
