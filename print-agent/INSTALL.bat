@echo off
setlocal
cd /d "%~dp0"
echo POS Print Agent o'rnatilmoqda...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
if errorlevel 1 (
  echo.
  echo O'rnatishda xatolik. Yuqoridagi xabarni rasmga olib yuboring.
  pause
  exit /b 1
)
echo.
echo Tayyor. Brauzerda tekshiring: http://127.0.0.1:9100/health
pause
