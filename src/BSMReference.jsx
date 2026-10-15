// BSMReference.jsx — Black-Scholes-Merton interactive formula reference
import { useState, useEffect } from "react";

function normCDF(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1; x=Math.abs(x);
  const t=1/(1+p*x);
  return 0.5*(1+sign*(1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x)));
}
function normPDF(x){ return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }

const SLD = {
  background:"#0d0d18",border:"1px solid #2d2d40",borderRadius:"6px",color:"#e2e8f0",
  padding:"8px 10px",fontSize:"13px",width:"100%",fontFamily:"'DM Mono',monospace",
  outline:"none",boxSizing:"border-box",
};
const LBL = {fontSize:"9px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#4a5568",marginBottom:"4px",display:"block"};

export default function BSMReference() {
  const [flag, setFlag] = useState("c");
  const [S, setS]   = useState(167);
  const [K, setK]   = useState(175);
  const [days, setDays] = useState(30);
  const [r, setR]   = useState(5.3);
  const [v, setV]   = useState(35);
  const [q, setQ]   = useState(0);
  const [res, setRes] = useState(null);

  useEffect(() => {
    const T  = days / 365;
    const rv = v / 100;
    const rr = r / 100;
    const qq = q / 100;
    const b  = rr - qq; // cost of carry
    if (T <= 0 || rv <= 0 || S <= 0 || K <= 0) return;

    const d1 = (Math.log(S / K) + (b + 0.5 * rv * rv) * T) / (rv * Math.sqrt(T));
    const d2 = d1 - rv * Math.sqrt(T);
    const Nd1 = normCDF(d1), Nd2 = normCDF(d2);
    const Nnd1 = normCDF(-d1), Nnd2 = normCDF(-d2);
    const nd1  = normPDF(d1);
    const ebrT = Math.exp((b - rr) * T);
    const erT  = Math.exp(-rr * T);

    let price, delta, rho_val, theta;
    if (flag === "c") {
      price  = S * ebrT * Nd1 - K * erT * Nd2;
      delta  = ebrT * Nd1;
      rho_val= K * T * erT * Nd2 / 100;
      theta  = (-S*nd1*rv*ebrT/(2*Math.sqrt(T)) - rr*K*erT*Nd2 + b*S*ebrT*Nd1) / 365;
    } else {
      price  = K * erT * Nnd2 - S * ebrT * Nnd1;
      delta  = ebrT * (Nd1 - 1);
      rho_val= -K * T * erT * Nnd2 / 100;
      theta  = (-S*nd1*rv*ebrT/(2*Math.sqrt(T)) + rr*K*erT*Nnd2 - b*S*ebrT*Nnd1) / 365;
    }
    const gamma = nd1 * ebrT / (S * rv * Math.sqrt(T));
    const vega  = S * Math.sqrt(T) * nd1 * ebrT / 100;

    setRes({ d1, d2, Nd1, Nd2, price, delta, gamma, theta, vega, rho: rho_val });
  }, [flag, S, K, days, r, v, q]);

  const Slider = ({ label, min, max, step, val, set, fmt }) => (
    <div style={{ background:"#0d0d18", border:"1px solid #1e1e2e", borderRadius:"8px", padding:"12px" }}>
      <label style={LBL}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={val}
        onChange={e => set(parseFloat(e.target.value))}
        style={{ width:"100%", marginBottom:"4px" }}/>
      <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:"16px", fontWeight:"500", color:"#e2e8f0" }}>
        {fmt(val)}
      </div>
    </div>
  );

  const Greek = ({ sym, name, val, color, desc }) => (
    <div style={{ background:"#0d0d18", border:"1px solid #1e1e2e", borderRadius:"8px", padding:"14px" }}>
      <div style={{ fontSize:"18px", color, fontWeight:"500", marginBottom:"2px" }}>{sym}</div>
      <div style={{ fontSize:"9px", color:"#4a5568", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"6px" }}>{name}</div>
      <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:"17px", fontWeight:"500", marginBottom:"6px" }}>
        {val}
      </div>
      <div style={{ fontSize:"9px", color:"#4a5568", lineHeight:"1.5" }}>{desc}</div>
    </div>
  );

  const g = res;

  return (
    <div>
      {/* Formula block */}
      <div style={{ background:"#0d0d18", border:"1px solid #2d2d40", borderRadius:"8px", padding:"16px 20px", marginBottom:"20px", fontFamily:"'DM Mono',monospace", fontSize:"12px", lineHeight:"2.1", color:"#94a3b8", overflowX:"auto", whiteSpace:"pre" }}>
{`d1 = [ln(S/K) + (r − q + σ²/2) × T] / (σ × √T)
d2 = d1 − σ × √T

Call = S × e^(−qT) × N(d1) − K × e^(−rT) × N(d2)
Put  = K × e^(−rT) × N(−d2) − S × e^(−qT) × N(−d1)

Δ Call = e^(−qT) × N(d1)          Δ Put = e^(−qT) × [N(d1) − 1]
Γ      = N'(d1) × e^(−qT) / (S × σ × √T)
Θ      = −[S×N'(d1)×σ×e^(−qT)] / (2√T) − r×K×e^(−rT)×N(d2)   ÷ 365
V      = S × √T × N'(d1) × e^(−qT)   ÷ 100
ρ Call = K × T × e^(−rT) × N(d2)    ÷ 100`}
      </div>

      {/* Call / Put toggle */}
      <div style={{ display:"flex", gap:"8px", marginBottom:"16px" }}>
        {["c","p"].map(f => (
          <button key={f} onClick={() => setFlag(f)} style={{
            padding:"8px 24px", border:`1px solid ${flag===f?"#6366f1":"#2d2d40"}`,
            borderRadius:"6px", background:flag===f?"#6366f1":"transparent",
            color:flag===f?"#fff":"#4a5568", cursor:"pointer", fontSize:"11px",
            letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"'DM Mono',monospace", fontWeight:"600",
          }}>{f==="c"?"Call":"Put"}</button>
        ))}
      </div>

      {/* Sliders */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px", marginBottom:"20px" }}>
        <Slider label="S — Spot Price"         min={10}  max={600} step={1}   val={S}    set={setS}    fmt={v=>`$${v.toFixed(0)}`}/>
        <Slider label="K — Strike Price"        min={10}  max={600} step={1}   val={K}    set={setK}    fmt={v=>`$${v.toFixed(0)}`}/>
        <Slider label="T — Days to Expiry"      min={1}   max={365} step={1}   val={days} set={setDays} fmt={v=>`${v} days`}/>
        <Slider label="r — Risk-free Rate"      min={0}   max={15}  step={0.1} val={r}    set={setR}    fmt={v=>`${v.toFixed(1)}%`}/>
        <Slider label="σ — Implied Volatility"  min={1}   max={150} step={1}   val={v}    set={setV}    fmt={v=>`${v.toFixed(0)}%`}/>
        <Slider label="q — Dividend Yield"      min={0}   max={10}  step={0.1} val={q}    set={setQ}    fmt={v=>`${v.toFixed(1)}%`}/>
      </div>

      {/* Computed values */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"10px", marginBottom:"20px" }}>
        {[
          { l:"d1",       v: g ? g.d1.toFixed(4)  : "—", c:"#6366f1" },
          { l:"d2",       v: g ? g.d2.toFixed(4)  : "—", c:"#8b5cf6" },
          { l:"N(d1)",    v: g ? g.Nd1.toFixed(4) : "—", c:"#94a3b8" },
          { l:`${flag==="c"?"Call":"Put"} Price`, v: g ? `$${g.price.toFixed(4)}` : "—", c:"#10b981" },
        ].map(it => (
          <div key={it.l} style={{ background:"#0d0d18", border:"1px solid #1e1e2e", borderRadius:"8px", padding:"12px" }}>
            <div style={{ fontSize:"9px", color:"#4a5568", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"4px" }}>{it.l}</div>
            <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:"20px", fontWeight:"500", color:it.c }}>{it.v}</div>
          </div>
        ))}
      </div>

      {/* Greeks */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:"10px", marginBottom:"20px" }}>
        <Greek sym="Δ" name="Delta"     color="#6366f1" val={g ? g.delta.toFixed(5) : "—"}               desc={`Price change per $1 move in spot. ~${g?(g.delta*100).toFixed(0):0}% ITM probability.`}/>
        <Greek sym="Γ" name="Gamma"     color="#8b5cf6" val={g ? g.gamma.toFixed(6) : "—"}               desc="Delta sensitivity per $1. Peaks at ATM, spikes near expiry."/>
        <Greek sym="Θ" name="Theta/day" color="#10b981" val={g ? `$${g.theta.toFixed(5)}` : "—"}         desc="Daily time decay. Negative = option loses value each day."/>
        <Greek sym="V" name="Vega/1%σ"  color="#f59e0b" val={g ? `$${g.vega.toFixed(5)}` : "—"}          desc="Price change per 1% IV shift. Sell into high IV."/>
        <Greek sym="ρ" name="Rho/1%r"   color="#06b6d4" val={g ? `$${g.rho.toFixed(5)}` : "—"}           desc="Price change per 1% rate move. Minor for short-dated options."/>
      </div>

      {/* Variable legend */}
      <div style={{ background:"#0d0d18", border:"1px solid #1e1e2e", borderRadius:"8px", padding:"14px 18px", fontSize:"11px", color:"#4a5568", lineHeight:"1.9" }}>
        <span style={{ color:"#e2e8f0" }}>S</span> = Spot Price &nbsp;·&nbsp;
        <span style={{ color:"#e2e8f0" }}>K</span> = Strike Price &nbsp;·&nbsp;
        <span style={{ color:"#e2e8f0" }}>T</span> = Time to expiry (days ÷ 365) &nbsp;·&nbsp;
        <span style={{ color:"#e2e8f0" }}>r</span> = Risk-free rate &nbsp;·&nbsp;
        <span style={{ color:"#e2e8f0" }}>σ</span> = Implied Volatility &nbsp;·&nbsp;
        <span style={{ color:"#e2e8f0" }}>q</span> = Continuous dividend yield<br/>
        <span style={{ color:"#e2e8f0" }}>b</span> = Cost of carry = r − q &nbsp;·&nbsp;
        <span style={{ color:"#e2e8f0" }}>N(x)</span> = Cumulative standard normal CDF &nbsp;·&nbsp;
        <span style={{ color:"#e2e8f0" }}>N'(x)</span> = Standard normal PDF
      </div>
    </div>
  );
}
