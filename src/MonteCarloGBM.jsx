// MonteCarloGBM.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Implements Kyle's (Carnegie Mellon) GBM + Monte Carlo + Portfolio simulation
// exactly as documented in README.md / GBM_Code.py / Monte_Carlo_GBM.py /
// portfolio_montecarlo_gbm.py
//
// Core GBM equation (from README):
//   S[t] = S[t-1] * exp( (μ − σ²/2)*dt + σ*√dt*Z[t] )
//
// Portfolio (correlated):
//   cov_matrix = outer(σ,σ) * corr_matrix
//   L = cholesky(cov_matrix)
//   correlated_Z = Z @ L.T
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useCallback } from "react";

// ── Box-Muller normal random number ──────────────────────────────────────────
function randn() {
  let u=0,v=0;
  while(!u)u=Math.random();
  while(!v)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}

// ── Cholesky decomposition: returns lower-triangular L so A = L·Lᵀ ──────────
// Exact Python equivalent: L = np.linalg.cholesky(cov_matrix)
function cholesky(A, n) {
  const L = Array.from({length:n}, ()=>new Array(n).fill(0));
  for (let i=0;i<n;i++) {
    for (let j=0;j<=i;j++) {
      let s=0;
      for (let k=0;k<j;k++) s+=L[i][k]*L[j][k];
      L[i][j] = i===j ? Math.sqrt(Math.max(0,A[i][i]-s)) : (A[i][j]-s)/L[j][j];
    }
  }
  return L;
}

// ── SINGLE ASSET GBM Monte Carlo ──────────────────────────────────────────────
// Replicates Monte_Carlo_GBM.py exactly
// price_paths[:,t] = price_paths[:,t-1]*exp((μ-σ²/2)*dt + σ*√dt*Z[:,t-1])
function runSingleMC({ S0, mu, sigma, T, M }) {
  const N   = Math.round(252 * T);   // trading days
  const dt  = T / N;
  const drift  = (mu - 0.5*sigma*sigma)*dt;
  const diffuse = sigma*Math.sqrt(dt);

  const finals      = new Array(M);
  const samplePaths = [];   // first 300 paths for visualization
  const SHOW = Math.min(300, M);

  for (let m=0;m<M;m++) {
    let S = S0;
    const store = m < SHOW;
    const path  = store ? [S0] : null;
    for (let t=0;t<N;t++) {
      S = S * Math.exp(drift + diffuse*randn());
      if (store) path.push(S);
    }
    if (store) samplePaths.push(path);
    finals[m] = S;
  }

  // Sort for percentile calculations (Kyle: np.percentile)
  const sorted = [...finals].sort((a,b)=>a-b);
  const mean   = finals.reduce((s,v)=>s+v,0)/M;
  const var5   = sorted[Math.floor(M*0.05)];   // 5% VaR
  const probLoss = finals.filter(v=>v<S0).length/M;  // P(S_T < S0)

  return {
    samplePaths, finals: sorted,
    mean, var5, probLoss, S0,
    p5:sorted[Math.floor(M*0.05)],
    p25:sorted[Math.floor(M*0.25)],
    p50:sorted[Math.floor(M*0.50)],
    p75:sorted[Math.floor(M*0.75)],
    p95:sorted[Math.floor(M*0.95)],
    N, T,
  };
}

