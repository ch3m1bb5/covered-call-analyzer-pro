import { useState, useEffect, useCallback, useRef } from "react";

// ── Math helpers ──────────────────────────────────────────────────────────────
function erf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return sign * y;
}
function normCDF(x) { return 0.5 * (1 + erf(x / Math.sqrt(2))); }
function normPDF(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

function blackScholes(S, K, T, r, sigma) {
  if (T <= 0) return { call: Math.max(S - K, 0), put: Math.max(K - S, 0), delta: S > K ? 1 : 0, gamma: 0, theta: 0, vega: 0, d1: 0, d2: 0 };
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const call = S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  const put = K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
  const delta = normCDF(d1);
  const gamma = normPDF(d1) / (S * sigma * Math.sqrt(T));
  const theta = (-S * normPDF(d1) * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normCDF(d2)) / 365;
  const vega = S * normPDF(d1) * Math.sqrt(T) / 100;
  return { call, put, delta, gamma, theta, vega, d1, d2 };
}

function impliedVol(S, K, T, r, marketPrice) {
  if (marketPrice <= 0) return 0;
  let low = 0.001, high = 5.0;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    const price = blackScholes(S, K, T, r, mid).call;
    if (Math.abs(price - marketPrice) < 0.0001) return mid;
    if (price > marketPrice) high = mid; else low = mid;
  }
  return (low + high) / 2;
}

function calcRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function historicalVol(prices, window = 30) {
  if (!prices || prices.length < 2) return 0.3;
  const logRets = [];
  for (let i = 1; i < prices.length; i++) logRets.push(Math.log(prices[i] / prices[i - 1]));
  const slice = logRets.slice(-window);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
  return Math.sqrt(variance * 252);
}

function arimaScore(prices) {
  if (!prices || prices.length < 22) return { momentum5: 0, momentum20: 0, ar1: 0, avgDailyReturn: 0 };
  const n = prices.length;
  const returns = [];
  for (let i = 1; i < n; i++) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  const recentRet = returns.slice(-20);
  const avgRet = recentRet.reduce((a, b) => a + b, 0) / recentRet.length;
  const momentum5 = (prices[n - 1] - prices[Math.max(0, n - 6)]) / prices[Math.max(0, n - 6)] * 100;
  const momentum20 = (prices[n - 1] - prices[Math.max(0, n - 21)]) / prices[Math.max(0, n - 21)] * 100;
  let cov = 0, varX = 0;
  for (let i = 1; i < returns.length; i++) {
    cov += (returns[i] - avgRet) * (returns[i - 1] - avgRet);
    varX += (returns[i - 1] - avgRet) ** 2;
  }
  const ar1 = varX > 0 ? cov / varX : 0;
  return { momentum5, momentum20, ar1, avgDailyReturn: avgRet * 100 };
}

// ── Monte Carlo simulation ────────────────────────────────────────────────────
function runMonteCarlo(S, K, T, sigma, r, numPaths = 2000) {
  const dt = T / 252;
  const steps = Math.max(1, Math.round(T * 252));
  const paths = [];
  const finalPrices = [];

  // Box-Muller for normal random numbers
  function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const drift = (r - 0.5 * sigma * sigma) * dt;
  const diffusion = sigma * Math.sqrt(dt);

  // Store subset of paths for visualization
  const pathsToStore = 50;
  for (let p = 0; p < numPaths; p++) {
    let price = S;
    const storePath = p < pathsToStore;
    const pathArr = storePath ? [S] : null;
    for (let s = 0; s < steps; s++) {
      price *= Math.exp(drift + diffusion * randn());
      if (storePath) pathArr.push(price);
    }
    if (storePath) paths.push(pathArr);
    finalPrices.push(price);
  }

  finalPrices.sort((a, b) => a - b);
  const p5 = finalPrices[Math.floor(numPaths * 0.05)];
  const p25 = finalPrices[Math.floor(numPaths * 0.25)];
  const p50 = finalPrices[Math.floor(numPaths * 0.50)];
  const p75 = finalPrices[Math.floor(numPaths * 0.75)];
  const p95 = finalPrices[Math.floor(numPaths * 0.95)];
  const probAboveStrike = finalPrices.filter(p => p > K).length / numPaths;
  const callPayoffs = finalPrices.map(p => Math.max(p - K, 0));
  const mcCallPrice = Math.exp(-r * T) * callPayoffs.reduce((a, b) => a + b, 0) / numPaths;

  return { paths, finalPrices, p5, p25, p50, p75, p95, probAboveStrike, mcCallPrice };
}

// ── Fetch real price history ──────────────────────────────────────────────────
async function fetchYahooPrices(ticker) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - (90 * 24 * 60 * 60);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${start}&period2=${end}`;
  const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxy);
  const json = await res.json();
  const data = JSON.parse(json.contents);
  const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if (!closes || closes.length === 0) throw new Error("No price data");
  return closes.filter(p => p != null).map(p => parseFloat(p.toFixed(2)));
}

// ── Fetch live options chain ──────────────────────────────────────────────────
async function fetchOptionsChain(ticker) {
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${ticker}`;
  const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxy);
  const json = await res.json();
  const data = JSON.parse(json.contents);
  const result = data?.optionChain?.result?.[0];
  if (!result) throw new Error("No options data");
  const calls = result?.options?.[0]?.calls || [];
  const puts = result?.options?.[0]?.puts || [];
  const expirations = result?.expirationDates || [];
  return { calls, puts, expirations, quote: result?.quote };
}

function generateFallbackPrices(S) {
  const prices = [];
  let p = S * 0.92;
  for (let i = 0; i < 89; i++) {
    p += (Math.random() - 0.48) * p * 0.012;
    prices.push(parseFloat(p.toFixed(2)));
  }
  prices.push(S);
  return prices;
}

function buildStrikes(S) {
  const base = Math.round(S / 5) * 5;
  const strikes = [];
  for (let k = base - 10; k <= base + 50; k += 5) strikes.push(k);
  return strikes;
}

function generateWeeklyPrices(daily) {
  const w = [];
  for (let i = 0; i < daily.length; i += 5) w.push(daily[i]);
  return w;
}

const inputStyle = { background: "#0d0d18", border: "1px solid #2d2d40", borderRadius: "6px", color: "#e2e8f0", padding: "8px 10px", fontSize: "13px", width: "100%", fontFamily: "'DM Mono','Courier New',monospace", outline: "none", boxSizing: "border-box" };
const labelStyle = { fontSize: "10px", letterSpacing: "0.15em", textTransform: "uppercase", color: "#4a5568", marginBottom: "4px", display: "block" };

// ── TAB COMPONENT ─────────────────────────────────────────────────────────────
function Tab({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: "4px", marginBottom: "20px", background: "#0d0d18", borderRadius: "8px", padding: "4px" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          flex: 1, padding: "8px 4px", border: "none", borderRadius: "6px", cursor: "pointer",
          fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace",
          fontWeight: "600", transition: "all 0.2s",
          background: active === t.id ? "#6366f1" : "transparent",
          color: active === t.id ? "#fff" : "#4a5568",
        }}>{t.icon} {t.label}</button>
      ))}
    </div>
  );
}

