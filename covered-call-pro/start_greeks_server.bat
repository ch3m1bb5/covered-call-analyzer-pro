@echo off
echo ============================================================
echo   Covered Call Analyzer Pro — Python Backend
echo ============================================================
echo.
echo Installing dependencies...
pip install py_vollib flask flask-cors numpy --quiet
echo.
echo Starting Greeks API server on http://localhost:5050
echo Keep this window open while using the dashboard.
echo Press Ctrl+C to stop.
echo ============================================================
echo.
python greeks_server.py
pause