// ── PORTFOLIO GBM Monte Carlo with Cholesky correlation ──────────────────────
// Replicates portfolio_montecarlo_gbm.py exactly:
//   cov_matrix = np.outer(sigma, sigma) * corr_matrix
//   L = np.linalg.cholesky(cov_matrix)
//   correlated_Z = Z @ L.T
//   price_paths[m,t,:] = price_paths[m,t-1,:] * exp((μ-σ²/2)*dt + √dt*corr_Z)
function runPortfolioMC({ assets, weights, T, M, initialValue }) {
  const n   = assets.length;
  const N   = Math.round(252 * T);
  const dt  = T / N;
  const mu  = assets.map(a=>a.mu);
  const sig = assets.map(a=>a.sigma);

  // cov_matrix = np.outer(sigma, sigma) * corr_matrix
  const cov = Array.from({length:n},(_,i)=>
    Array.from({length:n},(_,j)=> sig[i]*sig[j]*assets[i].corr[j])
  );
  const L = cholesky(cov, n);

  // Normalise weights (sum to 1)
  const wSum = weights.reduce((s,v)=>s+v,0);
  const w    = weights.map(v=>v/wSum);

  const finals      = new Array(M);
  const samplePaths = [];
  const SHOW = Math.min(300, M);

  for (let m=0;m<M;m++) {
    // prices normalised to 1 at t=0 (we scale by initialValue at the end)
    const prices = new Array(n).fill(1.0);
    const store  = m < SHOW;
    const path   = store ? [initialValue] : null;

    for (let t=0;t<N;t++) {
      // Generate Z (n standard normals) then correlated_Z = Z @ L.T
      const Z = Array.from({length:n},()=>randn());
      const cZ = new Array(n).fill(0);
      for (let i=0;i<n;i++)
        for (let j=0;j<=i;j++) cZ[i]+=L[i][j]*Z[j];

      for (let i=0;i<n;i++)
        prices[i] = prices[i]*Math.exp((mu[i]-0.5*sig[i]*sig[i])*dt + Math.sqrt(dt)*cZ[i]);

      if (store) {
        let pv=0;
        for (let i=0;i<n;i++) pv+=w[i]*prices[i];
        path.push(pv*initialValue);
      }
    }

    let finalPV=0;
    for (let i=0;i<n;i++) finalPV+=w[i]*prices[i];
    finals[m] = finalPV*initialValue;
    if (store) samplePaths.push(path);
  }

  const sorted   = [...finals].sort((a,b)=>a-b);
  const mean     = finals.reduce((s,v)=>s+v,0)/M;
  const var5     = sorted[Math.floor(M*0.05)];
  const probLoss = finals.filter(v=>v<initialValue).length/M;

  return {
    samplePaths, finals: sorted,
    mean, var5, probLoss,
    p5:sorted[Math.floor(M*0.05)],
    p25:sorted[Math.floor(M*0.25)],
    p50:sorted[Math.floor(M*0.50)],
    p75:sorted[Math.floor(M*0.75)],
    p95:sorted[Math.floor(M*0.95)],
    initialValue, N, T,
  };
}

// ── Histogram builder ─────────────────────────────────────────────────────────
function buildHist(sorted, bins=60) {
  const min=sorted[0], max=sorted[sorted.length-1];
  const size=(max-min)/bins;
  const counts=new Array(bins).fill(0);
  for (const v of sorted) { const b=Math.min(bins-1,Math.floor((v-min)/size)); counts[b]++; }
  return { counts, min, max, size };
}