// ── PAYOFF DIAGRAM ────────────────────────────────────────────────────────────
function PayoffDiagram({ S, K, COST, PREM, SHARES }) {
  const W = 560, H = 220;
  const priceMin = S * 0.7, priceMax = S * 1.4;
  const pts = 100;
  const prices = Array.from({ length: pts }, (_, i) => priceMin + (priceMax - priceMin) * (i / (pts - 1)));

  // Covered call P&L = stock gain/loss + premium - capped at strike
  const pnls = prices.map(p => {
    const stockPnL = (p - COST) * SHARES;
    const optionPnL = p >= K ? -(p - K) * SHARES : 0;
    return stockPnL + PREM * SHARES + optionPnL;
  });

  // Naked stock P&L (no option)
  const nakedPnls = prices.map(p => (p - COST) * SHARES);

  const allVals = [...pnls, ...nakedPnls];
  const minPnl = Math.min(...allVals);
  const maxPnl = Math.max(...allVals);
  const pad = 20;
  const xScale = (p) => pad + (p - priceMin) / (priceMax - priceMin) * (W - pad * 2);
  const yScale = (v) => pad + (1 - (v - minPnl) / (maxPnl - minPnl)) * (H - pad * 2);
  const zeroY = yScale(0);

  const coveredPath = prices.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p)},${yScale(pnls[i])}`).join("");
  const nakedPath = prices.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p)},${yScale(nakedPnls[i])}`).join("");

  // Key price points
  const breakevenCC = COST - PREM;
  const maxProfitPrice = K;
  const maxProfit = (K - COST + PREM) * SHARES;

  const xTicks = [S * 0.8, S * 0.9, S, K, S * 1.2, S * 1.3].filter(p => p >= priceMin && p <= priceMax);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "16px" }}>
        {[
          { label: "Max Profit", value: `$${maxProfit.toFixed(0)}`, sub: `at $${K}+`, color: "#10b981" },
          { label: "Breakeven", value: `$${breakevenCC.toFixed(2)}`, sub: "covered call", color: "#f59e0b" },
          { label: "Premium Collected", value: `$${(PREM * SHARES).toFixed(0)}`, sub: `$${PREM}/share × ${SHARES}`, color: "#6366f1" },
        ].map(item => (
          <div key={item.label} style={{ background: "#0d0d18", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: "9px", color: "#4a5568", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "4px" }}>{item.label}</div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "18px", fontWeight: "700", color: item.color }}>{item.value}</div>
            <div style={{ fontSize: "9px", color: "#4a5568", marginTop: "2px" }}>{item.sub}</div>
          </div>
        ))}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible", background: "#0d0d18", borderRadius: "8px" }}>
        {/* Zero line */}
        <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="#2d2d40" strokeWidth="1" strokeDasharray="4,3" />
        <text x={pad + 4} y={zeroY - 4} fontSize="8" fill="#4a5568">$0</text>

        {/* Strike line */}
        <line x1={xScale(K)} y1={pad} x2={xScale(K)} y2={H - pad} stroke="#6366f1" strokeWidth="1" strokeDasharray="4,3" opacity="0.6" />
        <text x={xScale(K) + 3} y={pad + 10} fontSize="8" fill="#6366f1">Strike ${K}</text>

        {/* Current price line */}
        <line x1={xScale(S)} y1={pad} x2={xScale(S)} y2={H - pad} stroke="#94a3b8" strokeWidth="1" strokeDasharray="2,2" opacity="0.4" />
        <text x={xScale(S) + 3} y={H - pad - 4} fontSize="8" fill="#94a3b8">Now ${S}</text>

        {/* Naked stock path */}
        <path d={nakedPath} fill="none" stroke="#4a5568" strokeWidth="1.5" strokeDasharray="6,3" opacity="0.5" />

        {/* Covered call area fill */}
        <defs>
          <linearGradient id="covGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={coveredPath + `L${W - pad},${H - pad} L${pad},${H - pad}Z`} fill="url(#covGrad)" />
        <path d={coveredPath} fill="none" stroke="#10b981" strokeWidth="2.5" />

        {/* Max profit dot */}
        <circle cx={xScale(maxProfitPrice)} cy={yScale(maxProfit)} r="4" fill="#10b981" />

        {/* Breakeven dot */}
        <circle cx={xScale(breakevenCC)} cy={yScale(0)} r="4" fill="#f59e0b" />
        <text x={xScale(breakevenCC) + 5} y={zeroY - 6} fontSize="8" fill="#f59e0b">BE</text>

        {/* X axis ticks */}
        {xTicks.map(p => (
          <g key={p}>
            <line x1={xScale(p)} y1={H - pad} x2={xScale(p)} y2={H - pad + 4} stroke="#2d2d40" strokeWidth="1" />
            <text x={xScale(p)} y={H - pad + 13} fontSize="7" fill="#4a5568" textAnchor="middle">${p.toFixed(0)}</text>
          </g>
        ))}

        {/* Legend */}
        <line x1={W - 120} y1={15} x2={W - 100} y2={15} stroke="#10b981" strokeWidth="2" />
        <text x={W - 96} y={19} fontSize="8" fill="#10b981">Covered Call</text>
        <line x1={W - 120} y1={28} x2={W - 100} y2={28} stroke="#4a5568" strokeWidth="1.5" strokeDasharray="5,3" />
        <text x={W - 96} y={32} fontSize="8" fill="#4a5568">Naked Stock</text>
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "10px", color: "#4a5568" }}>
        <span>← Lower stock price</span>
        <span style={{ color: "#10b981" }}>— Covered call &nbsp; <span style={{ color: "#4a5568" }}>--- Naked stock</span></span>
        <span>Higher stock price →</span>
      </div>
    </div>
  );
}

