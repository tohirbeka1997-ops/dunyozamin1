@echo off
REM Run stock verification queries against the Electron app's SQLite database
REM 
REM Usage:
REM   scripts\run_verify_stock.bat <db-path>
REM
REM Example:
REM   scripts\run_verify_stock.bat "C:\Users\YourName\AppData\Roaming\POS Tizimi\pos.db"

if "%1"=="" (
    echo Error: Database path required
    echo Usage: scripts\run_verify_stock.bat ^<db-path^>
    exit /b 1
)

set DB_PATH=%1

echo Running stock verification against: %DB_PATH%
echo.

node scripts\run_verify_stock.cjs "%DB_PATH%"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Verification failed. See errors above.
    exit /b 1
)

