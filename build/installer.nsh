!macro customUnInstall
  ${ifNot} ${isUpdated}
    SetRegView 64
    ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\CapriVpn" "ImagePath"
    ${If} $0 != ""
      ; Only the native helper is elevated. Electron is never run as administrator.
      ClearErrors
      ExecShellWait "runas" "$INSTDIR\resources\native\Capri.Windows.exe" "--uninstall" SW_HIDE
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Удаление службы Capri VPN не подтверждено. Службу можно удалить во вкладке VPN."
        Abort
      ${EndIf}
      Sleep 1000
      ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\CapriVpn" "ImagePath"
      ${If} $0 != ""
        MessageBox MB_OK|MB_ICONEXCLAMATION "Служба Capri VPN ещё установлена. Удалите её во вкладке VPN и повторите удаление приложения."
        Abort
      ${EndIf}
    ${EndIf}
  ${endIf}
!macroend
