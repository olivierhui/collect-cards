@echo off
cd /d "%~dp0"
echo Installing dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo pip install failed.
  pause
  exit /b 1
)
echo Starting http://127.0.0.1:8788
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8788 --reload
pause
