@echo off
echo ============================================================
echo   Covered Call Analyzer Pro — Python Backend
echo ============================================================
echo.
echo Installing dependencies...
pip install py_vollib flask flask-cors numpy --quiet
echo.
echo Starting on http://localhost:5050
echo Models: BS1993 / BS2002 / CRR Binomial Tree / European BSM
echo Keep this window open. Press Ctrl+C to stop.
echo ============================================================
echo.
python greeks_server.py
pause
