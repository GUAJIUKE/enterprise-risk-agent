@echo off
chcp 65001 >nul
echo ==========================================
echo  Enterprise Risk Analyst - Frontend
echo ==========================================
cd /d "%~dp0..\frontend"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
)

call npm run dev
pause
