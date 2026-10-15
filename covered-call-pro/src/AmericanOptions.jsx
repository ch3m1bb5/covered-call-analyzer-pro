// ─────────────────────────────────────────────────────────────────────────────
// AmericanOptions.jsx  — drop-in tab component for the Covered Call dashboard
//
// ADD THIS FILE as src/AmericanOptions.jsx
// Then in App.jsx:
//   1. Add import:  import AmericanTab from "./AmericanOptions";
//   2. Add tab entry: { id:"american", l:"American", i:"🇺🇸" }
//   3. Add render:  {tab==="american" && <div className="card"><div className="st">American Option Pricing · BS1993 · BS2002 · CRR Binomial Tree</div><AmericanTab S={S} K={K} T={T} r={R} IV={IV} PREM={PREM} serverOnline={serverOnline}/></div>}
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";

const API = "http://localhost:5050";

async function fetchAmerican(flag, S, K, T, r, q, sigma, nTree = 500) {
  const res = await fetch(`${API}/american`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ flag, S, K, T, r, q, sigma, n_tree: nTree }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function normCDF(x) {
  return 0.5 * (1 + erf_approx(x / Math.sqrt(2)));
}
function erf_approx(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const s=x<0?-1:1; x=Math.abs(x);
  const t=1/(1+p*x);
  return s*(1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x));
}

// Local BS1993 fallback (if server offline)
function localBS1993(flag, S, K, T, r, b, v) {
  if (T <= 0) return Math.max(flag==="c"?S-K:K-S, 0);
  function phi(s, t, g, H, I) {
    const lam = (-r + g*b + 0.5*g*(g-1)*v**2)*t;
    const d   = -(Math.log(s/H)+(b+(g-0.5)*v**2)*t)/(v*Math.sqrt(t));
    const kap = 2*b/v**2+(2*g-1);
    return Math.exp(lam)*s**g*(normCDF(d)-(I/s)**kap*normCDF(d-2*Math.log(I/s)/(v*Math.sqrt(t))));
  }
  function callPrice(F, X) {
    if (b >= r) {
      const d1=(Math.log(F/X)+(b+0.5*v**2)*T)/(v*Math.sqrt(T)),d2=d1-v*Math.sqrt(T);
      return F*Math.exp((b-r)*T)*normCDF(d1)-X*Math.exp(-r*T)*normCDF(d2);
    }
    const beta=(0.5-b/v**2)+Math.sqrt((b/v**2-0.5)**2+2*r/v**2);
    const Binf=beta/(beta-1)*X,B0=Math.max(X,r/(r-b)*X);
    const ht=-(b*T+2*v*Math.sqrt(T))*B0/(Binf-B0);
    const I=B0+(Binf-B0)*(1-Math.exp(ht));
    if (F>=I) return F-X;
    const alpha=(I-X)*I**(-beta);
    return alpha*F**beta-alpha*phi(F,T,beta,I,I)+phi(F,T,1,I,I)-phi(F,T,1,X,I)-X*phi(F,T,0,I,I)+X*phi(F,T,0,X,I);
  }
  if (flag==="c") return callPrice(S, K);
  return callPrice(K, S);  // put via symmetry
}

