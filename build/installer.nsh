!macro customInit
  ; Silently uninstall old "GW2 Account Manager" if present.
  ; electron-builder oneClick NSIS installs to $LOCALAPPDATA\Programs\<name>
  ; with an uninstaller named "Uninstall <productName>.exe".
  StrCpy $0 "$LOCALAPPDATA\Programs\gw2-account-manager\Uninstall GW2 Account Manager.exe"
  ${If} ${FileExists} $0
    ExecWait '"$0" /S _?=$LOCALAPPDATA\Programs\gw2-account-manager'
    RMDir /r "$LOCALAPPDATA\Programs\gw2-account-manager"
  ${EndIf}
!macroend
