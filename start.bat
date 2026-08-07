@echo off
echo ================================================
echo   Job Hunt Command Centre
echo ================================================

cd /d "%~dp0backend"
echo.
echo Installing Python dependencies...
pip install -r requirements.txt -q

echo Starting backend on http://localhost:8000 ...
start "Backend" python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

cd /d "%~dp0frontend"
echo Installing Node dependencies...
call npm install --silent

echo Starting frontend on http://localhost:5173 ...
start "Frontend" npm run dev

echo.
echo ================================================
echo   App running at: http://localhost:5173
echo   API running at: http://localhost:8000
echo   Close this window or press Ctrl+C to stop
echo ================================================
pause