// ── SVG Path Chart (left panel — replicates Kyle's left subplot) ──────────────
function PathChart({ paths, var5, ref0, W=500, H=200 }) {
  if (!paths?.length) return null;
  const steps=paths[0].length;
  const allY=paths.flat(), minY=Math.min(...allY)*0.97, maxY=Math.max(...allY)*1.03;
  const pad={t:8,r:8,b:28,l:52};
  const xS=i=>pad.l+i/(steps-1)*(W-pad.l-pad.r);
  const yS=v=>pad.t+(1-(v-minY)/(maxY-minY))*(H-pad.t-pad.b);
  const var5Y=var5?yS(var5):null;
  const refY=ref0?yS(ref0):null;

  // Y-axis ticks
  const yTicks=[minY,(minY+maxY)/2,maxY];

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
      {/* P5-P95 band */}
      <rect x={pad.l} y={pad.t} width={W-pad.l-pad.r} height={H-pad.t-pad.b} fill="#6366f108" rx="2"/>

      {/* Sample paths */}
      {paths.filter((_,i)=>i%2===0).map((path,pi)=>(
        <path key={pi}
          d={path.map((v,i)=>`${i===0?"M":"L"}${xS(i).toFixed(1)},${yS(v).toFixed(1)}`).join("")}
          fill="none" stroke="#6366f1" strokeWidth="0.7" opacity="0.15"/>
      ))}

      {/* VaR line (red dashed — Kyle uses 'r' colour) */}
      {var5Y && <>
        <line x1={pad.l} y1={var5Y} x2={W-pad.r} y2={var5Y} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="6,3"/>
        <text x={W-pad.r-2} y={var5Y-4} fontSize="8" fill="#ef4444" textAnchor="end">5% VaR ${var5?.toFixed(0)}</text>
      </>}
      {/* Initial value line (orange — Kyle uses 'orange') */}
      {refY && <>
        <line x1={pad.l} y1={refY} x2={W-pad.r} y2={refY} stroke="#f59e0b" strokeWidth="1.2" strokeDasharray="4,3"/>
        <text x={pad.l+4} y={refY-4} fontSize="8" fill="#f59e0b">Initial ${ref0?.toFixed(0)}</text>
      </>}

      {/* Axes */}
      <line x1={pad.l} y1={H-pad.b} x2={W-pad.r} y2={H-pad.b} stroke="#2d2d40" strokeWidth="0.5"/>
      <line x1={pad.l} y1={pad.t}   x2={pad.l}   y2={H-pad.b} stroke="#2d2d40" strokeWidth="0.5"/>

      {/* X ticks — trading days */}
      {[0,63,126,189,252].filter(d=>d<=steps-1).map(d=>(
        <g key={d}>
          <line x1={xS(d)} y1={H-pad.b} x2={xS(d)} y2={H-pad.b+4} stroke="#2d2d40"/>
          <text x={xS(d)} y={H-pad.b+13} fontSize="7" fill="#4a5568" textAnchor="middle">{d}d</text>
        </g>
      ))}
      {/* Y ticks */}
      {yTicks.map(v=>(
        <text key={v} x={pad.l-4} y={yS(v)+3} fontSize="7" fill="#4a5568" textAnchor="end">
          {v>=1000?`$${(v/1000).toFixed(0)}k`:`$${v.toFixed(0)}`}
        </text>
      ))}
    </svg>
  );
}

// ── SVG Histogram (right panel — replicates Kyle's right subplot) ─────────────
function HistChart({ finals, var5, ref0, W=500, H=200 }) {
  if (!finals?.length) return null;
  const { counts, min, max, size } = buildHist(finals, 60);
  const maxC=Math.max(...counts);
  const pad={t:8,r:8,b:28,l:52};
  const bW=(W-pad.l-pad.r)/counts.length;
  const xS=v=>pad.l+(v-min)/(max-min)*(W-pad.l-pad.r);
  const yB=c=>H-pad.b-(c/maxC)*(H-pad.t-pad.b);
  const var5X=var5?xS(var5):null;
  const refX=ref0?xS(ref0):null;

  const xTicks=[min,min+(max-min)*0.25,min+(max-min)*0.5,min+(max-min)*0.75,max];

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
      {/* Histogram bars */}
      {counts.map((c,i)=>{
        const bx=pad.l+i*bW;
        const bv=min+i*size;
        const isLoss=bv<(ref0||0);
        return <rect key={i} x={bx} y={yB(c)} width={Math.max(bW-0.3,0.5)} height={H-pad.b-yB(c)}
          fill={isLoss?"#ef444870":"#6366f170"} stroke={isLoss?"#ef444490":"#6366f190"} strokeWidth="0.3"/>;
      })}
      {/* VaR vertical line (red dashed — Kyle's 'r') */}
      {var5X && <>
        <line x1={var5X} y1={pad.t} x2={var5X} y2={H-pad.b} stroke="#ef4444" strokeWidth="2" strokeDasharray="6,3"/>
        <text x={var5X+3} y={pad.t+12} fontSize="8" fill="#ef4444">VaR ${var5?.toFixed(0)}</text>
      </>}
      {/* Initial value line (orange) */}
      {refX && <>
        <line x1={refX} y1={pad.t} x2={refX} y2={H-pad.b} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="5,3"/>
        <text x={refX+3} y={pad.t+24} fontSize="8" fill="#f59e0b">Initial</text>
      </>}
      {/* Axes */}
      <line x1={pad.l} y1={H-pad.b} x2={W-pad.r} y2={H-pad.b} stroke="#2d2d40" strokeWidth="0.5"/>
      <line x1={pad.l} y1={pad.t}   x2={pad.l}   y2={H-pad.b} stroke="#2d2d40" strokeWidth="0.5"/>
      {xTicks.map(v=>(
        <text key={v} x={xS(v)} y={H-pad.b+13} fontSize="7" fill="#4a5568" textAnchor="middle">
          {v>=1000?`$${(v/1000).toFixed(0)}k`:`$${v.toFixed(0)}`}
        </text>
      ))}
      {[0,Math.round(maxC/2),maxC].map(c=>(
        <text key={c} x={pad.l-4} y={yB(c)+3} fontSize="7" fill="#4a5568" textAnchor="end">{c}</text>
      ))}
    </svg>
  );
}