// ── MONTE CARLO COMPONENT ────────────────────────────────────────────────────
function MonteCarloView({ S, K, T, IV, r, PREM, SHARES, COST }) {
  const [mcData, setMcData] = useState(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      const data = runMonteCarlo(S, K, T, IV, r, 3000);
      setMcData(data);
      setRunning(false);
    }, 50);
  }, [S, K, T, IV, r]);

  useEffect(() => { run(); }, []);

  if (running || !mcData) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", gap: "12px", color: "#4a5568" }}>
      <span style={{ animation: "pulse 1s infinite", fontSize: "20px" }}>◎</span>
      <span style={{ fontSize: "13px" }}>Running 3,000 price simulations...</span>
    </div>
  );

  const W = 560, H = 180;
  const steps = mcData.paths[0]?.length || 1;
  const allPathPrices = mcData.paths.flat();
  const minP = Math.min(...allPathPrices) * 0.98;
  const maxP = Math.max(...allPathPrices) * 1.02;
  const pad = 20;
  const xS = (i) => pad + i / (steps - 1) * (W - pad * 2);
  const yS = (p) => pad + (1 - (p - minP) / (maxP - minP)) * (H - pad * 2);

  // Distribution histogram
  const histW = 560, histH = 120;
  const bins = 40;
  const binMin = mcData.finalPrices[0] * 0.98;
  const binMax = mcData.finalPrices[mcData.finalPrices.length - 1] * 1.02;
  const binSize = (binMax - binMin) / bins;
  const counts = Array(bins).fill(0);
  mcData.finalPrices.forEach(p => {
    const b = Math.min(bins - 1, Math.floor((p - binMin) / binSize));
    if (b >= 0) counts[b]++;
  });
  const maxCount = Math.max(...counts);
  const hxS = (i) => 20 + i * (histW - 40) / bins;
  const hyS = (c) => histH - 20 - (c / maxCount) * (histH - 30);
  const strikeBar = Math.floor((K - binMin) / binSize);

  const covCallPnl = mcData.finalPrices.map(p => {
    const stockPnl = (Math.min(p, K) - COST) * SHARES;
    return stockPnl + PREM * SHARES;
  });
  const avgCCPnl = covCallPnl.reduce((a, b) => a + b, 0) / covCallPnl.length;
  const pctPositive = covCallPnl.filter(v => v > 0).length / covCallPnl.length * 100;

  return (
    <div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "8px", marginBottom: "16px" }}>
        {[
          { label: "MC Call Price", value: `$${mcData.mcCallPrice.toFixed(2)}`, color: "#6366f1", sub: "vs BS fair value" },
          { label: "Prob > Strike", value: `${(mcData.probAboveStrike * 100).toFixed(1)}%`, color: "#ef4444", sub: "assignment risk" },
          { label: "Median Outcome", value: `$${mcData.p50.toFixed(2)}`, color: "#e2e8f0", sub: "50th percentile" },
          { label: "Avg CC P&L", value: `${avgCCPnl >= 0 ? "+" : ""}$${avgCCPnl.toFixed(0)}`, color: avgCCPnl >= 0 ? "#10b981" : "#ef4444", sub: "expected outcome" },
          { label: "% Profitable", value: `${pctPositive.toFixed(1)}%`, color: pctPositive > 50 ? "#10b981" : "#f59e0b", sub: "paths with profit" },
        ].map(s => (
          <div key={s.label} style={{ background: "#0d0d18", borderRadius: "8px", padding: "10px", textAlign: "center" }}>
            <div style={{ fontSize: "9px", color: "#4a5568", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>{s.label}</div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "15px", fontWeight: "700", color: s.color }}>{s.value}</div>
            <div style={{ fontSize: "9px", color: "#4a5568", marginTop: "2px" }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Price path spaghetti chart */}
      <div style={{ background: "#0d0d18", borderRadius: "8px", padding: "12px", marginBottom: "12px" }}>
        <div style={{ fontSize: "10px", color: "#4a5568", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "8px" }}>
          Price Path Simulation (50 of 3,000 paths shown)
        </div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
          {/* Percentile bands */}
          {[{ lo: mcData.p5, hi: mcData.p95, color: "#6366f1", op: 0.08 }, { lo: mcData.p25, hi: mcData.p75, color: "#6366f1", op: 0.15 }].map((band, i) => (
            <rect key={i} x={pad} y={yS(band.hi)} width={W - pad * 2} height={Math.abs(yS(band.lo) - yS(band.hi))} fill={band.color} opacity={band.op} rx="2" />
          ))}
          {/* Individual paths */}
          {mcData.paths.map((path, pi) => (
            <path key={pi} d={path.map((p, i) => `${i === 0 ? "M" : "L"}${xS(i)},${yS(p)}`).join("")}
              fill="none" stroke="#6366f1" strokeWidth="0.5" opacity="0.2" />
          ))}
          {/* Strike line */}
          <line x1={pad} y1={yS(K)} x2={W - pad} y2={yS(K)} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="6,3" />
          <text x={W - pad - 2} y={yS(K) - 4} fontSize="8" fill="#ef4444" textAnchor="end">Strike ${K}</text>
          {/* Start dot */}
          <circle cx={pad} cy={yS(S)} r="5" fill="#10b981" />
          <text x={pad + 8} y={yS(S) + 4} fontSize="8" fill="#10b981">${S}</text>
          {/* Percentile labels */}
          <text x={W - pad + 3} y={yS(mcData.p95) + 3} fontSize="7" fill="#6366f1">P95</text>
          <text x={W - pad + 3} y={yS(mcData.p50) + 3} fontSize="7" fill="#94a3b8">P50</text>
          <text x={W - pad + 3} y={yS(mcData.p5) + 3} fontSize="7" fill="#6366f1">P5</text>
          {/* P50 line */}
          <line x1={pad} y1={yS(mcData.p50)} x2={W - pad} y2={yS(mcData.p50)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
        </svg>
      </div>

      {/* Distribution histogram */}
      <div style={{ background: "#0d0d18", borderRadius: "8px", padding: "12px" }}>
        <div style={{ fontSize: "10px", color: "#4a5568", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "8px" }}>
          Final Price Distribution at Expiration
        </div>
        <svg width="100%" viewBox={`0 0 ${histW} ${histH}`}>
          {counts.map((c, i) => {
            const isAboveStrike = i >= strikeBar;
            return (
              <rect key={i} x={hxS(i)} y={hyS(c)} width={(histW - 40) / bins - 1} height={histH - 20 - hyS(c)}
                fill={isAboveStrike ? "#ef444460" : "#6366f160"} stroke={isAboveStrike ? "#ef4444" : "#6366f1"} strokeWidth="0.5" />
            );
          })}
          {/* Strike marker */}
          {strikeBar >= 0 && strikeBar < bins && (
            <>
              <line x1={hxS(strikeBar)} y1={0} x2={hxS(strikeBar)} y2={histH - 20} stroke="#ef4444" strokeWidth="2" strokeDasharray="4,2" />
              <text x={hxS(strikeBar) + 3} y={12} fontSize="8" fill="#ef4444">Strike ${K}</text>
            </>
          )}
          {/* Percentile labels */}
          {[{ v: mcData.p5, l: "5%" }, { v: mcData.p50, l: "50%" }, { v: mcData.p95, l: "95%" }].map(({ v, l }) => {
            const bx = hxS(Math.floor((v - binMin) / binSize));
            return (
              <g key={l}>
                <line x1={bx} y1={histH - 20} x2={bx} y2={histH - 10} stroke="#94a3b8" strokeWidth="1" />
                <text x={bx} y={histH - 2} fontSize="7" fill="#4a5568" textAnchor="middle">{l} ${v.toFixed(0)}</text>
              </g>
            );
          })}
        </svg>
        <div style={{ display: "flex", gap: "16px", marginTop: "8px", fontSize: "10px" }}>
          <span style={{ color: "#6366f1" }}>■ Below strike (no assignment)</span>
          <span style={{ color: "#ef4444" }}>■ Above strike (shares called away)</span>
        </div>
      </div>
      <button onClick={run} style={{ marginTop: "12px", padding: "8px 16px", background: "#1e1e2e", border: "1px solid #2d2d40", borderRadius: "6px", color: "#94a3b8", fontSize: "10px", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>
        ↺ Re-run Simulation
      </button>
    </div>
  );
}

// ── VOLATILITY SURFACE ────────────────────────────────────────────────────────
function VolSurface({ S, IV, r, optionsChain }) {
  const strikes = [0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20].map(m => Math.round(S * m / 5) * 5);
  const expiries = [7, 14, 30, 45, 60, 90, 120, 180].map(d => d / 365);
  const expLabels = ["1W", "2W", "1M", "6W", "2M", "3M", "4M", "6M"];

  // Build IV surface — use real options chain data where available, else BS smile approximation
  const ivGrid = expiries.map(T =>
    strikes.map(K => {
      // Try to find real market data
      if (optionsChain?.calls?.length > 0) {
        const match = optionsChain.calls.find(c => Math.abs(c.strike - K) < S * 0.02);
        if (match && match.impliedVolatility > 0) return match.impliedVolatility * 100;
      }
      // Approximate vol smile: higher IV for OTM options (skew)
      const moneyness = Math.log(K / S);
      const skew = -0.1 * moneyness + 0.05 * moneyness * moneyness;
      const termStructure = 1 + 0.1 * Math.sqrt(T);
      return (IV + skew) * termStructure * 100;
    })
  );

  // Color scale
  const allVals = ivGrid.flat();
  const minIV = Math.min(...allVals);
  const maxIV = Math.max(...allVals);
  const colorForIV = (iv) => {
    const t = (iv - minIV) / (maxIV - minIV);
    if (t < 0.33) return `rgb(${Math.round(99 + t * 3 * 56)},${Math.round(102 + t * 3 * 54)},241)`;
    if (t < 0.66) return `rgb(245,${Math.round(158 - (t - 0.33) * 3 * 158)},11)`;
    return `rgb(239,${Math.round(68 - (t - 0.66) * 3 * 68)},68)`;
  };

  const cellW = 56, cellH = 32;
  const W = strikes.length * cellW + 80;
  const H = expiries.length * cellH + 50;
  const atmIdx = Math.floor(strikes.length / 2);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "16px" }}>
        {[
          { label: "ATM IV (30d)", value: `${ivGrid[2][atmIdx].toFixed(1)}%`, color: "#e2e8f0", sub: "at-the-money" },
          { label: "Skew (OTM-ATM)", value: `${(ivGrid[2][atmIdx - 2] - ivGrid[2][atmIdx]).toFixed(1)}%`, color: "#f59e0b", sub: "put skew indicator" },
          { label: "Term Structure", value: `${(ivGrid[7][atmIdx] - ivGrid[2][atmIdx]).toFixed(1)}%`, color: "#6366f1", sub: "6M minus 1M" },
        ].map(s => (
          <div key={s.label} style={{ background: "#0d0d18", borderRadius: "8px", padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: "9px", color: "#4a5568", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>{s.label}</div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "18px", fontWeight: "700", color: s.color }}>{s.value}</div>
            <div style={{ fontSize: "9px", color: "#4a5568", marginTop: "2px" }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <svg width={W} height={H} style={{ fontFamily: "'DM Mono',monospace" }}>
          {/* Header: strikes */}
          {strikes.map((K, ki) => (
            <g key={K}>
              <text x={80 + ki * cellW + cellW / 2} y={18} fontSize="8" fill={Math.abs(K - S) < S * 0.03 ? "#10b981" : "#4a5568"}
                textAnchor="middle" fontWeight={Math.abs(K - S) < S * 0.03 ? "600" : "400"}>${K}</text>
              {Math.abs(K - S) < S * 0.03 && <text x={80 + ki * cellW + cellW / 2} y={28} fontSize="6" fill="#10b981" textAnchor="middle">ATM</text>}
            </g>
          ))}

          {/* Rows */}
          {expiries.map((T, ti) => (
            <g key={T}>
              <text x={74} y={40 + ti * cellH + cellH / 2 + 4} fontSize="8" fill="#94a3b8" textAnchor="end">{expLabels[ti]}</text>
              {strikes.map((K, ki) => {
                const iv = ivGrid[ti][ki];
                const color = colorForIV(iv);
                const isATM = Math.abs(K - S) < S * 0.03;
                const is30d = ti === 2;
                return (
                  <g key={K}>
                    <rect x={80 + ki * cellW + 1} y={34 + ti * cellH + 1} width={cellW - 2} height={cellH - 2}
                      fill={color} opacity="0.85" rx="3"
                      stroke={isATM && is30d ? "#fff" : "none"} strokeWidth="1.5" />
                    <text x={80 + ki * cellW + cellW / 2} y={34 + ti * cellH + cellH / 2 + 4}
                      fontSize="8" fill="#fff" textAnchor="middle" fontWeight="600">
                      {iv.toFixed(1)}%
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      <div style={{ marginTop: "12px", padding: "10px", background: "#0d0d18", borderRadius: "8px", fontSize: "11px", color: "#4a5568", lineHeight: "1.6" }}>
        <span style={{ color: "#6366f1" }}>■ Low IV</span> &nbsp;
        <span style={{ color: "#f59e0b" }}>■ Mid IV</span> &nbsp;
        <span style={{ color: "#ef4444" }}>■ High IV</span> &nbsp;·&nbsp;
        {optionsChain?.calls?.length > 0
          ? "✅ Partial real market data applied where available. Remaining cells use vol smile approximation."
          : "⚠️ No live options data — surface computed via vol smile approximation (skew + term structure)."}
      </div>
    </div>
  );
}

// ── LIVE OPTIONS CHAIN ────────────────────────────────────────────────────────
function OptionsChainView({ optionsChain, S, COST, T, r, loading, error }) {
  const [tab, setTab] = useState("calls");
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "40px", justifyContent: "center", color: "#4a5568" }}>
      <span style={{ animation: "pulse 1s infinite", fontSize: "20px" }}>◎</span>
      <span>Fetching live options chain from Yahoo Finance...</span>
    </div>
  );
  if (error || !optionsChain) return (
    <div style={{ padding: "24px", background: "#0d0d18", borderRadius: "8px", textAlign: "center" }}>
      <div style={{ fontSize: "24px", marginBottom: "8px" }}>⚠️</div>
      <div style={{ color: "#f59e0b", fontSize: "13px", marginBottom: "4px" }}>Live options chain unavailable</div>
      <div style={{ color: "#4a5568", fontSize: "11px" }}>{error || "Could not fetch data from Yahoo Finance. This ticker may not have listed options, or the market is closed."}</div>
    </div>
  );

  const data = tab === "calls" ? optionsChain.calls : optionsChain.puts;
  const filtered = data.filter(o => o.strike >= S * 0.85 && o.strike <= S * 1.20).slice(0, 15);

  return (
    <div>
      {/* Quote summary */}
      {optionsChain.quote && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px", marginBottom: "16px" }}>
          {[
            { label: "Last Price", value: `$${optionsChain.quote.regularMarketPrice?.toFixed(2) || S}`, color: "#e2e8f0" },
            { label: "Day Change", value: `${optionsChain.quote.regularMarketChangePercent >= 0 ? "+" : ""}${optionsChain.quote.regularMarketChangePercent?.toFixed(2) || "0"}%`, color: optionsChain.quote.regularMarketChangePercent >= 0 ? "#10b981" : "#ef4444" },
            { label: "Volume", value: optionsChain.quote.regularMarketVolume?.toLocaleString() || "N/A", color: "#94a3b8" },
            { label: "Data Source", value: "Yahoo Finance", color: "#6366f1" },
          ].map(s => (
            <div key={s.label} style={{ background: "#0d0d18", borderRadius: "8px", padding: "12px" }}>
              <div style={{ fontSize: "9px", color: "#4a5568", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "4px" }}>{s.label}</div>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "15px", fontWeight: "700", color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Calls/Puts toggle */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "12px", background: "#0d0d18", borderRadius: "6px", padding: "3px", width: "200px" }}>
        {["calls", "puts"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "6px", border: "none", borderRadius: "4px", cursor: "pointer",
            fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase",
            fontFamily: "'DM Mono',monospace", fontWeight: "600",
            background: tab === t ? "#6366f1" : "transparent",
            color: tab === t ? "#fff" : "#4a5568",
          }}>{t}</button>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
          <thead>
            <tr style={{ color: "#4a5568", borderBottom: "1px solid #1e1e2e" }}>
              {["Strike", "Last", "Bid", "Ask", "IV", "Volume", "OI", "Delta (BS)", "vs Cost", ""].map(h => (
                <th key={h} style={{ padding: "8px 10px", textAlign: "right", fontWeight: "400", fontSize: "9px", letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(opt => {
              const bsGreeks = blackScholes(S, opt.strike, T, r, opt.impliedVolatility || 0.3);
              const isATM = Math.abs(opt.strike - S) < S * 0.03;
              const isITM = tab === "calls" ? opt.strike < S : opt.strike > S;
              return (
                <tr key={opt.contractSymbol} style={{
                  borderBottom: "1px solid #0d0d18",
                  background: isATM ? "#6366f110" : isITM ? "#10b98108" : "transparent",
                  color: isATM ? "#e2e8f0" : "#94a3b8",
                }}>
                  <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: "'Space Grotesk',sans-serif", fontWeight: isATM ? "600" : "400", color: isATM ? "#6366f1" : "inherit" }}>
                    ${opt.strike}{isATM && " ★"}
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>${opt.lastPrice?.toFixed(2) || "—"}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: "#ef4444" }}>${opt.bid?.toFixed(2) || "—"}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: "#10b981" }}>${opt.ask?.toFixed(2) || "—"}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: "#f59e0b" }}>{opt.impliedVolatility ? (opt.impliedVolatility * 100).toFixed(1) + "%" : "—"}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{opt.volume?.toLocaleString() || "—"}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{opt.openInterest?.toLocaleString() || "—"}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: "#6366f1" }}>{bsGreeks.delta.toFixed(3)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: opt.strike >= COST ? "#10b981" : "#ef4444" }}>
                    {opt.strike >= COST ? "Above ✓" : `-$${(COST - opt.strike).toFixed(0)}`}
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>
                    {bsGreeks.delta < 0.25 && bsGreeks.delta > 0.15 && tab === "calls" && (
                      <span style={{ background: "#10b98115", color: "#10b981", border: "1px solid #10b98130", display: "inline-block", padding: "1px 8px", borderRadius: "99px", fontSize: "9px", letterSpacing: "0.08em" }}>~0.20Δ</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: "8px", fontSize: "10px", color: "#4a5568" }}>
        ⏱ Data may be delayed 15 minutes · Source: Yahoo Finance · Showing strikes ${(S * 0.85).toFixed(0)}–${(S * 1.20).toFixed(0)}
      </div>
    </div>
  );
}

// ── MAIN DASHBOARD ────────────────────────────────────────────────────────────
export default function CoveredCallDashboard() {
  const [form, setForm] = useState({ ticker: "UAL", currentPrice: "167.76", costBasis: "197", shares: "100", strike: "175", premium: "2.50", dte: "30", iv: "" });
  const [submitted, setSubmitted] = useState(false);
  const [params, setParams] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [priceSource, setPriceSource] = useState("simulated");
  const [optionsChain, setOptionsChain] = useState(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async () => {
    const S = parseFloat(form.currentPrice), K = parseFloat(form.strike), COST = parseFloat(form.costBasis);
    const SHARES = parseInt(form.shares), PREM = parseFloat(form.premium), DTE = parseInt(form.dte);
    if (!S || !K || !COST || !SHARES || !PREM || !DTE) return;
    setLoading(true);

    let dailyPrices, source = "simulated";
    try {
      dailyPrices = await fetchYahooPrices(form.ticker.toUpperCase());
      dailyPrices[dailyPrices.length - 1] = S;
      source = "live";
    } catch {
      dailyPrices = generateFallbackPrices(S);
    }

    const IV = form.iv ? parseFloat(form.iv) / 100 : historicalVol(dailyPrices) * 1.15;
    const p = { TICKER: form.ticker.toUpperCase() || "CUSTOM", S, K, COST, SHARES, PREM, DTE, IV, dailyPrices };
    setParams(p);
    setPriceSource(source);
    setSubmitted(true);
    setAiAnalysis("");
    setLoading(false);

    // Fetch options chain
    setOptionsLoading(true);
    setOptionsError(null);
    try {
      const chain = await fetchOptionsChain(form.ticker.toUpperCase());
      setOptionsChain(chain);
    } catch (e) {
      setOptionsError(e.message);
    }
    setOptionsLoading(false);
  };

  const handleReset = () => {
    setSubmitted(false); setParams(null); setAiAnalysis("");
    setPriceSource("simulated"); setOptionsChain(null); setActiveTab("overview");
  };

  const fetchAI = useCallback(async () => {
    if (!params) return;
    const { TICKER, S, K, COST, SHARES, PREM, DTE, IV } = params;
    const T = DTE / 365, r = 0.053;
    const bs = blackScholes(S, K, T, r, IV);
    const fairValue = bs.call, priceDiff = PREM - fairValue;
    const annYield = (PREM / S) * (365 / DTE) * 100;
    const totalPnL = (K - COST + PREM) * SHARES;
    const dailyRSI = calcRSI(params.dailyPrices);
    const arima = arimaScore(params.dailyPrices);
    const mc = runMonteCarlo(S, K, T, IV, r, 1000);
    setAiLoading(true); setAiAnalysis("");
    const prompt = `You are a professional options strategist. Analyze this covered call:

POSITION: ${TICKER} | ${SHARES} shares | Cost $${COST} | Current $${S} | P&L: $${((S - COST) * SHARES).toFixed(0)}
OPTION: Strike $${K} | Premium $${PREM} | DTE ${DTE} | IV ${(IV * 100).toFixed(1)}%
BS FAIR VALUE: $${fairValue.toFixed(2)} | Market ${priceDiff >= 0 ? "overpriced" : "underpriced"} by $${Math.abs(priceDiff).toFixed(2)}
GREEKS: Delta ${bs.delta.toFixed(3)} | Theta $${Math.abs(bs.theta).toFixed(3)}/day | Vega $${bs.vega.toFixed(3)}
ANNUALIZED YIELD: ${annYield.toFixed(1)}%
MONTE CARLO (1000 paths): P(assignment) ${(mc.probAboveStrike * 100).toFixed(1)}% | MC price $${mc.mcCallPrice.toFixed(2)} | Expected P&L $${((K - COST + PREM) * SHARES).toFixed(0)}
RSI: Daily ${dailyRSI?.toFixed(1)} | 5d momentum ${arima.momentum5.toFixed(2)}% | AR(1) ${arima.ar1.toFixed(3)}

Respond in exactly 4 sections:
1. TIMING VERDICT (2 sentences max)
2. KEY RISKS (3 bullet points)
3. ALTERNATIVE STRATEGY (specific strike/DTE suggestion)
4. BOTTOM LINE (one sentence, bold call)

Be direct and specific. Use the Monte Carlo probability in your analysis.`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 800, messages: [{ role: "user", content: prompt }] })
      });
      const data = await res.json();
      setAiAnalysis(data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "Analysis unavailable.");
    } catch { setAiAnalysis("Unable to fetch AI analysis."); }
    setAiLoading(false);
  }, [params]);

  useEffect(() => { if (submitted && params) fetchAI(); }, [submitted, params]);

  // ── FORM ────────────────────────────────────────────────────────────────────
  if (!submitted) {
    return (
      <div style={{ fontFamily: "'DM Mono','Courier New',monospace", background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0", padding: "24px", maxWidth: "640px", margin: "0 auto" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap'); input:focus{border-color:#6366f1!important;} @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}`}</style>
        <div style={{ marginBottom: "32px" }}>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "26px", fontWeight: "700", letterSpacing: "-0.02em", marginBottom: "4px" }}>
            Covered Call Analyzer <span style={{ color: "#6366f1" }}>Pro</span>
          </div>
          <div style={{ fontSize: "11px", color: "#4a5568", letterSpacing: "0.1em" }}>BLACK-SCHOLES · MONTE CARLO · VOL SURFACE · LIVE OPTIONS CHAIN</div>
        </div>
        <div style={{ background: "#13131f", border: "1px solid #1e1e2e", borderRadius: "12px", padding: "24px", marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#4a5568", marginBottom: "16px", borderBottom: "1px solid #1e1e2e", paddingBottom: "8px" }}>Position</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <div><label style={labelStyle}>Ticker</label><input style={inputStyle} name="ticker" value={form.ticker} onChange={handleChange} placeholder="UAL" /></div>
            <div><label style={labelStyle}>Shares</label><input style={inputStyle} name="shares" value={form.shares} onChange={handleChange} placeholder="100" /></div>
            <div><label style={labelStyle}>Current Price ($)</label><input style={inputStyle} name="currentPrice" value={form.currentPrice} onChange={handleChange} placeholder="167.76" /></div>
            <div><label style={labelStyle}>Cost Basis ($)</label><input style={inputStyle} name="costBasis" value={form.costBasis} onChange={handleChange} placeholder="197.00" /></div>
          </div>
        </div>
        <div style={{ background: "#13131f", border: "1px solid #1e1e2e", borderRadius: "12px", padding: "24px", marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#4a5568", marginBottom: "16px", borderBottom: "1px solid #1e1e2e", paddingBottom: "8px" }}>Option Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <div><label style={labelStyle}>Strike Price ($)</label><input style={inputStyle} name="strike" value={form.strike} onChange={handleChange} placeholder="175" /></div>
            <div><label style={labelStyle}>Market Premium ($/share)</label><input style={inputStyle} name="premium" value={form.premium} onChange={handleChange} placeholder="2.50" /></div>
            <div><label style={labelStyle}>Days to Expiration</label><input style={inputStyle} name="dte" value={form.dte} onChange={handleChange} placeholder="30" /></div>
            <div><label style={labelStyle}>IV % (optional)</label><input style={inputStyle} name="iv" value={form.iv} onChange={handleChange} placeholder="Auto-calculate" /></div>
          </div>
        </div>
        <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", padding: "14px", background: loading ? "#2d2d40" : "#6366f1", border: "none", borderRadius: "8px", color: "#fff", fontSize: "13px", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace" }}>
          {loading ? "⏳ Fetching data..." : "Analyze Position →"}
        </button>
      </div>
    );
  }

  // ── DASHBOARD ───────────────────────────────────────────────────────────────
  const { TICKER, S, K, COST, SHARES, PREM, DTE, IV, dailyPrices } = params;
  const T = DTE / 365, RISK_FREE = 0.053;
  const bs = blackScholes(S, K, T, RISK_FREE, IV);
  const fairValue = bs.call, priceDiff = PREM - fairValue, priceDiffPct = (priceDiff / fairValue) * 100;
  const impliedIV = impliedVol(S, K, T, RISK_FREE, PREM) * 100;
  const annualizedYield = (PREM / S) * (365 / DTE) * 100;
  const fairValueYield = (fairValue / S) * (365 / DTE) * 100;
  const gainLossPerShare = K - COST;
  const totalPnL = (gainLossPerShare + PREM) * SHARES;
  const totalPnLPct = ((K + PREM - COST) / COST) * 100;
  const breakeven = COST - PREM;
  const weeklyPrices = generateWeeklyPrices(dailyPrices);
  const dailyRSI = calcRSI(dailyPrices);
  const weeklyRSI = calcRSI(weeklyPrices);
  const arima = arimaScore(dailyPrices);
  const strikes = buildStrikes(S);
  const isOverpriced = priceDiff > 0;
  const isSignificant = Math.abs(priceDiffPct) > 10;

  const resistanceLevels = [
    { price: parseFloat((S * 1.025).toFixed(2)), label: "R1 – Near-term", strength: "Moderate" },
    { price: parseFloat((S * 1.05).toFixed(2)), label: "R2 – Mid", strength: "Strong" },
    { price: parseFloat((S * 1.10).toFixed(2)), label: "R3 – Upper", strength: "Strong" },
    { price: parseFloat((S * 1.15).toFixed(2)), label: "R4 – Key", strength: "Key" },
    { price: COST, label: "Cost Basis", strength: "Target" },
  ].sort((a, b) => a.price - b.price);

  const isOverbought = dailyRSI > 65;
  const isTrendingStrong = arima.momentum5 > 3 || arima.ar1 > 0.15;
  const strikeAboveCostBasis = K > COST;
  const nearResistance = resistanceLevels.some(r => Math.abs(r.price - K) < S * 0.03);

  let recommendation, recColor, recIcon;
  if (!isOverbought && isTrendingStrong && !strikeAboveCostBasis) {
    recommendation = "WAIT — Trending strongly, strike below cost basis. Don't cap upside.";
    recColor = "#f59e0b"; recIcon = "⏳";
  } else if (isOverbought && nearResistance && strikeAboveCostBasis) {
    recommendation = "FAVORABLE — RSI elevated, strike at resistance, above cost basis.";
    recColor = "#10b981"; recIcon = "✅";
  } else if (!strikeAboveCostBasis) {
    recommendation = "WAIT — Strike below cost basis. Selling here locks in a loss.";
    recColor = "#ef4444"; recIcon = "🚫";
  } else {
    recommendation = "NEUTRAL — Mixed conditions. Review all tabs before acting.";
    recColor = "#8b5cf6"; recIcon = "⚖️";
  }

  // Sparkline
  const sparkW = 400, sparkH = 70;
  const minP = Math.min(...dailyPrices), maxP = Math.max(...dailyPrices);
  const px = (p) => Math.max(2, Math.min(sparkH - 2, sparkH - ((p - minP) / (maxP - minP || 1)) * sparkH));
  const sparkPathStr = dailyPrices.map((p, i) => `${i === 0 ? "M" : "L"}${(i / (dailyPrices.length - 1)) * sparkW},${px(p)}`).join("");
  const rsiColor = (r) => r > 70 ? "#ef4444" : r > 60 ? "#f59e0b" : r < 40 ? "#06b6d4" : "#10b981";

  const fvVerdict = isOverpriced
    ? isSignificant ? { label: "Overpriced", color: "#10b981", icon: "🟢", detail: `$${priceDiff.toFixed(2)} (${priceDiffPct.toFixed(1)}%) above fair value. Strong edge.` }
      : { label: "Slightly Over", color: "#86efac", icon: "🟡", detail: `$${priceDiff.toFixed(2)} above fair value. Modest edge.` }
    : isSignificant ? { label: "Underpriced", color: "#ef4444", icon: "🔴", detail: `$${Math.abs(priceDiff).toFixed(2)} below fair value. Consider waiting.` }
      : { label: "Fair Value", color: "#94a3b8", icon: "⚪", detail: `Within $${Math.abs(priceDiff).toFixed(2)} of fair value.` };

  const greeks = [
    { name: "Δ Delta", value: bs.delta.toFixed(3), color: "#6366f1", desc: `~${(bs.delta * 100).toFixed(0)}% chance of expiring ITM. For every $1 stock move, option gains $${bs.delta.toFixed(2)}. Lower delta = lower assignment risk.` },
    { name: "Γ Gamma", value: bs.gamma.toFixed(4), color: "#8b5cf6", desc: `Delta shifts by ${bs.gamma.toFixed(4)} per $1 stock move. High near expiration — assignment risk can flip rapidly.` },
    { name: "Θ Theta", value: `$${Math.abs(bs.theta).toFixed(3)}`, color: "#10b981", desc: `Earn $${Math.abs(bs.theta).toFixed(3)}/share/day from decay alone. ~$${(Math.abs(bs.theta) * DTE).toFixed(2)}/share over ${DTE} days. Time works for you as seller.` },
    { name: "V Vega", value: `$${bs.vega.toFixed(3)}`, color: "#f59e0b", desc: `Premium changes $${bs.vega.toFixed(3)}/share per 1% IV move. Rising IV after selling = more expensive buyback.` },
  ];

  const tabs = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "payoff", label: "Payoff", icon: "📈" },
    { id: "montecarlo", label: "Monte Carlo", icon: "🎲" },
    { id: "volsurface", label: "Vol Surface", icon: "🌊" },
    { id: "chain", label: "Options Chain", icon: "🔗" },
    { id: "ai", label: "AI Analysis", icon: "🤖" },
  ];

  return (
    <div style={{ fontFamily: "'DM Mono','Courier New',monospace", background: "#0a0a0f", minHeight: "100vh", color: "#e2e8f0", padding: "20px", maxWidth: "1000px", margin: "0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap');
        .card{background:#13131f;border:1px solid #1e1e2e;border-radius:12px;padding:20px;}
        .card-dark{background:#0d0d18;border:1px solid #1a1a2e;border-radius:12px;padding:20px;}
        .label{font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#4a5568;margin-bottom:4px;}
        .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;}
        .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .section-title{font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#4a5568;margin-bottom:12px;border-bottom:1px solid #1e1e2e;padding-bottom:8px;}
        .greek{background:#0d0d18;border:1px solid #1a1a2e;border-radius:8px;padding:14px;}
        .rsi-bar{height:6px;background:#1e1e2e;border-radius:3px;overflow:hidden;margin-top:6px;}
        .rsi-fill{height:100%;border-radius:3px;}
        .ai-text{font-size:13px;line-height:1.8;color:#94a3b8;white-space:pre-wrap;}
        .pulse{animation:pulse 2s infinite;}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
        .resist-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1a1a2e;}
        .resist-row:last-child{border:none;}
        .progress-track{background:#1e1e2e;border-radius:3px;height:3px;flex:1;margin:0 10px;}
        .tick{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
        input:focus{border-color:#6366f1!important;}
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "26px", fontWeight: "700" }}>{TICKER}</span>
            <span className="badge" style={{ background: "#1a1a2e", color: "#64748b", border: "1px solid #2d2d40" }}>COVERED CALL PRO</span>
            <span className="badge" style={{ background: priceSource === "live" ? "#10b98120" : "#f59e0b20", color: priceSource === "live" ? "#10b981" : "#f59e0b", border: `1px solid ${priceSource === "live" ? "#10b98140" : "#f59e0b40"}` }}>
              {priceSource === "live" ? "● Live" : "◌ Sim"}
            </span>
          </div>
          <div style={{ fontSize: "11px", color: "#4a5568", marginTop: "3px" }}>{SHARES} shares · Strike ${K} · Premium ${PREM} · DTE {DTE}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ textAlign: "right" }}>
            <div className="label">CURRENT</div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "26px", fontWeight: "700" }}>${S}</div>
            <div style={{ fontSize: "11px", color: S >= COST ? "#10b981" : "#ef4444" }}>{S >= COST ? `↑ $${(S - COST).toFixed(2)} above` : `↓ $${(COST - S).toFixed(2)} below`} cost</div>
          </div>
          <button onClick={handleReset} style={{ background: "#1e1e2e", border: "1px solid #2d2d40", borderRadius: "6px", color: "#94a3b8", fontSize: "10px", padding: "6px 14px", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>← New</button>
        </div>
      </div>

      {/* Recommendation */}
      <div style={{ background: `${recColor}15`, border: `1px solid ${recColor}40`, borderRadius: "10px", padding: "14px 18px", marginBottom: "16px", display: "flex", gap: "12px", alignItems: "center" }}>
        <span style={{ fontSize: "20px" }}>{recIcon}</span>
        <div>
          <div style={{ fontSize: "9px", letterSpacing: "0.15em", textTransform: "uppercase", color: recColor, marginBottom: "3px", fontWeight: "600" }}>System Recommendation</div>
          <div style={{ fontSize: "13px", color: "#e2e8f0" }}>{recommendation}</div>
        </div>
      </div>

      {/* Tab navigation */}
      <Tab tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" && (
        <div>
          {/* Fair Value */}
          <div className="card" style={{ marginBottom: "14px" }}>
            <div className="section-title">Option Fair Value · Black-Scholes</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px", marginBottom: "14px" }}>
              {[
                { label: "BS Fair Value", value: `$${fairValue.toFixed(2)}`, color: "#6366f1", sub: "model price" },
                { label: "Market Premium", value: `$${PREM.toFixed(2)}`, color: "#e2e8f0", sub: "you collect" },
                { label: "Difference", value: `${priceDiff >= 0 ? "+" : ""}$${priceDiff.toFixed(2)}`, color: priceDiff >= 0 ? "#10b981" : "#ef4444", sub: `${Math.abs(priceDiffPct).toFixed(1)}% ${priceDiff >= 0 ? "over" : "under"}` },
                { label: "Implied IV", value: `${impliedIV.toFixed(1)}%`, color: "#f59e0b", sub: `model: ${(IV * 100).toFixed(1)}%` },
              ].map(item => (
                <div key={item.label} style={{ background: "#0d0d18", borderRadius: "8px", padding: "12px" }}>
                  <div className="label">{item.label}</div>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "20px", fontWeight: "700", color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: "9px", color: "#4a5568", marginTop: "2px" }}>{item.sub}</div>
                </div>
              ))}
            </div>
            <div style={{ background: "#0d0d18", borderRadius: "8px", padding: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "11px", color: "#4a5568" }}>{fvVerdict.detail}</div>
              <span className="badge" style={{ background: `${fvVerdict.color}20`, color: fvVerdict.color, border: `1px solid ${fvVerdict.color}40`, flexShrink: 0, marginLeft: "12px" }}>{fvVerdict.icon} {fvVerdict.label}</span>
            </div>
          </div>

          {/* Chart + Position */}
          <div className="grid2" style={{ marginBottom: "14px" }}>
            <div className="card">
              <div className="section-title">Price History (90d) · {TICKER}</div>
              <svg width="100%" viewBox={`0 0 ${sparkW} ${sparkH + 10}`} style={{ overflow: "visible" }}>
                <defs>
                  <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={sparkPathStr + `L${sparkW},${sparkH} L0,${sparkH}Z`} fill="url(#aGrad)" />
                <path d={sparkPathStr} fill="none" stroke="#6366f1" strokeWidth="1.5" />
                <line x1="0" y1={px(COST)} x2={sparkW} y2={px(COST)} stroke="#ef4444" strokeWidth="1" strokeDasharray="4,3" opacity="0.7" />
                <text x={sparkW - 2} y={Math.max(8, px(COST) - 3)} fontSize="7" fill="#ef4444" textAnchor="end">Cost ${COST}</text>
                <line x1="0" y1={px(K)} x2={sparkW} y2={px(K)} stroke="#10b981" strokeWidth="1" strokeDasharray="4,3" opacity="0.7" />
                <text x={sparkW - 2} y={Math.max(8, px(K) - 3)} fontSize="7" fill="#10b981" textAnchor="end">Strike ${K}</text>
                <circle cx={sparkW} cy={px(S)} r="4" fill="#6366f1" />
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", padding: "6px", background: "#0d0d18", borderRadius: "6px" }}>
                {[{ l: "Low", v: `$${minP.toFixed(0)}`, c: "#ef4444" }, { l: "High", v: `$${maxP.toFixed(0)}`, c: "#10b981" }, { l: "Range", v: `$${(maxP - minP).toFixed(0)}`, c: "#94a3b8" }].map(s => (
                  <div key={s.l} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "9px", color: "#4a5568", textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.l}</div>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "13px", fontWeight: "600", color: s.c }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="section-title">Position Summary</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {[
                  { label: "Cost Basis", value: `$${COST}`, color: "#94a3b8" },
                  { label: "Breakeven", value: `$${breakeven.toFixed(2)}`, color: "#f59e0b" },
                  { label: "Unrealized P&L", value: `${S >= COST ? "+" : "-"}$${Math.abs((S - COST) * SHARES).toFixed(0)}`, color: S >= COST ? "#10b981" : "#ef4444" },
                  { label: "Ann. Yield", value: `${annualizedYield.toFixed(1)}%`, color: "#10b981" },
                ].map(item => (
                  <div key={item.label} style={{ background: "#0d0d18", borderRadius: "8px", padding: "10px" }}>
                    <div className="label">{item.label}</div>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "16px", fontWeight: "600", color: item.color }}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "10px", background: "#0d0d18", borderRadius: "8px", padding: "12px", borderLeft: "3px solid #6366f1" }}>
                <div className="label">If Called Away at ${K}</div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "15px", fontWeight: "600", color: totalPnL >= 0 ? "#10b981" : "#ef4444" }}>
                  {totalPnL >= 0 ? "+" : " "}${totalPnL.toFixed(0)} ({totalPnLPct.toFixed(1)}%)
                </div>
                <div style={{ fontSize: "10px", color: "#4a5568", marginTop: "2px" }}>
                  Stock {gainLossPerShare >= 0 ? "gain" : "loss"} ${Math.abs(gainLossPerShare * SHARES).toFixed(0)} + premium ${(PREM * SHARES).toFixed(0)}
                </div>
              </div>
            </div>
          </div>

          {/* RSI + Greeks */}
          <div className="grid2" style={{ marginBottom: "14px" }}>
            <div className="card">
              <div className="section-title">RSI Analysis</div>
              {[{ label: "Daily RSI (14)", value: dailyRSI, tf: "Daily" }, { label: "Weekly RSI (14)", value: weeklyRSI, tf: "Weekly" }].map(r => (
                <div key={r.tf} style={{ marginBottom: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ fontSize: "12px", color: "#94a3b8" }}>{r.label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "20px", fontWeight: "600", color: rsiColor(r.value) }}>{r.value?.toFixed(1)}</span>
                      <span className="badge" style={{ background: r.value > 70 ? "#ef444420" : r.value > 60 ? "#f59e0b20" : r.value < 40 ? "#06b6d420" : "#10b98120", color: rsiColor(r.value), border: `1px solid ${rsiColor(r.value)}40` }}>
                        {r.value > 70 ? "Overbought" : r.value > 60 ? "Elevated" : r.value < 40 ? "Oversold" : "Neutral"}
                      </span>
                    </div>
                  </div>
                  <div className="rsi-bar"><div className="rsi-fill" style={{ width: `${r.value}%`, background: rsiColor(r.value) }} /></div>
                </div>
              ))}
              <div style={{ background: "#0d0d18", borderRadius: "8px", padding: "10px" }}>
                <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                  {dailyRSI > 70 ? "⚠️ Overbought — good time to sell calls" : dailyRSI > 60 ? "📊 Elevated — approaching overbought" : dailyRSI < 40 ? "📉 Oversold — avoid selling" : "😐 Neutral RSI"}
                </div>
              </div>
            </div>
            <div className="card">
              <div className="section-title">Greeks · ${K} Strike</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
                {greeks.map(g => (
                  <div key={g.name} className="greek">
                    <div style={{ fontSize: "10px", color: g.color, fontWeight: "600", marginBottom: "2px" }}>{g.name}</div>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "18px", fontWeight: "700", marginBottom: "6px" }}>{g.value}</div>
                    <div style={{ fontSize: "9px", color: "#4a5568", lineHeight: "1.5" }}>{g.desc}</div>
                  </div>
                ))}
              </div>
              <div style={{ background: "#0d0d18", borderRadius: "8px", padding: "10px", display: "flex", justifyContent: "space-between" }}>
                <div><div className="label">Premium</div><div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "18px", fontWeight: "700", color: "#10b981" }}>${PREM}/share</div></div>
                <div style={{ textAlign: "right" }}><div className="label">Total</div><div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "18px", fontWeight: "700", color: "#10b981" }}>${(PREM * SHARES).toFixed(0)}</div></div>
              </div>
            </div>
          </div>

          {/* Strike Ladder */}
          <div className="card">
            <div className="section-title">Strike Ladder · {DTE} DTE · {(IV * 100).toFixed(1)}% IV</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                <thead>
                  <tr style={{ color: "#4a5568", borderBottom: "1px solid #1e1e2e" }}>
                    {["Strike", "Delta", "BS FV", "Mkt vs FV", "Ann Yield", "vs Cost", ""].map(h => (
                      <th key={h} style={{ padding: "7px 10px", textAlign: "right", fontWeight: "400", fontSize: "9px", letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {strikes.filter(k => k >= S * 0.95 && k <= S * 1.25).map(k => {
                    const b = blackScholes(S, k, T, RISK_FREE, IV);
                    const annYld = (b.call / S) * (365 / DTE) * 100;
                    const isSel = k === K;
                    const md = isSel ? PREM - b.call : null;
                    return (
                      <tr key={k} style={{ borderBottom: "1px solid #0d0d18", background: isSel ? "#6366f115" : "transparent", color: isSel ? "#e2e8f0" : "#94a3b8" }}>
                        <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "'Space Grotesk',sans-serif", fontWeight: isSel ? "600" : "400", color: isSel ? "#6366f1" : "inherit" }}>${k}{isSel && " ★"}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right" }}>{b.delta.toFixed(3)}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: "#6366f1" }}>${b.call.toFixed(2)}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: md != null ? (md >= 0 ? "#10b981" : "#ef4444") : "#4a5568" }}>{md != null ? (md >= 0 ? `+$${md.toFixed(2)}` : `-$${Math.abs(md).toFixed(2)}`) : "—"}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: annYld > 15 ? "#10b981" : annYld > 8 ? "#f59e0b" : "#94a3b8" }}>{annYld.toFixed(1)}%</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: k >= COST ? "#10b981" : "#ef4444" }}>{k >= COST ? "✓ Above" : `-$${(COST - k).toFixed(0)}`}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right" }}>{b.delta < 0.25 && b.delta > 0.15 && <span className="badge" style={{ background: "#10b98115", color: "#10b981", border: "1px solid #10b98130", fontSize: "9px" }}>~0.20Δ</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── PAYOFF TAB ── */}
      {activeTab === "payoff" && (
        <div className="card">
          <div className="section-title">Payoff Diagram at Expiration</div>
          <PayoffDiagram S={S} K={K} COST={COST} PREM={PREM} SHARES={SHARES} />
        </div>
      )}

      {/* ── MONTE CARLO TAB ── */}
      {activeTab === "montecarlo" && (
        <div className="card">
          <div className="section-title">Monte Carlo Simulation · 3,000 Paths · {DTE} DTE</div>
          <MonteCarloView S={S} K={K} T={T} IV={IV} r={RISK_FREE} PREM={PREM} SHARES={SHARES} COST={COST} />
        </div>
      )}

      {/* ── VOL SURFACE TAB ── */}
      {activeTab === "volsurface" && (
        <div className="card">
          <div className="section-title">Implied Volatility Surface · Strike × Expiration</div>
          <VolSurface S={S} IV={IV} r={RISK_FREE} optionsChain={optionsChain} />
        </div>
      )}

      {/* ── OPTIONS CHAIN TAB ── */}
      {activeTab === "chain" && (
        <div className="card">
          <div className="section-title">Live Options Chain · {TICKER} · Yahoo Finance</div>
          <OptionsChainView optionsChain={optionsChain} S={S} COST={COST} T={T} r={RISK_FREE} loading={optionsLoading} error={optionsError} />
        </div>
      )}

      {/* ── AI TAB ── */}
      {activeTab === "ai" && (
        <div className="card-dark">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <div className="section-title" style={{ marginBottom: 0 }}>AI Options Strategist · Monte Carlo Informed</div>
            <button onClick={fetchAI} style={{ background: "#1e1e2e", border: "1px solid #2d2d40", borderRadius: "6px", color: "#94a3b8", fontSize: "10px", padding: "5px 14px", cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}>↺ Refresh</button>
          </div>
          {aiLoading
            ? <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#4a5568", padding: "20px 0" }}>
              <span className="pulse">●</span>
              <span style={{ fontSize: "12px" }}>Running Monte Carlo + Black-Scholes analysis...</span>
            </div>
            : <div className="ai-text">{aiAnalysis || "Click Refresh to generate analysis."}</div>
          }
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: "20px", fontSize: "9px", color: "#2d3748", letterSpacing: "0.1em" }}>
        {TICKER} · BLACK-SCHOLES · MONTE CARLO (3K PATHS) · VOL SURFACE · {priceSource === "live" ? "LIVE DATA" : "SIM DATA"} · {new Date().toLocaleDateString()}
      </div>
    </div>
  );
}
