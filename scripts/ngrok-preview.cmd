@echo off
chcp 65001 >nul
title ngrok Vite preview - localhost:4173
cd /d "%~dp0\.."

where ngrok >nul 2>&1
if errorlevel 1 (
  echo [x] "ngrok" PATH da yoq.
  pause
  exit /b 1
)

echo.
echo  Avval boshqa terminalda: npm run preview  (4173 ochilishi kerak)
echo  Bu oynani YOPMANG.
echo.

ngrok http 4173 --log=stdout

echo.
echo --- ngrok jarayoni tugadi ---
pause
