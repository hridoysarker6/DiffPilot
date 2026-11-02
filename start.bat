@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing dependencies...
  call npm install || goto :err
  call npx playwright install chromium || goto :err
)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4000"
node src/server.js
goto :eof
:err
echo Setup failed.
pause
