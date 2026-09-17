@echo off
chcp 65001 >nul
cd /d "%~dp0"
git config user.email "olivierhui@users.noreply.github.com"
git config user.name "olivierhui"
git add backend/patreon.py backend/store.py backend/main.py frontend/app.js .env.example 项目进度.md
git commit -m "Creator logs in as T5 and can see dropped cards"
git push origin main
if errorlevel 1 (
  echo Push failed.
  pause
  exit /b 1
)
echo Pushed. Wait for Render Live, then logout and login again.
pause
