@echo off
chcp 65001 >nul
title ngrok RPC - localhost:3333
cd /d "%~dp0\.."

where ngrok >nul 2>&1
if errorlevel 1 (
  echo [x] "ngrok" PATH da yoq. ngrok.exe papkasini PATH ga qo'shing yoki bu faylda to'g'ridan-to'g'ri yo'l ishlating.
  pause
  exit /b 1
)

echo.
echo  POS Electron HOST ishlayotgan bo'lsin (RPC odatda 3333-port).
echo  Bu oynani YOPMANG - tunnel shu yerda turadi.
echo  Ctrl+C = to'xtatish
echo.

ngrok http 3333 --log=stdout

echo.
echo --- ngrok jarayoni tugadi (yuqoridagi xatoni o'qing) ---
pause
