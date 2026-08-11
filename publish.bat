@echo off
setlocal
cd /d "%~dp0"

echo === Running scripts\publish-desktop.ps1 ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-desktop.ps1"
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% neq 0 (
    echo Publish FAILED ^(exit code %EXITCODE%^).
) else (
    echo Publish succeeded.
)

echo.
pause
exit /b %EXITCODE%
