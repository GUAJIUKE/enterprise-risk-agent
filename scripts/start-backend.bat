@echo off
chcp 65001 >nul
echo ==========================================
echo  Enterprise Risk Analyst - Backend
echo ==========================================
cd /d "%~dp0..\backend"

if not exist ".venv\Scripts\python.exe" goto usepython
".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --port 8000
goto end

:usepython
python -m uvicorn app.main:app --reload --port 8000

:end
pause
