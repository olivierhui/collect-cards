@echo off
chcp 65001 >nul
cd /d "%~dp0"

git config user.email "olivierhui@users.noreply.github.com"
git config user.name "olivierhui"

git add backend/main.py backend/store.py backend/github_sync.py backend/patreon.py
git add frontend/index.html frontend/app.js frontend/editor.js frontend/styles.css frontend/admin.html frontend/admin.js frontend/card.js
git add README.md 项目进度.md Procfile requirements.txt runtime.txt start.cmd
git add data/catalog.json data/site.json data/catalog.example.json
git add -u

git status
git commit -m "On-page visual editor, drop-fix, slot reorder"
if errorlevel 1 (
  echo Nothing to commit or commit failed.
)

git push origin main
if errorlevel 1 (
  echo.
  echo Push failed. Check GitHub login, then run this file again.
  echo Render will auto-deploy after a successful push.
  pause
  exit /b 1
)

echo.
echo Pushed to https://github.com/olivierhui/collect-cards
echo Wait 1-3 minutes, then open https://collect-cards.onrender.com/
pause