// ── Model card ────────────────────────────────────────────────────────────────
function ModelCard({ name, price, description, color, isRecommended, europeanPrice, greeks }) {
  const eep = price && europeanPrice ? Math.max(0, price - europeanPrice) : null;
  return (
    <div style={{
      background: "#0d0d18", border: `1px solid ${isRecommended ? color : "#1e1e2e"}`,
      borderRadius: "10px", padding: "16px",
      boxShadow: isRecommended ? `0 0 12px ${color}20` : "none",
      position: "relative",
    }}>
      {isRecommended && (
        <div style={{ position:"absolute", top:"-9px", right:"12px", background:color, color:"#000",
          fontSize:"8px", fontWeight:"700", letterSpacing:"0.1em", padding:"2px 8px", borderRadius:"99px" }}>
          RECOMMENDED
        </div>
      )}
      <div style={{ fontSize:"9px", color:"#4a5568", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"4px" }}>{name}</div>
      <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:"28px", fontWeight:"700", color, marginBottom:"4px" }}>
        {price != null ? `$${price.toFixed(4)}` : "—"}
      </div>
      {eep != null && eep > 0.001 && (
        <div style={{ fontSize:"10px", color:"#f59e0b", marginBottom:"4px" }}>
          Early exercise premium: +${eep.toFixed(4)}
        </div>
      )}
      <div style={{ fontSize:"9px", color:"#4a5568", lineHeight:"1.5" }}>{description}</div>
      {greeks && (
        <div style={{ marginTop:"10px", display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"6px" }}>
          {[["Δ", greeks.delta], ["Γ", greeks.gamma], ["Θ", greeks.theta ? `$${Math.abs(greeks.theta).toFixed(4)}` : null]].map(([l, v]) => v != null && (
            <div key={l} style={{ background:"#13131f", borderRadius:"5px", padding:"6px", textAlign:"center" }}>
              <div style={{ fontSize:"9px", color:"#4a5568" }}>{l}</div>
              <div style={{ fontSize:"12px", fontWeight:"600", color:"#e2e8f0" }}>{typeof v === "number" ? v.toFixed(4) : v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Exercise boundary chart ───────────────────────────────────────────────────
function BoundaryChart({ boundary, S, K, flag }) {
  if (!boundary || boundary.length === 0) return null;
  const W = 500, H = 140, pad = 30;
  const times   = boundary.map(b => b.t_remaining);
  const prices  = boundary.map(b => b.critical_price);
  const minT = 0, maxT = Math.max(...times);
  const minP = Math.min(...prices, S, K) * 0.95;
  const maxP = Math.max(...prices, S, K) * 1.05;
  const xS = t => pad + (t - minT) / (maxT - minT) * (W - pad * 2);
  const yS = p => pad + (1 - (p - minP) / (maxP - minP)) * (H - pad * 2);
  const path = boundary.map((b, i) => `${i === 0 ? "M" : "L"}${xS(b.t_remaining)},${yS(b.critical_price)}`).join("");

  return (
    <div style={{ background:"#0d0d18", borderRadius:"8px", padding:"12px" }}>
      <div style={{ fontSize:"10px", color:"#4a5568", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"8px" }}>
        Early Exercise Boundary · Critical {flag==="c"?"Stock":"Stock"} Price vs Time
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow:"visible" }}>
        {/* Grid lines */}
        {[S, K].map((p, i) => (
          <g key={i}>
            <line x1={pad} y1={yS(p)} x2={W-pad} y2={yS(p)} stroke={i===0?"#6366f1":"#ef4444"} strokeWidth="1" strokeDasharray="4,3" opacity="0.5"/>
            <text x={W-pad+2} y={yS(p)+3} fontSize="7" fill={i===0?"#6366f1":"#ef4444"}>{i===0?"S":"K"} ${p}</text>
          </g>
        ))}
        {/* Boundary area fill */}
        <defs>
          <linearGradient id="bndGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={flag==="c"?"0.15":"0.05"}/>
            <stop offset="100%" stopColor="#10b981" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={path + `L${xS(maxT)},${H-pad} L${pad},${H-pad}Z`} fill="url(#bndGrad)"/>
        {/* Boundary line */}
        <path d={path} fill="none" stroke="#10b981" strokeWidth="2"/>
        {/* Current time marker */}
        <circle cx={xS(maxT)} cy={yS(boundary[boundary.length-1]?.critical_price||K)} r="4" fill="#10b981"/>
        {/* Labels */}
        <text x={pad} y={H-pad+14} fontSize="7" fill="#4a5568">← Today</text>
        <text x={W-pad} y={H-pad+14} fontSize="7" fill="#4a5568" textAnchor="end">Expiry →</text>
        <text x={pad+4} y={pad+12} fontSize="8" fill="#10b981">Exercise boundary</text>
        <text x={pad+4} y={pad+22} fontSize="7" fill="#4a5568">Above line: optimal to exercise early</text>
      </svg>
    </div>
  );
}

// ── Main AmericanOptions tab ──────────────────────────────────────────────────
export default function AmericanTab({ S, K, T, r, IV, PREM, serverOnline, COST, SHARES }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [flag, setFlag]       = useState("c");
  const [q, setQ]             = useState("0");
  const [nTree, setNTree]     = useState("500");
  const [engine, setEngine]   = useState("");

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    const qVal = parseFloat(q) || 0;
    const nVal = parseInt(nTree) || 500;

    if (serverOnline) {
      try {
        const res = await fetchAmerican(flag, S, K, T, r, qVal, IV, nVal);
        setData(res);
        setEngine(res.european?.model || "py_vollib");
        setLoading(false); return;
      } catch (e) { console.warn("Server fetch failed:", e); }
    }

    // Local JS fallback (BS1993 only)
    const b = r - qVal;
    const p93   = localBS1993(flag, S, K, T, r, b, IV);
    const d1    = (Math.log(S/K)+(b+0.5*IV**2)*T)/(IV*Math.sqrt(T));
    const d2    = d1-IV*Math.sqrt(T);
    const eur   = flag==="c" ? S*Math.exp((b-r)*T)*normCDF(d1)-K*Math.exp(-r*T)*normCDF(d2)
                              : K*Math.exp(-r*T)*normCDF(-d2)-S*Math.exp((b-r)*T)*normCDF(-d1);
    const eep   = Math.max(0, p93 - eur);
    setData({
      bs1993: { price: p93, model:"Bjerksund-Stensland 1993", description:"Fast closed-form approximation." },
      bs2002: { price: null, model:"Bjerksund-Stensland 2002", description:"Server offline — unavailable locally." },
      crr:    { price: null, model:"CRR Binomial Tree", description:"Server offline — unavailable locally." },
      european: { price: eur, delta: Math.exp((b-r)*T)*(flag==="c"?normCDF(d1):-normCDF(-d1)) },
      early_exercise_premium: eep, early_exercise_pct: eur>0?eep/eur*100:0,
      model_spread: 0, recommended_price: p93,
      moneyness: S>K?"ITM":"OTM", intrinsic: Math.max(flag==="c"?S-K:K-S,0),
      time_value: Math.max(0,p93-Math.max(flag==="c"?S-K:K-S,0)),
      boundary: [], inputs: { flag, S, K, T, r, q:qVal, sigma:IV },
    });
    setEngine("@uqee/local fallback");
    setLoading(false);
  }, [S, K, T, r, IV, flag, q, nTree, serverOnline]);

  useEffect(() => { run(); }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Controls */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"10px", marginBottom:"16px", background:"#0d0d18", borderRadius:"8px", padding:"14px" }}>
        <div>
          <div style={{ fontSize:"9px", color:"#4a5568", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"4px" }}>Option Type</div>
          <div style={{ display:"flex", gap:"4px" }}>
            {["c","p"].map(f=>(
              <button key={f} onClick={()=>setFlag(f)} style={{ flex:1, padding:"6px", border:"none", borderRadius:"4px", cursor:"pointer", fontSize:"11px", fontWeight:"600", fontFamily:"'DM Mono',monospace", background:flag===f?"#6366f1":"#13131f", color:flag===f?"#fff":"#4a5568" }}>
                {f==="c"?"CALL":"PUT"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize:"9px", color:"#4a5568", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"4px" }}>Dividend Yield %</div>
          <input value={q} onChange={e=>setQ(e.target.value)} style={{ background:"#13131f", border:"1px solid #2d2d40", borderRadius:"5px", color:"#e2e8f0", padding:"6px 8px", fontSize:"12px", width:"100%", fontFamily:"'DM Mono',monospace", outline:"none", boxSizing:"border-box" }} placeholder="0.0"/>
        </div>
        <div>
          <div style={{ fontSize:"9px", color:"#4a5568", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"4px" }}>Tree Steps (accuracy)</div>
          <select value={nTree} onChange={e=>setNTree(e.target.value)} style={{ background:"#13131f", border:"1px solid #2d2d40", borderRadius:"5px", color:"#e2e8f0", padding:"6px 8px", fontSize:"12px", width:"100%", fontFamily:"'DM Mono',monospace", outline:"none" }}>
            <option value="100">100 (fast)</option>
            <option value="300">300 (balanced)</option>
            <option value="500">500 (accurate)</option>
            <option value="1000">1000 (precise)</option>
          </select>
        </div>
        <div style={{ display:"flex", alignItems:"flex-end" }}>
          <button onClick={run} style={{ width:"100%", padding:"8px", background:"#6366f1", border:"none", borderRadius:"6px", color:"#fff", fontSize:"11px", fontWeight:"600", cursor:"pointer", letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"'DM Mono',monospace" }}>
            ↺ Recalculate
          </button>
        </div>
      </div>

      {/* Engine label */}
      <div style={{ fontSize:"10px", color:"#4a5568", marginBottom:"14px", padding:"7px 12px", background:"#0d0d18", borderRadius:"6px" }}>
        Engine: <span style={{ color: serverOnline ? "#10b981":"#f59e0b" }}>{serverOnline?"py_vollib (LetsBeRational)":engine||"local fallback"}</span>
        &nbsp;·&nbsp;
        Models: <span style={{ color:"#6366f1" }}>Bjerksund-Stensland 1993</span> &nbsp;
        <span style={{ color:"#8b5cf6" }}>Bjerksund-Stensland 2002</span> &nbsp;
        <span style={{ color:"#10b981" }}>CRR Binomial Tree n={nTree}</span>
      </div>

      {loading && (
        <div style={{ display:"flex", alignItems:"center", gap:"12px", padding:"40px", justifyContent:"center", color:"#4a5568" }}>
          <span style={{ animation:"pulse 1s infinite", fontSize:"20px" }}>◎</span>
          <span>Running {serverOnline?"py_vollib":"local"} American option pricing...</span>
        </div>
      )}

      {error && <div style={{ padding:"16px", background:"#ef444415", borderRadius:"8px", color:"#ef4444", fontSize:"12px" }}>{error}</div>}

      {!loading && data && (
        <>
          {/* Key metrics row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"10px", marginBottom:"16px" }}>
            {[
              { l:"Recommended",  v: data.recommended_price != null ? `$${data.recommended_price.toFixed(4)}`:"—", c:"#10b981", s:"CRR tree price" },
              { l:"BS1993 Price", v: data.bs1993?.price != null ? `$${data.bs1993.price.toFixed(4)}`:"—", c:"#6366f1", s:"closed-form" },
              { l:"BS2002 Price", v: data.bs2002?.price != null ? `$${data.bs2002.price.toFixed(4)}`:"—", c:"#8b5cf6", s:"closed-form" },
              { l:"Early Ex. Prem.", v: `$${(data.early_exercise_premium||0).toFixed(4)}`, c:"#f59e0b", s:`${(data.early_exercise_pct||0).toFixed(2)}% of Euro price` },
              { l:"Model Spread",  v: `$${(data.model_spread||0).toFixed(4)}`, c:data.model_spread>0.05?"#ef4444":"#10b981", s:data.model_spread>0.05?"models disagree":"models agree" },
            ].map(s=>(
              <div key={s.l} style={{ background:"#0d0d18", borderRadius:"8px", padding:"12px", textAlign:"center" }}>
                <div style={{ fontSize:"9px", color:"#4a5568", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"4px" }}>{s.l}</div>
                <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:"16px", fontWeight:"700", color:s.c }}>{s.v}</div>
                <div style={{ fontSize:"9px", color:"#4a5568", marginTop:"2px" }}>{s.s}</div>
              </div>
            ))}
          </div>

          {/* Moneyness + intrinsic value */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"10px", marginBottom:"16px" }}>
            {[
              { l:"Moneyness", v:data.moneyness, c:data.moneyness==="ITM"?"#10b981":"#f59e0b" },
              { l:"Intrinsic Value", v:data.intrinsic!=null?`$${data.intrinsic.toFixed(4)}`:"—", c:"#e2e8f0" },
              { l:"Time Value", v:data.time_value!=null?`$${data.time_value.toFixed(4)}`:"—", c:"#6366f1" },
            ].map(s=>(
              <div key={s.l} style={{ background:"#0d0d18", borderRadius:"8px", padding:"12px", textAlign:"center" }}>
                <div style={{ fontSize:"9px", color:"#4a5568", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"4px" }}>{s.l}</div>
                <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:"18px", fontWeight:"700", color:s.c }}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Model cards */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:"10px", marginBottom:"16px" }}>
            <ModelCard
              name="Bjerksund-Stensland 1993"
              price={data.bs1993?.price}
              description={data.bs1993?.description || data.bs1993?.error || ""}
              color="#6366f1"
              isRecommended={false}
              europeanPrice={data.european?.price}
            />
            <ModelCard
              name="Bjerksund-Stensland 2002"
              price={data.bs2002?.price}
              description={data.bs2002?.description || data.bs2002?.error || ""}
              color="#8b5cf6"
              isRecommended={false}
              europeanPrice={data.european?.price}
            />
            <ModelCard
              name={`CRR Binomial Tree (n=${nTree})`}
              price={data.crr?.price}
              description={data.crr?.description || data.crr?.error || ""}
              color="#10b981"
              isRecommended={true}
              europeanPrice={data.european?.price}
              greeks={data.crr?.price ? {
                delta: data.crr.delta,
                gamma: data.crr.gamma,
                theta: data.crr.theta,
              } : null}
            />
            <ModelCard
              name="European BSM (lower bound)"
              price={data.european?.price}
              description={data.european?.description || "European equivalent. American price ≥ European always."}
              color="#94a3b8"
              isRecommended={false}
              europeanPrice={null}
              greeks={data.european?.price ? {
                delta: data.european.delta,
                gamma: data.european.gamma,
                theta: data.european.theta,
              } : null}
            />
          </div>

          {/* CRR full greeks panel */}
          {data.crr?.price && (
            <div style={{ background:"#0d0d18", borderRadius:"8px", padding:"14px", marginBottom:"16px" }}>
              <div style={{ fontSize:"10px", color:"#4a5568", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"12px" }}>
                CRR Binomial Tree Greeks · American {flag==="c"?"Call":"Put"}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"10px" }}>
                {[
                  { n:"Δ Delta",  v:(data.crr.delta||0).toFixed(5), c:"#6366f1",  d:`~${((data.crr.delta||0)*100).toFixed(1)}% ITM prob. American delta typically higher than European due to early exercise.` },
                  { n:"Γ Gamma",  v:(data.crr.gamma||0).toFixed(6), c:"#8b5cf6",  d:`Delta sensitivity per $1. Peaks near ATM. Finite-difference from binomial tree.` },
                  { n:"Θ Theta",  v:`$${Math.abs(data.crr.theta||0).toFixed(5)}`, c:"#10b981", d:`Daily time decay. American calls may have positive theta near deep ITM if early exercise optimal.` },
                  { n:"V Vega",   v:`$${(data.crr.vega||0).toFixed(5)}`,  c:"#f59e0b",  d:`Per 1% IV change. Higher IV → less likely to exercise early → vega ≈ European.` },
                  { n:"EE Prem",  v:`$${(data.crr.early_exercise_premium||0).toFixed(4)}`, c:"#ef4444", d:`Early exercise premium = American − European. This is what you gain by holding an American over European option.` },
                ].map(g=>(
                  <div key={g.n} style={{ background:"#13131f", borderRadius:"7px", padding:"12px" }}>
                    <div style={{ fontSize:"10px", color:g.c, fontWeight:"600", marginBottom:"2px" }}>{g.n}</div>
                    <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:"16px", fontWeight:"700", marginBottom:"6px" }}>{g.v}</div>
                    <div style={{ fontSize:"9px", color:"#4a5568", lineHeight:"1.5" }}>{g.d}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Early exercise boundary chart */}
          {data.boundary && data.boundary.length > 0 && (
            <div style={{ marginBottom:"16px" }}>
              <BoundaryChart boundary={data.boundary} S={S} K={K} flag={flag}/>
            </div>
          )}

          {/* Educational panel */}
          <div style={{ background:"#0d0d18", border:"1px solid #1e1e2e", borderRadius:"8px", padding:"14px" }}>
            <div style={{ fontSize:"10px", color:"#4a5568", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"10px" }}>
              American vs European · Key Differences
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px", fontSize:"11px", color:"#94a3b8", lineHeight:"1.7" }}>
              <div>
                <div style={{ color:"#e2e8f0", fontWeight:"600", marginBottom:"4px" }}>When early exercise is rational for calls:</div>
                <div>• Cost of carry on the asset is positive (dividends make holding expensive)</div>
                <div>• Interest rates are low or negative</div>
                <div>• Option is deep in the money</div>
                <div style={{ color:"#f59e0b", marginTop:"6px", fontSize:"10px" }}>Note: For non-dividend paying stocks (q=0), it is <em>never</em> optimal to exercise an American call early — the European and American call have identical value.</div>
              </div>
              <div>
                <div style={{ color:"#e2e8f0", fontWeight:"600", marginBottom:"4px" }}>When early exercise is rational for puts:</div>
                <div>• Cost of carry on the asset is low (zero or negative)</div>
                <div>• Interest rates are high (cash received now earns more)</div>
                <div>• Option is deep in the money</div>
                <div style={{ color:"#6366f1", marginTop:"6px", fontSize:"10px" }}>The early exercise boundary chart above shows the critical stock price at each time point — exercise when the stock crosses the boundary.</div>
              </div>
            </div>
            <div style={{ marginTop:"12px", padding:"10px", background:"#13131f", borderRadius:"6px", fontSize:"10px", color:"#4a5568", lineHeight:"1.6" }}>
              <span style={{ color:"#6366f1" }}>BS1993</span> = Bjerksund-Stensland 1993 — original closed-form approximation, fast. &nbsp;
              <span style={{ color:"#8b5cf6" }}>BS2002</span> = 2002 refinement with two-piece boundary — more accurate for deep ITM. &nbsp;
              <span style={{ color:"#10b981" }}>CRR</span> = Cox-Ross-Rubinstein binomial tree — gold standard numerical method, converges to exact price as n→∞.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
