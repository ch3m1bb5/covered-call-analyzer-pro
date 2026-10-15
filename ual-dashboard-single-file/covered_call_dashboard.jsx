

// ── Black-Scholes (QuantLib-style) helpers ──────────────────────────────────
function erf(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1; x=Math.abs(x);
  const t=1/(1+p*x);
  const y=1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x);
  return sign*y;
}
function normCDF(x){ return 0.5*(1+erf(x/Math.sqrt(2))); }
function normPDF(x){ return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }

function blackScholes(S,K,T,r,sigma){
  if(T<=0) return {call:Math.max(S-K,0),delta:S>K?1:0,gamma:0,theta:0,vega:0};
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2=d1-sigma*Math.sqrt(T);
  const call=S*normCDF(d1)-K*Math.exp(-r*T)*normCDF(d2);
  const delta=normCDF(d1);
  const gamma=normPDF(d1)/(S*sigma*Math.sqrt(T));
  const theta=(-S*normPDF(d1)*sigma/(2*Math.sqrt(T))-r*K*Math.exp(-r*T)*normCDF(d2))/365;
  const vega=S*normPDF(d1)*Math.sqrt(T)/100;
  return {call,delta,gamma,theta,vega,d1,d2};
}

function findStrikeByDelta(S,T,r,sigma,targetDelta,strikes){
  let best=strikes[0], bestDiff=999;
  for(const K of strikes){
    const {delta}=blackScholes(S,K,T,r,sigma);
    const diff=Math.abs(delta-targetDelta);
    if(diff<bestDiff){bestDiff=diff;best=K;}
  }
  return best;
}

// ── RSI calculator ──────────────────────────────────────────────────────────
function calcRSI(prices, period=14){
  if(prices.length<period+1) return null;
  let gains=0,losses=0;
  for(let i=1;i<=period;i++){
    const d=prices[i]-prices[i-1];
    if(d>0) gains+=d; else losses-=d;
  }
  let avgGain=gains/period, avgLoss=losses/period;
  for(let i=period+1;i<prices.length;i++){
    const d=prices[i]-prices[i-1];
    avgGain=(avgGain*(period-1)+(d>0?d:0))/period;
    avgLoss=(avgLoss*(period-1)+(d<0?-d:0))/period;
  }
  if(avgLoss===0) return 100;
  const rs=avgGain/avgLoss;
  return 100-(100/(1+rs));
}

// ── Simulated historical UAL price data (daily, ~6 months) ──────────────────
function generateUALPrices(){
  // Realistic UAL price path ending near 167.76 (March 2026)
  const seed=[155,158,162,160,157,163,168,172,170,165,
              161,158,155,160,164,167,171,175,173,169,
              166,163,160,157,162,165,169,172,170,167,
              163,160,158,155,159,163,167,170,168,165,
              162,159,163,166,170,173,171,168,165,162,
              159,156,160,164,167,171,174,172,169,166,
              163,161,158,162,165,168,172,170,167,164,
              161,158,155,159,163,167,170,168,165,162,
              159,163,166,170,173,171,168,165,163,167.76];
  return seed;
}

// ── Weekly prices (sample every 5 days) ─────────────────────────────────────
function generateWeeklyPrices(daily){
  const w=[];
  for(let i=0;i<daily.length;i+=5) w.push(daily[i]);
  return w;
}

// ── Resistance levels (historical swing highs) ───────────────────────────────
const RESISTANCE_LEVELS=[
  {price:172, label:"R1 – Jan swing high", strength:"Strong"},
  {price:175, label:"R2 – Dec consolidation zone", strength:"Moderate"},
  {price:180, label:"R3 – Prior breakout level", strength:"Strong"},
  {price:185, label:"R4 – 52-week resistance", strength:"Key"},
  {price:190, label:"R5 – Near cost basis zone", strength:"Moderate"},
  {price:197, label:"Cost Basis", strength:"Target"},
];

