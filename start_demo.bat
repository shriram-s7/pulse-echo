@echo off
cd /d "%~dp0"
start "Pulse-Echo API" cmd /k "call .venv\Scripts\activate.bat && uvicorn api.main:app --host 127.0.0.1 --port 8000"
start "Pulse-Echo Web" cmd /k "cd /d %~dp0web && npm run dev"
timeout /t 6 /nobreak >nul
start "" http://localhost:5173