// ── Risk text box — replicates Kyle's matplotlib text box exactly ─────────────
function RiskBox({ result, mode, assets }) {
  if (!result) return null;
  const ref = mode==="portfolio" ? result.initialValue : result.S0;
  return (
    <div style={{ background:"#0d0d18", border:"1px solid #2d2d40", borderRadius:"8px", padding:"16px 20px" }}>
      <div style={{ fontSize:"9px", color:"#4a5568", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"12px" }}>
        Risk Summary · {result.N} trading days · {result.finals.length.toLocaleString()} paths
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"20px", fontFamily:"'DM Mono',monospace", fontSize:"12px", color:"#94a3b8", lineHeight:"2" }}>
        <div>
          <div style={{color:"#e2e8f0",marginBottom:"4px",fontWeight:"500"}}>Central tendency</div>
          <div>Mean final price: <span style={{color:"#10b981"}}>${result.mean.toFixed(2)}</span></div>
          <div>Median (P50): <span style={{color:"#e2e8f0"}}>${result.p50.toFixed(2)}</span></div>
          <div>IQR: <span style={{color:"#6366f1"}}>${result.p25.toFixed(0)} – ${result.p75.toFixed(0)}</span></div>
        </div>
        <div>
          <div style={{color:"#e2e8f0",marginBottom:"4px",fontWeight:"500"}}>Downside risk</div>
          <div>5% VaR: <span style={{color:"#ef4444"}}>${result.var5.toFixed(2)}</span></div>
          <div>VaR loss: <span style={{color:"#ef4444"}}>${(ref-result.var5).toFixed(2)}</span></div>
          <div>P(loss): <span style={{color:result.probLoss>0.3?"#ef4444":"#f59e0b"}}>{(result.probLoss*100).toFixed(2)}%</span></div>
        </div>
        <div>
          <div style={{color:"#e2e8f0",marginBottom:"4px",fontWeight:"500"}}>Simulation</div>
          <div>Paths: <span style={{color:"#6366f1"}}>{result.finals.length.toLocaleString()}</span></div>
          <div>Steps: <span style={{color:"#6366f1"}}>{result.N} trading days</span></div>
          {mode==="portfolio"&&<div>Method: <span style={{color:"#6366f1"}}>Cholesky (Z@L.T)</span></div>}
          <div>Model: <span style={{color:"#6366f1"}}>GBM · lognormal</span></div>
        </div>
      </div>
      {mode==="portfolio"&&assets&&(
        <div style={{marginTop:"12px",paddingTop:"12px",borderTop:"1px solid #1e1e2e",fontSize:"10px",color:"#4a5568"}}>
          Portfolio: {assets.map((a,i)=>(
            <span key={i} style={{color:"#94a3b8",marginRight:"12px"}}>{a.ticker} {(a.weight*100).toFixed(0)}% · μ={a.mu*100}% · σ={a.sigma*100}%</span>
          ))}
        </div>
      )}
    </div>
  );
}