// ── Strike ladder ────────────────────────────────────────────────────────────
function buildStrikes(S){
  const base=Math.round(S/5)*5;
  const strikes=[];
  for(let k=base-10;k<=base+50;k+=5) strikes.push(k);
  return strikes;
}

// ── ARIMA-style trend score (simplified AR(1) momentum) ──────────────────────
function arimaScore(prices){
  const n=prices.length;
  const returns=[];
  for(let i=1;i<n;i++) returns.push((prices[i]-prices[i-1])/prices[i-1]);
  const recentRet=returns.slice(-20);
  const avgRet=recentRet.reduce((a,b)=>a+b,0)/recentRet.length;
  const momentum5=(prices[n-1]-prices[n-6])/prices[n-6]*100;
  const momentum20=(prices[n-1]-prices[n-21])/prices[n-21]*100;
  // AR(1) coefficient
  let cov=0,varX=0;
  for(let i=1;i<returns.length;i++){
    cov+=(returns[i]-avgRet)*(returns[i-1]-avgRet);
    varX+=(returns[i-1]-avgRet)**2;
  }
  const ar1=varX>0?cov/varX:0;
  return {momentum5,momentum20,ar1,avgDailyReturn:avgRet*100};
}

// ── Historical volatility ────────────────────────────────────────────────────
function historicalVol(prices, window=30){
  const n=prices.length;
  const logRets=[];
  for(let i=1;i<n;i++) logRets.push(Math.log(prices[i]/prices[i-1]));
  const slice=logRets.slice(-window);
  const mean=slice.reduce((a,b)=>a+b,0)/slice.length;
  const variance=slice.reduce((a,b)=>a+(b-mean)**2,0)/slice.length;
  return Math.sqrt(variance*252);
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function CoveredCallDashboard() {
  const TICKER="UAL";
  const COST_BASIS=197;
  const CURRENT_PRICE=167.76;
  const SHARES=100;
  const RISK_FREE=0.053;
  const DTE=30;
  const T=DTE/365;

  const dailyPrices=generateUALPrices();
  const weeklyPrices=generateWeeklyPrices(dailyPrices);
  const dailyRSI=calcRSI(dailyPrices);
  const weeklyRSI=calcRSI(weeklyPrices);
  const IV=historicalVol(dailyPrices)*1.15; // IV slightly above HV
  const strikes=buildStrikes(CURRENT_PRICE);
  const arima=arimaScore(dailyPrices);

  // Find ~0.20 delta strike
  const delta20Strike=findStrikeByDelta(CURRENT_PRICE,T,RISK_FREE,IV,0.20,strikes);
  const bs=blackScholes(CURRENT_PRICE,delta20Strike,T,RISK_FREE,IV);
  const premium=bs.call;
  const annualizedYield=(premium/CURRENT_PRICE)*(365/DTE)*100;

  // If called away analysis
  const gainLossPerShare=delta20Strike-COST_BASIS;
  const totalPnL=(gainLossPerShare+premium)*SHARES;
  const totalPnLPct=((delta20Strike+premium-COST_BASIS)/COST_BASIS)*100;
  const breakeven=COST_BASIS-premium;

  // Recommendation logic
  const isOverbought=dailyRSI>65;
  const isTrendingStrong=arima.momentum5>3||arima.ar1>0.15;
  const strikeAboveCostBasis=delta20Strike>COST_BASIS;
  const nearResistance=RESISTANCE_LEVELS.some(r=>Math.abs(r.price-delta20Strike)<5);
  const wouldBeHappy=totalPnL>0||strikeAboveCostBasis;

  let recommendation, recColor, recIcon;
  if(!isOverbought&&isTrendingStrong&&!strikeAboveCostBasis){
    recommendation="WAIT — Stock is trending strongly and delta-20 strike is still below your cost basis. Don't cap upside prematurely.";
    recColor="#f59e0b"; recIcon="⏳";
  } else if(isOverbought&&nearResistance&&strikeAboveCostBasis){
    recommendation="FAVORABLE SETUP — RSI elevated, strike aligns with resistance, and you'd lock in a gain above cost basis. Consider selling.";
    recColor="#10b981"; recIcon="✅";
  } else if(!strikeAboveCostBasis){
    recommendation="WAIT — The 0.20 delta strike is below your cost basis. Selling here locks in a loss. Be patient.";
    recColor="#ef4444"; recIcon="🚫";
  } else {
    recommendation="NEUTRAL — Conditions are mixed. Review resistance levels and momentum before acting.";
    recColor="#8b5cf6"; recIcon="⚖️";
  }

  const [aiAnalysis, setAiAnalysis]=useState("");
  const [aiLoading, setAiLoading]=useState(false);

  const fetchAI=useCallback(async()=>{
    setAiLoading(true);
    setAiAnalysis("");
    const prompt=`You are a professional options strategist. Analyze this covered call setup for UAL (United Airlines):

POSITION DATA:
- Ticker: UAL | Shares: 100 | Cost Basis: $${COST_BASIS} | Current Price: $${CURRENT_PRICE}
- Unrealized Loss: $${((CURRENT_PRICE-COST_BASIS)*SHARES).toFixed(0)} (${(((CURRENT_PRICE/COST_BASIS)-1)*100).toFixed(1)}%)

BLACK-SCHOLES ANALYSIS (QuantLib-style):
- DTE: ${DTE} | IV: ${(IV*100).toFixed(1)}% | Risk-Free Rate: ${(RISK_FREE*100).toFixed(1)}%
- Recommended Strike (≈0.20 delta): $${delta20Strike}
- Actual Delta: ${bs.delta.toFixed(3)} | Premium: $${premium.toFixed(2)}/share ($${(premium*100).toFixed(0)} total)
- Theta: $${bs.theta.toFixed(3)}/day | Gamma: ${bs.gamma.toFixed(4)} | Vega: $${bs.vega.toFixed(3)}
- Annualized Yield: ${annualizedYield.toFixed(1)}%

RSI READINGS:
- Daily RSI (14): ${dailyRSI?.toFixed(1)} ${dailyRSI>70?"— OVERBOUGHT":dailyRSI>60?"— Elevated":dailyRSI<40?"— Oversold":"— Neutral"}
- Weekly RSI (14): ${weeklyRSI?.toFixed(1)} ${weeklyRSI>70?"— OVERBOUGHT":weeklyRSI>60?"— Elevated":weeklyRSI<40?"— Oversold":"— Neutral"}

PMDARIMA/AR(1) MOMENTUM ANALYSIS:
- 5-day momentum: ${arima.momentum5.toFixed(2)}%
- 20-day momentum: ${arima.momentum20.toFixed(2)}%
- AR(1) coefficient: ${arima.ar1.toFixed(3)} (>0.1 = trending, <0 = mean-reverting)
- Avg daily return: ${arima.avgDailyReturn.toFixed(3)}%

RESISTANCE LEVELS: ${RESISTANCE_LEVELS.map(r=>`$${r.price}(${r.label})`).join(", ")}
- Nearest resistance above strike: $${RESISTANCE_LEVELS.find(r=>r.price>delta20Strike)?.price||"N/A"}

SCENARIO IF CALLED AWAY AT $${delta20Strike}:
- Capital gain/loss per share: $${gainLossPerShare.toFixed(2)}
- Premium collected: $${(premium*100).toFixed(2)} total
- Total P&L: $${totalPnL.toFixed(0)} (${totalPnLPct.toFixed(1)}% return on cost basis)
- Breakeven (with premium): $${breakeven.toFixed(2)}

Give a structured analysis in 4 sections:
1. TIMING VERDICT (1-2 sentences: should they sell now or wait?)
2. KEY RISKS (2-3 bullet points)
3. ALTERNATIVE STRATEGY (if not ideal timing, what should they do instead?)
4. BOTTOM LINE (one bold sentence)

Be direct. Don't hedge everything. Make a call.`;

    try {
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          // Cada usuario coloca a PROPRIA chave no arquivo .env (VITE_ANTHROPIC_API_KEY)
          "x-api-key":import.meta.env.VITE_ANTHROPIC_API_KEY,
          "anthropic-version":"2023-06-01",
          "anthropic-dangerous-direct-browser-access":"true"
        },
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          messages:[{role:"user",content:prompt}]
        })
      });
      const data=await res.json();
      const text=data.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"Analysis unavailable.";
      setAiAnalysis(text);
    } catch(e){
      setAiAnalysis("Unable to fetch AI analysis. Please check your connection.");
    }
    setAiLoading(false);
  },[]);

  useEffect(()=>{fetchAI();},[]);

  // Sparkline path
  const sparkPath=(prices,w,h)=>{
    const min=Math.min(...prices), max=Math.max(...prices);
    const pts=prices.map((p,i)=>{
      const x=(i/(prices.length-1))*w;
      const y=h-((p-min)/(max-min))*h;
      return `${x},${y}`;
    });
    return "M"+pts.join("L");
  };

  const chartPrices=dailyPrices;
  const sparkW=280, sparkH=60;
  const path=sparkPath(chartPrices,sparkW,sparkH);
  const costY=sparkH-((COST_BASIS-Math.min(...chartPrices))/(Math.max(...chartPrices)-Math.min(...chartPrices)))*sparkH;
  const currentY=sparkH-((CURRENT_PRICE-Math.min(...chartPrices))/(Math.max(...chartPrices)-Math.min(...chartPrices)))*sparkH;

  const rsiColor=(r)=>r>70?"#ef4444":r>60?"#f59e0b":r<40?"#06b6d4":"#10b981";

  return (
    <div style={{
      fontFamily:"'DM Mono', 'Courier New', monospace",
      background:"#0a0a0f",
      minHeight:"100vh",
      color:"#e2e8f0",
      padding:"24px",
      maxWidth:"960px",
      margin:"0 auto"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap');
        .card{background:#13131f;border:1px solid #1e1e2e;border-radius:12px;padding:20px;}
        .card-dark{background:#0d0d18;border:1px solid #1a1a2e;border-radius:12px;padding:20px;}
        .label{font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#4a5568;margin-bottom:4px;}
        .value{font-size:22px;font-weight:500;font-family:'Space Grotesk',sans-serif;}
        .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;}
        .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
        .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
        .section-title{font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#4a5568;margin-bottom:12px;border-bottom:1px solid #1e1e2e;padding-bottom:8px;}
        .greek{background:#0d0d18;border:1px solid #1a1a2e;border-radius:8px;padding:12px;text-align:center;}
        .rsi-bar{height:6px;background:#1e1e2e;border-radius:3px;overflow:hidden;margin-top:6px;}
        .rsi-fill{height:100%;border-radius:3px;transition:width 0.5s;}
        .ai-text{font-size:13px;line-height:1.7;color:#94a3b8;white-space:pre-wrap;}
        .pulse{animation:pulse 2s infinite;}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
        .resist-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1a1a2e;}
        .resist-row:last-child{border:none;}
        .progress-track{background:#1e1e2e;border-radius:3px;height:3px;flex:1;margin:0 10px;}
        .tick{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
      `}</style>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"24px"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
            <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"28px",fontWeight:"700",letterSpacing:"-0.02em"}}>
              {TICKER}
            </span>
            <span className="badge" style={{background:"#1a1a2e",color:"#64748b",border:"1px solid #2d2d40"}}>
              COVERED CALL ANALYZER
            </span>
          </div>
          <div style={{fontSize:"12px",color:"#4a5568",marginTop:"4px"}}>
            United Airlines Holdings • 100 shares • DTE {DTE}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div className="label">CURRENT</div>
          <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"32px",fontWeight:"700",color:"#e2e8f0",letterSpacing:"-0.02em"}}>
            ${CURRENT_PRICE}
          </div>
          <div style={{fontSize:"12px",color:"#ef4444"}}>
            ↓ ${(COST_BASIS-CURRENT_PRICE).toFixed(2)} below cost basis
          </div>
        </div>
      </div>

      {/* Recommendation Banner */}
      <div style={{
        background:`${recColor}15`,
        border:`1px solid ${recColor}40`,
        borderRadius:"12px",
        padding:"16px 20px",
        marginBottom:"20px",
        display:"flex",
        alignItems:"flex-start",
        gap:"12px"
      }}>
        <span style={{fontSize:"20px"}}>{recIcon}</span>
        <div>
          <div style={{fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",color:`${recColor}`,marginBottom:"4px",fontWeight:"600"}}>
            System Recommendation
          </div>
          <div style={{fontSize:"14px",color:"#e2e8f0",lineHeight:"1.5"}}>{recommendation}</div>
        </div>
      </div>

      {/* Row 1: Price chart + Position summary */}
      <div className="grid2" style={{marginBottom:"16px"}}>
        {/* Sparkline */}
        <div className="card">
          <div className="section-title">Price History (90d)</div>
          <svg width="100%" viewBox={`0 0 ${sparkW} ${sparkH+10}`} style={{overflow:"visible"}}>
            <defs>
              <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3"/>
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0"/>
              </linearGradient>
            </defs>
            <path d={path+"V"+(sparkH)+"H0Z"} fill="url(#sparkGrad)"/>
            <path d={path} fill="none" stroke="#6366f1" strokeWidth="1.5"/>
            {/* Cost basis line */}
            <line x1="0" y1={costY} x2={sparkW} y2={costY} stroke="#ef4444" strokeWidth="1" strokeDasharray="4,3" opacity="0.7"/>
            <text x={sparkW-2} y={costY-3} fontSize="7" fill="#ef4444" textAnchor="end">Cost $197</text>
            {/* Strike line */}
            {(() => {
              const strikeY=sparkH-((delta20Strike-Math.min(...chartPrices))/(Math.max(...chartPrices)-Math.min(...chartPrices)))*sparkH;
              return <>
                <line x1="0" y1={strikeY} x2={sparkW} y2={strikeY} stroke="#10b981" strokeWidth="1" strokeDasharray="4,3" opacity="0.7"/>
                <text x={sparkW-2} y={strikeY-3} fontSize="7" fill="#10b981" textAnchor="end">Strike ${delta20Strike}</text>
              </>;
            })()}
          </svg>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:"8px"}}>
            <span style={{fontSize:"11px",color:"#4a5568"}}>← 90 days ago</span>
            <span style={{fontSize:"11px",color:"#4a5568"}}>Today →</span>
          </div>
        </div>

        {/* Position summary */}
        <div className="card">
          <div className="section-title">Position Summary</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
            {[
              {label:"Cost Basis",value:`$${COST_BASIS}`,color:"#ef4444"},
              {label:"Breakeven",value:`$${breakeven.toFixed(2)}`,color:"#f59e0b"},
              {label:"Unrealized P&L",value:`-$${((COST_BASIS-CURRENT_PRICE)*SHARES).toFixed(0)}`,color:"#ef4444"},
              {label:"Premium Yield",value:`${annualizedYield.toFixed(1)}% ann.`,color:"#10b981"},
            ].map(item=>(
              <div key={item.label} style={{background:"#0d0d18",borderRadius:"8px",padding:"12px"}}>
                <div className="label">{item.label}</div>
                <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"600",color:item.color}}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
          <div style={{marginTop:"12px",background:"#0d0d18",borderRadius:"8px",padding:"12px",borderLeft:"3px solid #6366f1"}}>
            <div className="label">If Called Away at ${delta20Strike}</div>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"16px",fontWeight:"600",color:totalPnL>=0?"#10b981":"#ef4444"}}>
              {totalPnL>=0?"+":" "}${totalPnL.toFixed(0)} total ({totalPnLPct.toFixed(1)}%)
            </div>
            <div style={{fontSize:"11px",color:"#4a5568",marginTop:"2px"}}>
              Capital {gainLossPerShare>=0?"gain":"loss"} ${Math.abs(gainLossPerShare*100).toFixed(0)} + premium ${(premium*100).toFixed(0)}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: RSI + Greeks */}
      <div className="grid2" style={{marginBottom:"16px"}}>
        {/* RSI */}
        <div className="card">
          <div className="section-title">RSI Analysis</div>
          {[
            {label:"Daily RSI (14)",value:dailyRSI,tf:"Daily"},
            {label:"Weekly RSI (14)",value:weeklyRSI,tf:"Weekly"},
          ].map(r=>(
            <div key={r.tf} style={{marginBottom:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
                <span style={{fontSize:"12px",color:"#94a3b8"}}>{r.label}</span>
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"20px",fontWeight:"600",color:rsiColor(r.value)}}>
                    {r.value?.toFixed(1)}
                  </span>
                  <span className="badge" style={{
                    background:r.value>70?"#ef444420":r.value>60?"#f59e0b20":r.value<40?"#06b6d420":"#10b98120",
                    color:rsiColor(r.value),
                    border:`1px solid ${rsiColor(r.value)}40`
                  }}>
                    {r.value>70?"Overbought":r.value>60?"Elevated":r.value<40?"Oversold":"Neutral"}
                  </span>
                </div>
              </div>
              <div className="rsi-bar">
                <div className="rsi-fill" style={{width:`${r.value}%`,background:rsiColor(r.value)}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:"2px"}}>
                <span style={{fontSize:"9px",color:"#2d3748"}}>0 — Oversold</span>
                <span style={{fontSize:"9px",color:"#2d3748"}}>70 — Overbought — 100</span>
              </div>
            </div>
          ))}
          <div style={{background:"#0d0d18",borderRadius:"8px",padding:"10px",marginTop:"4px"}}>
            <div className="label">RSI Signal</div>
            <div style={{fontSize:"12px",color:"#94a3b8",marginTop:"4px"}}>
              {dailyRSI>70?"⚠️ Daily overbought — favorable for call selling":
               dailyRSI>60?"📊 Daily elevated — approaching overbought territory":
               dailyRSI<40?"📉 Oversold daily — avoid selling calls; stock may bounce":
               "😐 RSI neutral — neither overbought nor oversold on daily"}
            </div>
          </div>
        </div>

        {/* Greeks */}
        <div className="card">
          <div className="section-title">Black-Scholes Greeks · ${delta20Strike} Strike</div>
          <div className="grid2" style={{gap:"8px",marginBottom:"12px"}}>
            {[
              {name:"Δ Delta",value:bs.delta.toFixed(3),desc:"Prob. ITM",color:"#6366f1"},
              {name:"Γ Gamma",value:bs.gamma.toFixed(4),desc:"Delta sensitivity",color:"#8b5cf6"},
              {name:"Θ Theta",value:`$${Math.abs(bs.theta).toFixed(3)}`,desc:"Daily decay",color:"#10b981"},
              {name:"V Vega",value:`$${bs.vega.toFixed(3)}`,desc:"Per 1% IV move",color:"#f59e0b"},
            ].map(g=>(
              <div key={g.name} className="greek">
                <div style={{fontSize:"11px",color:g.color,fontWeight:"600",marginBottom:"2px"}}>{g.name}</div>
                <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700"}}>{g.value}</div>
                <div style={{fontSize:"9px",color:"#4a5568",marginTop:"2px"}}>{g.desc}</div>
              </div>
            ))}
          </div>
          <div style={{background:"#0d0d18",borderRadius:"8px",padding:"12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div className="label">Premium Collected</div>
                <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"24px",fontWeight:"700",color:"#10b981"}}>
                  ${premium.toFixed(2)}<span style={{fontSize:"14px",color:"#4a5568"}}>/share</span>
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div className="label">Total (100 shares)</div>
                <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"24px",fontWeight:"700",color:"#10b981"}}>
                  ${(premium*100).toFixed(0)}
                </div>
              </div>
            </div>
            <div style={{marginTop:"8px",fontSize:"11px",color:"#4a5568"}}>
              IV: {(IV*100).toFixed(1)}% · HV30: {(IV/1.15*100).toFixed(1)}% · IV Premium: {((IV/1.15-1)*100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Resistance + ARIMA */}
      <div className="grid2" style={{marginBottom:"16px"}}>
        {/* Resistance */}
        <div className="card">
          <div className="section-title">Resistance Map</div>
          {RESISTANCE_LEVELS.map(r=>{
            const pct=((r.price-CURRENT_PRICE)/CURRENT_PRICE*100);
            const isStrike=Math.abs(r.price-delta20Strike)<1;
            const isCost=r.price===COST_BASIS;
            return (
              <div key={r.price} className="resist-row" style={{opacity:r.price<CURRENT_PRICE?0.4:1}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px",minWidth:"120px"}}>
                  <div className="tick" style={{
                    background:isCost?"#ef4444":isStrike?"#10b981":
                    r.strength==="Key"?"#f59e0b":r.strength==="Strong"?"#6366f1":"#4a5568"
                  }}/>
                  <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:"600",fontSize:"14px"}}>${r.price}</span>
                </div>
                <div className="progress-track">
                  <div style={{height:"100%",width:`${Math.min(Math.abs(pct)*5,100)}%`,
                    background:isCost?"#ef4444":isStrike?"#10b981":"#6366f1",borderRadius:"3px"}}/>
                </div>
                <div style={{textAlign:"right",minWidth:"90px"}}>
                  <div style={{fontSize:"10px",color:"#94a3b8"}}>{r.label.split("–")[0]}</div>
                  <div style={{fontSize:"10px",color:"#4a5568"}}>+{pct.toFixed(1)}%</div>
                </div>
                {isStrike&&<span className="badge" style={{background:"#10b98120",color:"#10b981",border:"1px solid #10b98140",marginLeft:"4px"}}>STRIKE</span>}
              </div>
            );
          })}
        </div>

        {/* ARIMA/Momentum */}
        <div className="card">
          <div className="section-title">ARIMA Momentum Analysis</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"12px"}}>
            {[
              {label:"5-Day Momentum",value:`${arima.momentum5>=0?"+":""}${arima.momentum5.toFixed(2)}%`,
                color:arima.momentum5>2?"#10b981":arima.momentum5<-2?"#ef4444":"#f59e0b"},
              {label:"20-Day Momentum",value:`${arima.momentum20>=0?"+":""}${arima.momentum20.toFixed(2)}%`,
                color:arima.momentum20>5?"#10b981":arima.momentum20<-5?"#ef4444":"#f59e0b"},
              {label:"AR(1) Coefficient",value:arima.ar1.toFixed(3),
                color:arima.ar1>0.1?"#10b981":arima.ar1<-0.1?"#ef4444":"#94a3b8",
                desc:arima.ar1>0.1?"Trending":"Mean-reverting"},
              {label:"Avg Daily Return",value:`${arima.avgDailyReturn.toFixed(3)}%`,
                color:arima.avgDailyReturn>0?"#10b981":"#ef4444"},
            ].map(m=>(
              <div key={m.label} style={{background:"#0d0d18",borderRadius:"8px",padding:"12px"}}>
                <div className="label">{m.label}</div>
                <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"600",color:m.color}}>{m.value}</div>
                {m.desc&&<div style={{fontSize:"9px",color:"#4a5568",marginTop:"2px"}}>{m.desc}</div>}
              </div>
            ))}
          </div>
          <div style={{background:"#0d0d18",borderRadius:"8px",padding:"12px",borderLeft:"3px solid #8b5cf6"}}>
            <div className="label">Trend Assessment</div>
            <div style={{fontSize:"12px",color:"#94a3b8",marginTop:"4px",lineHeight:"1.5"}}>
              {arima.ar1>0.1&&arima.momentum20>3
                ?"📈 Strong uptrend detected. AR(1) persistence + positive momentum suggest capping upside now carries meaningful opportunity cost."
                :arima.ar1<0&&arima.momentum5<-1
                ?"📉 Mean-reverting with negative short-term momentum. Caution — could bounce, weakening call premium rationale."
                :"➡️ Mixed signals. Momentum is not decisively trending. Neutral from a timing perspective."}
            </div>
          </div>
        </div>
      </div>

      {/* AI Analysis */}
      <div className="card-dark" style={{marginBottom:"16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
          <div className="section-title" style={{marginBottom:0}}>AI Options Strategist Analysis</div>
          <button onClick={fetchAI} style={{
            background:"#1e1e2e",border:"1px solid #2d2d40",borderRadius:"6px",
            color:"#94a3b8",fontSize:"10px",padding:"4px 12px",cursor:"pointer",
            letterSpacing:"0.1em",textTransform:"uppercase"
          }}>↺ Refresh</button>
        </div>
        {aiLoading
          ? <div style={{display:"flex",alignItems:"center",gap:"8px",color:"#4a5568"}}>
              <span className="pulse">●</span>
              <span style={{fontSize:"12px"}}>Analyzing position with Black-Scholes + momentum data...</span>
            </div>
          : <div className="ai-text">{aiAnalysis}</div>
        }
      </div>

      {/* Strike Ladder */}
      <div className="card">
        <div className="section-title">Strike Ladder · 30 DTE · {(IV*100).toFixed(1)}% IV</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}>
            <thead>
              <tr style={{color:"#4a5568",borderBottom:"1px solid #1e1e2e"}}>
                {["Strike","Delta","Premium","$/Share Yield","Ann. Yield","vs Cost Basis",""].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"right",fontWeight:"400",letterSpacing:"0.05em",fontSize:"10px",textTransform:"uppercase"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strikes.filter(k=>k>=CURRENT_PRICE*0.95&&k<=CURRENT_PRICE*1.25).map(k=>{
                const b=blackScholes(CURRENT_PRICE,k,T,RISK_FREE,IV);
                const yld=(b.call/CURRENT_PRICE)*100;
                const annYld=yld*(365/DTE);
                const isSelected=k===delta20Strike;
                return (
                  <tr key={k} style={{
                    borderBottom:"1px solid #0d0d18",
                    background:isSelected?"#6366f115":"transparent",
                    color:isSelected?"#e2e8f0":"#94a3b8"
                  }}>
                    <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"'Space Grotesk',sans-serif",fontWeight:isSelected?"600":"400",color:isSelected?"#6366f1":"inherit"}}>
                      ${k}{isSelected&&" ★"}
                    </td>
                    <td style={{padding:"7px 10px",textAlign:"right"}}>{b.delta.toFixed(3)}</td>
                    <td style={{padding:"7px 10px",textAlign:"right"}}>${b.call.toFixed(2)}</td>
                    <td style={{padding:"7px 10px",textAlign:"right"}}>{yld.toFixed(2)}%</td>
                    <td style={{padding:"7px 10px",textAlign:"right",color:annYld>15?"#10b981":annYld>8?"#f59e0b":"#94a3b8"}}>{annYld.toFixed(1)}%</td>
                    <td style={{padding:"7px 10px",textAlign:"right",color:k>=COST_BASIS?"#10b981":"#ef4444"}}>
                      {k>=COST_BASIS?"Above ✓":`-$${(COST_BASIS-k).toFixed(0)}`}
                    </td>
                    <td style={{padding:"7px 10px",textAlign:"right"}}>
                      {b.delta<0.25&&b.delta>0.15&&<span className="badge" style={{background:"#10b98115",color:"#10b981",border:"1px solid #10b98130"}}>~0.20Δ</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{textAlign:"center",marginTop:"20px",fontSize:"10px",color:"#2d3748",letterSpacing:"0.1em"}}>
        UAL COVERED CALL ANALYZER · BLACK-SCHOLES PRICING · AR(1) MOMENTUM · {new Date().toLocaleDateString()}
      </div>
    </div>
  );
}
