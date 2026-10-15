@echo off
setlocal enabledelayedexpansion
title Covered Call Analyzer Pro — Setup

echo.
echo ============================================================
echo   COVERED CALL ANALYZER PRO — FULL SETUP
echo ============================================================
echo.

:: ── CONFIG — change this if you want a different folder ──────────────────────
set PROJECT=C:\Users\%USERNAME%\covered-call-pro
set NODE_MIN=18

:: ── STEP 1: Check Python ─────────────────────────────────────────────────────
echo [1/8] Checking Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Python not found.
    echo  Please install Python from https://python.org
    echo  Make sure to check "Add Python to PATH" during install.
    echo.
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do echo  Python %%v found. OK
echo.

:: ── STEP 2: Check Node.js ────────────────────────────────────────────────────
echo [2/8] Checking Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Node.js not found.
    echo  Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f %%v in ('node --version 2^>^&1') do echo  Node.js %%v found. OK
echo.

:: ── STEP 3: Check npm ────────────────────────────────────────────────────────
echo [3/8] Checking npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: npm not found. Reinstall Node.js.
    pause
    exit /b 1
)
for /f %%v in ('npm --version 2^>^&1') do echo  npm %%v found. OK
echo.

:: ── STEP 4: Create project folder ────────────────────────────────────────────
echo [4/8] Creating project folder...
if exist "%PROJECT%" (
    echo  Folder already exists: %PROJECT%
    echo  Skipping creation.
) else (
    mkdir "%PROJECT%"
    mkdir "%PROJECT%\src"
    echo  Created: %PROJECT%
)
echo.

:: ── STEP 5: Check that user files exist ──────────────────────────────────────
echo [5/8] Checking your source files...
echo.
echo  Looking for files in the SAME folder as this script:
echo  %~dp0
echo.

set MISSING=0

call :checkfile "App.jsx"
call :checkfile "main.jsx"
call :checkfile "BSMReference.jsx"
call :checkfile "MonteCarloGBM.jsx"
call :checkfile "AmericanOptions.jsx"
call :checkfile "greeks_server.py"

if %MISSING% gtr 0 (
    echo.
    echo  ERROR: %MISSING% file(s) missing.
    echo  Place ALL the following files in the same folder as this script:
    echo.
    echo    App.jsx
    echo    main.jsx
    echo    BSMReference.jsx
    echo    MonteCarloGBM.jsx
    echo    AmericanOptions.jsx
    echo    greeks_server.py
    echo.
    pause
    exit /b 1
)
echo.
echo  All source files found. OK
echo.

:: ── STEP 6: Copy source files into project ───────────────────────────────────
echo [6/8] Copying files into project...

copy /Y "%~dp0App.jsx"             "%PROJECT%\src\App.jsx"             >nul
copy /Y "%~dp0main.jsx"            "%PROJECT%\src\main.jsx"            >nul
copy /Y "%~dp0BSMReference.jsx"    "%PROJECT%\src\BSMReference.jsx"    >nul
copy /Y "%~dp0MonteCarloGBM.jsx"   "%PROJECT%\src\MonteCarloGBM.jsx"   >nul
copy /Y "%~dp0AmericanOptions.jsx" "%PROJECT%\src\AmericanOptions.jsx" >nul
copy /Y "%~dp0greeks_server.py"    "%PROJECT%\greeks_server.py"        >nul

echo  Files copied to %PROJECT%
echo.

:: ── Write index.html ─────────────────────────────────────────────────────────
echo [6/8] Writing index.html...
(
echo ^<!doctype html^>
echo ^<html lang="en"^>
echo   ^<head^>
echo     ^<meta charset="UTF-8"/^>
echo     ^<meta name="viewport" content="width=device-width, initial-scale=1.0"/^>
echo     ^<title^>Covered Call Analyzer Pro^</title^>
echo   ^</head^>
echo   ^<body^>
echo     ^<div id="root"^>^</div^>
echo     ^<script type="module" src="/src/main.jsx"^>^</script^>
echo   ^</body^>
echo ^</html^>
) > "%PROJECT%\index.html"
echo  index.html written. OK
echo.

:: ── Write vite.config.js ─────────────────────────────────────────────────────
(
echo import { defineConfig } from 'vite'
echo import react from '@vitejs/plugin-react'
echo export default defineConfig({ plugins: [react()] })
) > "%PROJECT%\vite.config.js"
echo  vite.config.js written. OK
echo.