const INP = { background:"#0d0d18", border:"1px solid #2d2d40", borderRadius:"6px", color:"#e2e8f0", padding:"7px 10px", fontSize:"12px", width:"100%", fontFamily:"'DM Mono',monospace", outline:"none", boxSizing:"border-box" };
const LBL = { fontSize:"9px", letterSpacing:"0.12em", textTransform:"uppercase", color:"#4a5568", marginBottom:"3px", display:"block" };

// ── Default portfolio (Kyle's portfolio_montecarlo_gbm.py values) ─────────────
const DEFAULT_ASSETS = [
  { ticker:"AAPL", mu:0.08, sigma:0.15, weight:0.4, corr:[1.0,0.2,0.4] },
  { ticker:"TSLA", mu:0.12, sigma:0.20, weight:0.3, corr:[0.2,1.0,0.3] },
  { ticker:"NVDA", mu:0.10, sigma:0.18, weight:0.3, corr:[0.4,0.3,1.0] },
];

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function MonteCarloGBM({ S: propS, IV: propIV }) {
  const [mode,    setMode]    = useState("single");
  const [running, setRunning] = useState(false);
  const [result,  setResult]  = useState(null);
  const [assets,  setAssets]  = useState(DEFAULT_ASSETS);

  // Single-asset params (Kyle's Monte_Carlo_GBM.py defaults)
  const [S0,    setS0]    = useState(propS  || 167.76);
  const [mu,    setMu]    = useState(10);       // %
  const [sigma, setSigma] = useState(propIV ? Math.round(propIV*100) : 35); // %
  const [T,     setT]     = useState(1);
  const [M,     setM]     = useState(5000);
  const [initVal,setInitVal] = useState(100000);

  const run = useCallback(() => {
    setRunning(true); setResult(null);
    // Run in next tick so UI updates first
    setTimeout(()=>{
      try {
        if (mode==="single") {
          setResult(runSingleMC({ S0, mu:mu/100, sigma:sigma/100, T, M }));
        } else {
          const wSum=assets.reduce((s,a)=>s+a.weight,0);
          const w=assets.map(a=>a.weight/wSum);
          setResult(runPortfolioMC({ assets, weights:w, T, M, initialValue:initVal }));
        }
      } catch(e){ console.error(e); }
      setRunning(false);
    }, 30);
  }, [mode,S0,mu,sigma,T,M,initVal,assets]);

  // Auto-run once on mount
  useState(()=>{ run(); },[]);

  const updateAsset = (i,field,val) =>
    setAssets(prev=>prev.map((a,ai)=>ai===i?{...a,[field]:val}:a));
  const updateCorr = (i,j,val) => {
    setAssets(prev=>prev.map((a,ai)=>{
      if(ai!==i)return a;
      const c=[...a.corr]; c[j]=val; return {...a,corr:c};
    }));
    // keep matrix symmetric
    setAssets(prev=>prev.map((a,ai)=>{
      if(ai!==j)return a;
      const c=[...a.corr]; c[i]=val; return {...a,corr:c};
    }));
  };

  const ref0 = mode==="portfolio" ? initVal : S0;

  return (
    <div>
      {/* Mode toggle */}
      <div style={{display:"flex",gap:"8px",marginBottom:"16px"}}>
        {[["single","📈 Single Asset GBM"],["portfolio","📊 Portfolio (Correlated)"]].map(([id,label])=>(
          <button key={id} onClick={()=>setMode(id)} style={{
            padding:"8px 20px", border:`1px solid ${mode===id?"#6366f1":"#2d2d40"}`,
            borderRadius:"6px", background:mode===id?"#6366f1":"transparent",
            color:mode===id?"#fff":"#4a5568", cursor:"pointer", fontSize:"11px",
            letterSpacing:"0.08em", textTransform:"uppercase", fontFamily:"'DM Mono',monospace",
          }}>{label}</button>
        ))}
      </div>

      {/* GBM formula reference */}
      <div style={{background:"#0d0d18",border:"1px solid #1e1e2e",borderRadius:"8px",padding:"12px 16px",marginBottom:"16px",fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#4a5568",lineHeight:"1.9"}}>
        <span style={{color:"#6366f1"}}>GBM equation: </span>
        <span style={{color:"#e2e8f0"}}>S[t] = S[t−1] × exp( (μ − σ²/2)·Δt  +  σ·√Δt·Z[t] )</span>
        <br/>
        {mode==="portfolio"&&<>
          <span style={{color:"#f59e0b"}}>Cholesky: </span>
          <span style={{color:"#94a3b8"}}>cov = outer(σ,σ) × ρ &nbsp;→&nbsp; L = cholesky(cov) &nbsp;→&nbsp; Z_corr = Z @ Lᵀ</span>
          <br/>
        </>}
        <span style={{color:"#10b981"}}>Risk metrics: </span>
        <span style={{color:"#94a3b8"}}>VaR₅% = np.percentile(finals, 5) &nbsp;·&nbsp; P(loss) = mean(finals &lt; S₀)</span>
      </div>

      {/* ── SINGLE ASSET PARAMS ── */}
      {mode==="single"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"10px",marginBottom:"16px"}}>
          {[
            {l:"S₀ — Initial Price ($)", v:S0,    s:setS0,    min:5,    max:1000, step:1   },
            {l:"μ — Annual Drift (%)",   v:mu,    s:setMu,    min:-100, max:200,  step:1   },
            {l:"σ — Annual Vol (%)",     v:sigma, s:setSigma, min:1,    max:200,  step:1   },
            {l:"T — Horizon (years)",    v:T,     s:setT,     min:0.08, max:5,    step:0.08},
            {l:"M — Simulations",        v:M,     s:setM,     min:500,  max:20000,step:500 },
          ].map(({l,v,s,min,max,step})=>(
            <div key={l}>
              <label style={LBL}>{l}</label>
              <input type="number" style={INP} value={v} min={min} max={max} step={step}
                onChange={e=>s(parseFloat(e.target.value)||0)}/>
            </div>
          ))}
        </div>
      )}

      {/* ── PORTFOLIO PARAMS ── */}
      {mode==="portfolio"&&(
        <div style={{marginBottom:"16px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"10px",marginBottom:"12px"}}>
            <div><label style={LBL}>Portfolio Value ($)</label>
              <input type="number" style={INP} value={initVal} step={1000} onChange={e=>setInitVal(parseFloat(e.target.value)||100000)}/></div>
            <div><label style={LBL}>Horizon (years)</label>
              <input type="number" style={INP} value={T} step={0.25} min={0.25} max={5} onChange={e=>setT(parseFloat(e.target.value)||1)}/></div>
            <div><label style={LBL}>Simulations (M)</label>
              <input type="number" style={INP} value={M} step={500} min={500} max={20000} onChange={e=>setM(parseInt(e.target.value)||5000)}/></div>
          </div>

          {/* Asset table — Kyle's default values pre-filled */}
          <div style={{background:"#0d0d18",border:"1px solid #1e1e2e",borderRadius:"8px",padding:"14px",marginBottom:"10px"}}>
            <div style={{fontSize:"9px",color:"#4a5568",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"10px"}}>
              Assets · weights auto-normalised · correlation matrix is symmetric
            </div>
            {/* Header */}
            <div style={{display:"grid",gridTemplateColumns:"80px 70px 70px 70px 1fr",gap:"6px",marginBottom:"6px"}}>
              {["Ticker","μ (%)","σ (%)","Weight","Correlation matrix →"].map(h=>(
                <div key={h} style={{fontSize:"9px",color:"#4a5568",letterSpacing:"0.08em",textTransform:"uppercase",padding:"2px 0"}}>{h}</div>
              ))}
            </div>
            {assets.map((a,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"80px 70px 70px 70px 1fr",gap:"6px",marginBottom:"6px",alignItems:"center"}}>
                <input style={{...INP,fontSize:"11px",padding:"5px 8px"}} value={a.ticker}
                  onChange={e=>updateAsset(i,"ticker",e.target.value)}/>
                <input type="number" style={{...INP,fontSize:"11px",padding:"5px 8px"}}
                  value={(a.mu*100).toFixed(0)} step={1}
                  onChange={e=>updateAsset(i,"mu",parseFloat(e.target.value)/100||0)}/>
                <input type="number" style={{...INP,fontSize:"11px",padding:"5px 8px"}}
                  value={(a.sigma*100).toFixed(0)} step={1} min={1}
                  onChange={e=>updateAsset(i,"sigma",parseFloat(e.target.value)/100||0.1)}/>
                <input type="number" style={{...INP,fontSize:"11px",padding:"5px 8px"}}
                  value={a.weight.toFixed(2)} step={0.05} min={0} max={1}
                  onChange={e=>updateAsset(i,"weight",parseFloat(e.target.value)||0)}/>
                {/* Correlation inputs */}
                <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
                  {assets.map((_,j)=>(
                    <div key={j} style={{flex:1,textAlign:"center"}}>
                      {i===j
                        ? <div style={{color:"#4a5568",fontSize:"11px",fontFamily:"'DM Mono',monospace"}}>1.00</div>
                        : <input type="number" style={{...INP,fontSize:"10px",padding:"4px 5px",textAlign:"center"}}
                            value={a.corr[j].toFixed(2)} step={0.05} min={-1} max={1}
                            onChange={e=>updateCorr(i,j,parseFloat(e.target.value)||0)}/>
                      }
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run button */}
      <button onClick={run} disabled={running} style={{
        marginBottom:"20px", padding:"10px 32px",
        background:running?"#2d2d40":"#6366f1", border:"none", borderRadius:"6px",
        color:"#fff", fontSize:"11px", fontWeight:"600", cursor:running?"not-allowed":"pointer",
        letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"'DM Mono',monospace",
      }}>
        {running ? "⏳ Simulating..." : `↺ Run ${M.toLocaleString()} Simulations`}
      </button>

      {running&&(
        <div style={{display:"flex",alignItems:"center",gap:"12px",padding:"40px",justifyContent:"center",color:"#4a5568"}}>
          <span style={{animation:"pulse 1s infinite",fontSize:"20px"}}>◎</span>
          <span style={{fontSize:"13px"}}>Running {M.toLocaleString()} GBM paths{mode==="portfolio"?" with Cholesky correlation":""}...</span>
        </div>
      )}

      {!running&&result&&(
        <>
          {/* Stat cards */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"8px",marginBottom:"16px"}}>
            {[
              {l:"Mean Final Price", v:`$${result.mean.toFixed(2)}`,          c:"#10b981", s:"expected outcome"},
              {l:"5% VaR",          v:`$${result.var5.toFixed(2)}`,           c:"#ef4444", s:`loss: $${(ref0-result.var5).toFixed(2)}`},
              {l:"P(Loss)",         v:`${(result.probLoss*100).toFixed(2)}%`, c:result.probLoss>0.3?"#ef4444":"#f59e0b", s:"below initial price"},
              {l:"Median (P50)",    v:`$${result.p50.toFixed(2)}`,            c:"#e2e8f0", s:"50th percentile"},
              {l:"P5 / P95 range",  v:`$${result.p5.toFixed(0)} / $${result.p95.toFixed(0)}`, c:"#6366f1", s:"90% confidence band"},
            ].map(s=>(
              <div key={s.l} style={{background:"#0d0d18",border:"1px solid #1e1e2e",borderRadius:"8px",padding:"10px",textAlign:"center"}}>
                <div style={{fontSize:"9px",color:"#4a5568",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"4px"}}>{s.l}</div>
                <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"14px",fontWeight:"500",color:s.c}}>{s.v}</div>
                <div style={{fontSize:"9px",color:"#4a5568",marginTop:"2px"}}>{s.s}</div>
              </div>
            ))}
          </div>

          {/* Side-by-side charts — replicating Kyle's fig, axs = plt.subplots(1,2) */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px",marginBottom:"16px"}}>
            <div style={{background:"#0d0d18",border:"1px solid #1e1e2e",borderRadius:"8px",padding:"14px"}}>
              <div style={{fontSize:"9px",color:"#4a5568",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"6px"}}>
                {mode==="portfolio"?"Sample Simulated Portfolio Paths":"Monte Carlo Simulated Price Paths"}
                &nbsp;· {result.samplePaths.length} of {M.toLocaleString()} shown
              </div>
              <PathChart paths={result.samplePaths} var5={result.var5} ref0={ref0}/>
              {/* Replicate Kyle's text box (upper left of path chart) */}
              {mode==="portfolio"&&(
                <div style={{marginTop:"8px",padding:"8px 10px",background:"#13131f",borderRadius:"6px",fontSize:"10px",color:"#94a3b8",lineHeight:"1.7"}}>
                  <div style={{color:"#e2e8f0",marginBottom:"2px",fontWeight:"500"}}>Portfolio Weights</div>
                  {assets.map((a,i)=>(
                    <div key={i}>{a.ticker}: {(a.weight/assets.reduce((s,x)=>s+x.weight,0)*100).toFixed(1)}% · μ={a.mu*100}% · σ={a.sigma*100}%</div>
                  ))}
                </div>
              )}
            </div>
            <div style={{background:"#0d0d18",border:"1px solid #1e1e2e",borderRadius:"8px",padding:"14px"}}>
              <div style={{fontSize:"9px",color:"#4a5568",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"6px"}}>
                {mode==="portfolio"?"Distribution of Final Portfolio Values":"Distribution of Final Simulated Prices"}
                &nbsp;· {result.N} trading days
              </div>
              <HistChart finals={result.finals} var5={result.var5} ref0={ref0}/>
              {/* Replicate Kyle's text box (upper right of histogram) */}
              <div style={{marginTop:"8px",padding:"8px 10px",background:"#13131f",borderRadius:"6px",fontSize:"10px",fontFamily:"'DM Mono',monospace",color:"#94a3b8",lineHeight:"1.7"}}>
                <span style={{color:"#10b981"}}>Mean Final Price: ${result.mean.toFixed(2)}</span><br/>
                <span style={{color:"#ef4444"}}>5% VaR: ${result.var5.toFixed(2)} (loss: ${(ref0-result.var5).toFixed(2)})</span><br/>
                <span style={{color:"#f59e0b"}}>Probability of Loss: {(result.probLoss*100).toFixed(2)}%</span>
              </div>
              <div style={{display:"flex",gap:"12px",marginTop:"8px",fontSize:"9px"}}>
                <span style={{color:"#6366f1"}}>■ Gain</span>
                <span style={{color:"#ef4444"}}>■ Loss</span>
                <span style={{color:"#ef4444"}}>— 5% VaR</span>
                <span style={{color:"#f59e0b"}}>— Initial</span>
              </div>
            </div>
          </div>

          {/* Risk summary box */}
          <RiskBox result={result} mode={mode} assets={mode==="portfolio"?assets:null}/>
        </>
      )}
    </div>
  );
}
