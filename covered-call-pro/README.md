# Covered Call Analyzer Pro

## Quick Start

### 1 — Install Node dependencies
```
npm install
```

### 2 — Set your Anthropic API key
Create a file called `.env` in this folder:
```
VITE_ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
```
Get your key at: https://console.anthropic.com

### 3 — Start the Python backend (optional but recommended)
Open a CMD window and run:
```
start_greeks_server.bat
```
This enables:
- py_vollib (LetsBeRational) for ultra-accurate Greeks
- American option pricing (BS1993, BS2002, CRR Binomial Tree)
- Full volatility surface computation

### 4 — Start the React app
Open another CMD window:
```
npm run dev
```

### 5 — Open in browser
```
http://localhost:5173
```

---

## Features
- 📊 Black-Scholes-Merton pricing via py_vollib
- 🌊 SABR volatility surface (Hagan 2002, calibrated from live chain)
- 🎲 Monte Carlo simulation (3,000 GBM paths)
- 📈 Payoff diagram
- 🇺🇸 American options (BS1993, BS2002, CRR Binomial Tree)
- 🔗 Live options chain (Yahoo Finance)
- 🤖 AI options strategist (Claude)

## Files
- `src/App.jsx` — main React dashboard
- `src/AmericanOptions.jsx` — American options tab
- `greeks_server.py` — Python Flask API (py_vollib backend)
- `start_greeks_server.bat` — one-click server startup (Windows)