:: ── Write package.json ───────────────────────────────────────────────────────
(
echo {
echo   "name": "covered-call-pro",
echo   "private": true,
echo   "version": "2.0.0",
echo   "type": "module",
echo   "scripts": {
echo     "dev": "vite",
echo     "build": "vite build",
echo     "preview": "vite preview"
echo   },
echo   "dependencies": {
echo     "react": "^18.3.1",
echo     "react-dom": "^18.3.1",
echo     "@uqee/black-scholes": "^1.0.7"
echo   },
echo   "devDependencies": {
echo     "@vitejs/plugin-react": "^4.3.1",
echo     "vite": "^5.4.2"
echo   }
echo }
) > "%PROJECT%\package.json"
echo  package.json written. OK
echo.

:: ── Write start_server.bat ───────────────────────────────────────────────────
(
echo @echo off
echo title Greeks API Server
echo echo.
echo echo ============================================================
echo echo   Greeks API Server - localhost:5050
echo echo ============================================================
echo echo.
echo echo Installing Python dependencies...
echo pip install py_vollib flask flask-cors numpy --quiet
echo echo.
echo echo Server starting on http://localhost:5050
echo echo Keep this window open. Press Ctrl+C to stop.
echo echo ============================================================
echo echo.
echo python "%PROJECT%\greeks_server.py"
echo pause
) > "%PROJECT%\start_server.bat"
echo  start_server.bat written. OK
echo.

:: ── Write start_dashboard.bat ────────────────────────────────────────────────
(
echo @echo off
echo title Covered Call Dashboard
echo echo.
echo echo ============================================================
echo echo   Covered Call Analyzer Pro
echo echo   Opening http://localhost:5173
echo echo ============================================================
echo echo.
echo cd /d "%PROJECT%"
echo npm run dev
echo pause
) > "%PROJECT%\start_dashboard.bat"
echo  start_dashboard.bat written. OK
echo.

:: ── STEP 7: Install Python dependencies ──────────────────────────────────────
echo [7/8] Installing Python dependencies...
echo  This may take 1-2 minutes...
echo.
pip install py_vollib flask flask-cors numpy --quiet
if %errorlevel% neq 0 (
    echo  WARNING: Some Python packages may have failed.
    echo  You can try manually: pip install py_vollib flask flask-cors numpy
) else (
    echo  Python packages installed. OK
)
echo.

:: ── STEP 8: Install Node dependencies ────────────────────────────────────────
echo [8/8] Installing Node.js dependencies...
echo  This may take 1-2 minutes...
echo.
cd /d "%PROJECT%"
call npm install --silent
if %errorlevel% neq 0 (
    echo  ERROR: npm install failed.
    echo  Try running manually: cd %PROJECT% ^&^& npm install
    pause
    exit /b 1
)
echo  Node packages installed. OK
echo.

:: ── Ask for API key ───────────────────────────────────────────────────────────
echo ============================================================
echo   ANTHROPIC API KEY SETUP
echo ============================================================
echo.
echo  You need an Anthropic API key for the AI Analysis tab.
echo  Get one free at: https://console.anthropic.com
echo.
set /p APIKEY= Enter your API key (or press Enter to skip): 

if not "!APIKEY!"=="" (
    echo VITE_ANTHROPIC_API_KEY=!APIKEY!> "%PROJECT%\.env"
    echo  API key saved to .env
) else (
    echo VITE_ANTHROPIC_API_KEY=your_key_here> "%PROJECT%\.env"
    echo  Skipped. Edit %PROJECT%\.env later to add your key.
)
echo.

:: ── DONE ─────────────────────────────────────────────────────────────────────
echo ============================================================
echo   SETUP COMPLETE
echo ============================================================
echo.
echo  Project folder: %PROJECT%
echo.
echo  HOW TO RUN:
echo.
echo   Step 1 — Double-click:  %PROJECT%\start_server.bat
echo            (opens the Python backend on localhost:5050)
echo.
echo   Step 2 — Double-click:  %PROJECT%\start_dashboard.bat
echo            (opens the React app on localhost:5173)
echo.
echo   Step 3 — Open browser:  http://localhost:5173
echo.
echo ============================================================
echo.

:: Open the project folder
explorer "%PROJECT%"

pause
exit /b 0

:: ── Helper: check if a file exists ───────────────────────────────────────────
:checkfile
if exist "%~dp0%~1" (
    echo  [OK] %~1
) else (
    echo  [MISSING] %~1
    set /a MISSING+=1
)
exit /b
