@echo off
chcp 65001 >nul
cd /d "%~dp0"

git init
git branch -M main
git config user.email "olivierhui@users.noreply.github.com"
git config user.name "olivierhui"

git remote remove origin 2>nul
git remote add origin https://github.com/olivierhui/collect-cards.git

git add .
git status
git commit -m "Initial cabinet: FastAPI + frontend auto-grant"
if errorlevel 1 (
  echo Commit failed.
  pause
  exit /b 1
)

git push -u origin main
if errorlevel 1 (
  echo.
  echo Push failed. If GitHub asks you to log in, finish that, then run this file again.
  pause
  exit /b 1
)

echo.
echo Done. Open https://github.com/olivierhui/collect-cards
echo If you see backend/main.py, go back to Render and click Deploy.
pause

