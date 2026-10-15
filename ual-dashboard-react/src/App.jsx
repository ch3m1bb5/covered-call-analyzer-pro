import { useState, useEffect, useCallback } from "react";

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
  if(T<=0) return {call:Math.max(S-K,0),put:Math.max(K-S,0),delta:S>K?1:0,gamma:0,theta:0,vega:0,d1:0,d2:0};
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
  const d2=d1-sigma*Math.sqrt(T);
  const call=S*normCDF(d1)-K*Math.exp(-r*T)*normCDF(d2);
  const put=K*Math.exp(-r*T)*normCDF(-d2)-S*normCDF(-d1);
  const delta=normCDF(d1);
  const gamma=normPDF(d1)/(S*sigma*Math.sqrt(T));
  const theta=(-S*normPDF(d1)*sigma/(2*Math.sqrt(T))-r*K*Math.exp(-r*T)*normCDF(d2))/365;
  const vega=S*normPDF(d1)*Math.sqrt(T)/100;
  return {call,put,delta,gamma,theta,vega,d1,d2};
}

function impliedVol(S,K,T,r,marketPrice){
  let low=0.001,high=5.0;
  for(let i=0;i<100;i++){
    const mid=(low+high)/2;
    const price=blackScholes(S,K,T,r,mid).call;
    if(Math.abs(price-marketPrice)<0.0001) return mid;
    if(price>marketPrice) high=mid; else low=mid;
  }
  return (low+high)/2;
}

function calcRSI(prices,period=14){
  if(prices.length<period+1) return null;
  let gains=0,losses=0;
  for(let i=1;i<=period;i++){
    const d=prices[i]-prices[i-1];
    if(d>0) gains+=d; else losses-=d;
  }
  let avgGain=gains/period,avgLoss=losses/period;
  for(let i=period+1;i<prices.length;i++){
    const d=prices[i]-prices[i-1];
    avgGain=(avgGain*(period-1)+(d>0?d:0))/period;
    avgLoss=(avgLoss*(period-1)+(d<0?-d:0))/period;
  }
  if(avgLoss===0) return 100;
  return 100-(100/(1+avgGain/avgLoss));
}

// ── Fetch real price history from Yahoo Finance via allorigins proxy ──────────
async function fetchYahooPrices(ticker){
  const end=Math.floor(Date.now()/1000);
  const start=end-(90*24*60*60);
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${start}&period2=${end}`;
  const proxy=`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const res=await fetch(proxy);
  const json=await res.json();
  const data=JSON.parse(json.contents);
  const closes=data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  if(!closes||closes.length===0) throw new Error("No price data");
  return closes.filter(p=>p!=null).map(p=>parseFloat(p.toFixed(2)));
}

function generateWeeklyPrices(daily){
  const w=[];
  for(let i=0;i<daily.length;i+=5) w.push(daily[i]);
  return w;
}

function buildStrikes(S){
  const base=Math.round(S/5)*5;
  const strikes=[];
  for(let k=base-10;k<=base+50;k+=5) strikes.push(k);
  return strikes;
}

function arimaScore(prices){
  const n=prices.length;
  const returns=[];
  for(let i=1;i<n;i++) returns.push((prices[i]-prices[i-1])/prices[i-1]);
  const recentRet=returns.slice(-20);
  const avgRet=recentRet.reduce((a,b)=>a+b,0)/recentRet.length;
  const momentum5=(prices[n-1]-prices[Math.max(0,n-6)])/prices[Math.max(0,n-6)]*100;
  const momentum20=(prices[n-1]-prices[Math.max(0,n-21)])/prices[Math.max(0,n-21)]*100;
  let cov=0,varX=0;
  for(let i=1;i<returns.length;i++){
    cov+=(returns[i]-avgRet)*(returns[i-1]-avgRet);
    varX+=(returns[i-1]-avgRet)**2;
  }
  const ar1=varX>0?cov/varX:0;
  return {momentum5,momentum20,ar1,avgDailyReturn:avgRet*100};
}

function historicalVol(prices,window=30){
  const logRets=[];
  for(let i=1;i<prices.length;i++) logRets.push(Math.log(prices[i]/prices[i-1]));
  const slice=logRets.slice(-window);
  const mean=slice.reduce((a,b)=>a+b,0)/slice.length;
  const variance=slice.reduce((a,b)=>a+(b-mean)**2,0)/slice.length;
  return Math.sqrt(variance*252);
}

// fallback simulated prices if fetch fails
function generateFallbackPrices(currentPrice){
  const prices=[];
  let p=currentPrice*0.92;
  for(let i=0;i<89;i++){
    p+=(Math.random()-0.48)*p*0.012;
    prices.push(parseFloat(p.toFixed(2)));
  }
  prices.push(currentPrice);
  return prices;
}

const inputStyle={background:"#0d0d18",border:"1px solid #2d2d40",borderRadius:"6px",color:"#e2e8f0",padding:"8px 10px",fontSize:"13px",width:"100%",fontFamily:"'DM Mono','Courier New',monospace",outline:"none",boxSizing:"border-box"};
const labelStyle={fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#4a5568",marginBottom:"4px",display:"block"};

export default function CoveredCallDashboard(){
  const [form,setForm]=useState({ticker:"UAL",currentPrice:"167.76",costBasis:"197",shares:"100",strike:"175",premium:"2.50",dte:"30",iv:""});
  const [submitted,setSubmitted]=useState(false);
  const [params,setParams]=useState(null);
  const [aiAnalysis,setAiAnalysis]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [priceLoading,setPriceLoading]=useState(false);
  const [priceSource,setPriceSource]=useState("simulated");

  const handleChange=e=>setForm(f=>({...f,[e.target.name]:e.target.value}));

  const handleSubmit=async()=>{
    const S=parseFloat(form.currentPrice),K=parseFloat(form.strike),COST=parseFloat(form.costBasis);
    const SHARES=parseInt(form.shares),PREM=parseFloat(form.premium),DTE=parseInt(form.dte);
    if(!S||!K||!COST||!SHARES||!PREM||!DTE) return;

    setPriceLoading(true);
    let dailyPrices;
    let source="simulated";

    try{
      dailyPrices=await fetchYahooPrices(form.ticker.toUpperCase());
      source="live";
    }catch(e){
      console.warn("Yahoo fetch failed, using simulated prices",e);
      dailyPrices=generateFallbackPrices(S);
      source="simulated";
    }

    // override last price with user-entered current price for accuracy
    dailyPrices[dailyPrices.length-1]=S;

    const IV=form.iv?parseFloat(form.iv)/100:historicalVol(dailyPrices)*1.15;
    setParams({TICKER:form.ticker.toUpperCase()||"CUSTOM",S,K,COST,SHARES,PREM,DTE,IV,dailyPrices});
    setPriceSource(source);
    setSubmitted(true);
    setAiAnalysis("");
    setPriceLoading(false);
  };

  const handleReset=()=>{setSubmitted(false);setParams(null);setAiAnalysis("");setPriceSource("simulated");};

  useEffect(()=>{if(submitted&&params)fetchAI();},[submitted,params]);

  const fetchAI=useCallback(async()=>{
    if(!params) return;
    const {TICKER,S,K,COST,SHARES,PREM,DTE,IV}=params;
    const T=DTE/365;
    const bs=blackScholes(S,K,T,0.053,IV);
    const fairValue=bs.call;
    const priceDiff=PREM-fairValue;
    const annualizedYield=(PREM/S)*(365/DTE)*100;
    const gainLoss=K-COST;
    const totalPnL=(gainLoss+PREM)*SHARES;
    const totalPnLPct=((K+PREM-COST)/COST)*100;
    const breakeven=COST-PREM;
    const dailyRSI=calcRSI(params.dailyPrices);
    const weeklyRSI=calcRSI(generateWeeklyPrices(params.dailyPrices));
    const arima=arimaScore(params.dailyPrices);
    const impliedIV=impliedVol(S,K,T,0.053,PREM)*100;

    setAiLoading(true);
    setAiAnalysis("");

    const prompt=`You are a professional options strategist. Analyze this covered call setup for ${TICKER}:

POSITION DATA:
- Ticker: ${TICKER} | Shares: ${SHARES} | Cost Basis: $${COST} | Current Price: $${S}
- Unrealized P&L: $${((S-COST)*SHARES).toFixed(0)} (${(((S/COST)-1)*100).toFixed(1)}%)

OPTION FAIR VALUE ANALYSIS (Black-Scholes):
- BS Fair Value: $${fairValue.toFixed(2)} | Market Premium: $${PREM} | Difference: ${priceDiff>=0?"overpriced by":"underpriced by"} $${Math.abs(priceDiff).toFixed(2)}
- Implied IV from market price: ${impliedIV.toFixed(1)}% | Model IV: ${(IV*100).toFixed(1)}%
- Strike: $${K} | DTE: ${DTE}
- Delta: ${bs.delta.toFixed(3)} | Theta: $${Math.abs(bs.theta).toFixed(3)}/day | Vega: $${bs.vega.toFixed(3)}
- Annualized Yield: ${annualizedYield.toFixed(1)}%
- Breakeven: $${breakeven.toFixed(2)}

MOMENTUM (from ${priceSource} price data):
- Daily RSI: ${dailyRSI?.toFixed(1)} | Weekly RSI: ${weeklyRSI?.toFixed(1)}
- 5-day momentum: ${arima.momentum5.toFixed(2)}% | 20-day: ${arima.momentum20.toFixed(2)}%
- AR(1): ${arima.ar1.toFixed(3)}

SCENARIO IF CALLED AWAY AT $${K}:
- Total P&L: $${totalPnL.toFixed(0)} (${totalPnLPct.toFixed(1)}% on cost basis)

Give a structured analysis in 4 sections:
1. TIMING VERDICT
2. KEY RISKS
3. ALTERNATIVE STRATEGY
4. BOTTOM LINE

Be direct. Make a call.`;

    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":import.meta.env.VITE_ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages:[{role:"user",content:prompt}]})
      });
      const data=await res.json();
      setAiAnalysis(data.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"Analysis unavailable.");
    }catch(e){
      setAiAnalysis("Unable to fetch AI analysis. Please check your connection.");
    }
    setAiLoading(false);
  },[params]);

  // ── FORM ──────────────────────────────────────────────────────────────────
  if(!submitted){
    return(
      <div style={{fontFamily:"'DM Mono','Courier New',monospace",background:"#0a0a0f",minHeight:"100vh",color:"#e2e8f0",padding:"24px",maxWidth:"640px",margin:"0 auto"}}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap'); input:focus{border-color:#6366f1!important;}`}</style>
        <div style={{marginBottom:"32px"}}>
          <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"24px",fontWeight:"700",marginBottom:"4px"}}>Covered Call Analyzer</div>
          <div style={{fontSize:"12px",color:"#4a5568"}}>Enter your position details · live price data via Yahoo Finance</div>
        </div>
        <div style={{background:"#13131f",border:"1px solid #1e1e2e",borderRadius:"12px",padding:"24px",marginBottom:"16px"}}>
          <div style={{fontSize:"11px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a5568",marginBottom:"16px",borderBottom:"1px solid #1e1e2e",paddingBottom:"8px"}}>Position</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
            <div><label style={labelStyle}>Ticker</label><input style={inputStyle} name="ticker" value={form.ticker} onChange={handleChange} placeholder="e.g. AAPL"/></div>
            <div><label style={labelStyle}>Shares</label><input style={inputStyle} name="shares" value={form.shares} onChange={handleChange} placeholder="100"/></div>
            <div><label style={labelStyle}>Current Price ($)</label><input style={inputStyle} name="currentPrice" value={form.currentPrice} onChange={handleChange} placeholder="167.76"/></div>
            <div><label style={labelStyle}>Cost Basis ($)</label><input style={inputStyle} name="costBasis" value={form.costBasis} onChange={handleChange} placeholder="197.00"/></div>
          </div>
        </div>
        <div style={{background:"#13131f",border:"1px solid #1e1e2e",borderRadius:"12px",padding:"24px",marginBottom:"16px"}}>
          <div style={{fontSize:"11px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a5568",marginBottom:"16px",borderBottom:"1px solid #1e1e2e",paddingBottom:"8px"}}>Option Details</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>
            <div><label style={labelStyle}>Strike Price ($)</label><input style={inputStyle} name="strike" value={form.strike} onChange={handleChange} placeholder="175"/></div>
            <div><label style={labelStyle}>Market Premium ($/share)</label><input style={inputStyle} name="premium" value={form.premium} onChange={handleChange} placeholder="2.50"/></div>
            <div><label style={labelStyle}>Days to Expiration</label><input style={inputStyle} name="dte" value={form.dte} onChange={handleChange} placeholder="30"/></div>
            <div><label style={labelStyle}>IV % (optional)</label><input style={inputStyle} name="iv" value={form.iv} onChange={handleChange} placeholder="Auto-calculate"/></div>
          </div>
        </div>
        <button onClick={handleSubmit} disabled={priceLoading} style={{width:"100%",padding:"14px",background:priceLoading?"#2d2d40":"#6366f1",border:"none",borderRadius:"8px",color:"#fff",fontSize:"13px",fontWeight:"600",cursor:priceLoading?"not-allowed":"pointer",letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"'DM Mono','Courier New',monospace"}}>
          {priceLoading?"⏳ Fetching price data...":"Analyze Position →"}
        </button>
      </div>
    );
  }

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  const {TICKER,S,K,COST,SHARES,PREM,DTE,IV,dailyPrices}=params;
  const T=DTE/365;
  const RISK_FREE=0.053;
  const bs=blackScholes(S,K,T,RISK_FREE,IV);
  const fairValue=bs.call;
  const priceDiff=PREM-fairValue;
  const priceDiffPct=(priceDiff/fairValue)*100;
  const impliedIV=impliedVol(S,K,T,RISK_FREE,PREM)*100;
  const annualizedYield=(PREM/S)*(365/DTE)*100;
  const fairValueYield=(fairValue/S)*(365/DTE)*100;
  const gainLossPerShare=K-COST;
  const totalPnL=(gainLossPerShare+PREM)*SHARES;
  const totalPnLPct=((K+PREM-COST)/COST)*100;
  const breakeven=COST-PREM;
  const weeklyPrices=generateWeeklyPrices(dailyPrices);
  const dailyRSI=calcRSI(dailyPrices);
  const weeklyRSI=calcRSI(weeklyPrices);
  const arima=arimaScore(dailyPrices);
  const strikes=buildStrikes(S);
  const isOverpriced=priceDiff>0;
  const isSignificantMispricing=Math.abs(priceDiffPct)>10;

  const resistanceLevels=[
    {price:parseFloat((S*1.025).toFixed(2)),label:"R1 – Near-term",strength:"Moderate"},
    {price:parseFloat((S*1.05).toFixed(2)),label:"R2 – Mid",strength:"Strong"},
    {price:parseFloat((S*1.10).toFixed(2)),label:"R3 – Upper",strength:"Strong"},
    {price:parseFloat((S*1.15).toFixed(2)),label:"R4 – Key",strength:"Key"},
    {price:COST,label:"Cost Basis",strength:"Target"},
  ].sort((a,b)=>a.price-b.price);

  const isOverbought=dailyRSI>65;
  const isTrendingStrong=arima.momentum5>3||arima.ar1>0.15;
  const strikeAboveCostBasis=K>COST;
  const nearResistance=resistanceLevels.some(r=>Math.abs(r.price-K)<S*0.03);

  let recommendation,recColor,recIcon;
  if(!isOverbought&&isTrendingStrong&&!strikeAboveCostBasis){
    recommendation="WAIT — Stock is trending strongly and strike is still below your cost basis. Don't cap upside prematurely.";
    recColor="#f59e0b"; recIcon="⏳";
  } else if(isOverbought&&nearResistance&&strikeAboveCostBasis){
    recommendation="FAVORABLE SETUP — RSI elevated, strike aligns with resistance, and you'd lock in a gain above cost basis.";
    recColor="#10b981"; recIcon="✅";
  } else if(!strikeAboveCostBasis){
    recommendation="WAIT — Strike is below your cost basis. Selling here locks in a loss. Be patient.";
    recColor="#ef4444"; recIcon="🚫";
  } else {
    recommendation="NEUTRAL — Conditions are mixed. Review resistance levels and momentum before acting.";
    recColor="#8b5cf6"; recIcon="⚖️";
  }

  // sparkline
  const sparkW=400,sparkH=80;
  const minP=Math.min(...dailyPrices),maxP=Math.max(...dailyPrices);
  const px=(p)=>Math.max(0,Math.min(sparkH,sparkH-((p-minP)/(maxP-minP||1))*sparkH));
  const sparkPath=dailyPrices.map((p,i)=>`${i===0?"M":"L"}${(i/(dailyPrices.length-1))*sparkW},${px(p)}`).join("");
  const areaPath=sparkPath+`L${sparkW},${sparkH} L0,${sparkH}Z`;
  const costY=px(COST);
  const strikeY=px(K);
  const rsiColor=(r)=>r>70?"#ef4444":r>60?"#f59e0b":r<40?"#06b6d4":"#10b981";

  const greeks=[
    {name:"Δ Delta",value:bs.delta.toFixed(3),color:"#6366f1",desc:`~${(bs.delta*100).toFixed(0)}% probability this option expires in-the-money. For every $1 the stock rises, the option gains $${bs.delta.toFixed(2)}. Lower delta = lower assignment risk.`},
    {name:"Γ Gamma",value:bs.gamma.toFixed(4),color:"#8b5cf6",desc:`Delta shifts by ${bs.gamma.toFixed(4)} for each $1 move. High gamma near expiration means assignment risk can change rapidly on big price swings.`},
    {name:"Θ Theta",value:`$${Math.abs(bs.theta).toFixed(3)}`,color:"#10b981",desc:`You earn $${Math.abs(bs.theta).toFixed(3)}/share per day from time decay alone. Over ${DTE} days that's ~$${(Math.abs(bs.theta)*DTE).toFixed(2)}/share. As the seller, theta works in your favor.`},
    {name:"V Vega",value:`$${bs.vega.toFixed(3)}`,color:"#f59e0b",desc:`Premium changes $${bs.vega.toFixed(3)}/share per 1% IV move. Rising IV after you sell makes buyback more expensive. Falling IV lets you close early for a profit.`},
  ];

  const fvVerdict=isOverpriced
    ?isSignificantMispricing
      ?{label:"Overpriced",color:"#10b981",icon:"🟢",detail:`Market pays $${priceDiff.toFixed(2)} (${priceDiffPct.toFixed(1)}%) above fair value. Strong edge — collect this premium.`}
      :{label:"Slightly Overpriced",color:"#86efac",icon:"🟡",detail:`Market pays $${priceDiff.toFixed(2)} (${priceDiffPct.toFixed(1)}%) above fair value. Modest edge in your favor.`}
    :isSignificantMispricing
      ?{label:"Underpriced",color:"#ef4444",icon:"🔴",detail:`Premium is $${Math.abs(priceDiff).toFixed(2)} (${Math.abs(priceDiffPct).toFixed(1)}%) below fair value. Consider a higher strike or waiting for better pricing.`}
      :{label:"Fairly Priced",color:"#94a3b8",icon:"⚪",detail:`Premium is within $${Math.abs(priceDiff).toFixed(2)} of fair value (${Math.abs(priceDiffPct).toFixed(1)}% diff). Pricing is reasonable.`};

  return(
    <div style={{fontFamily:"'DM Mono','Courier New',monospace",background:"#0a0a0f",minHeight:"100vh",color:"#e2e8f0",padding:"24px",maxWidth:"960px",margin:"0 auto"}}>
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
        .ai-text{font-size:13px;line-height:1.7;color:#94a3b8;white-space:pre-wrap;}
        .pulse{animation:pulse 2s infinite;}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
        .resist-row{display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1a1a2e;}
        .resist-row:last-child{border:none;}
        .progress-track{background:#1e1e2e;border-radius:3px;height:3px;flex:1;margin:0 10px;}
        .tick{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
        input:focus{border-color:#6366f1!important;}
      `}</style>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"24px"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
            <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"28px",fontWeight:"700"}}>{TICKER}</span>
            <span className="badge" style={{background:"#1a1a2e",color:"#64748b",border:"1px solid #2d2d40"}}>COVERED CALL ANALYZER</span>
          </div>
          <div style={{fontSize:"12px",color:"#4a5568",marginTop:"4px"}}>{SHARES} shares · DTE {DTE} · Strike ${K} · Premium ${PREM}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
          <div style={{textAlign:"right"}}>
            <div className="label">CURRENT</div>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"28px",fontWeight:"700"}}>${S}</div>
            <div style={{fontSize:"12px",color:S>=COST?"#10b981":"#ef4444"}}>{S>=COST?`↑ $${(S-COST).toFixed(2)} above`:`↓ $${(COST-S).toFixed(2)} below`} cost basis</div>
          </div>
          <button onClick={handleReset} style={{background:"#1e1e2e",border:"1px solid #2d2d40",borderRadius:"6px",color:"#94a3b8",fontSize:"10px",padding:"6px 14px",cursor:"pointer",letterSpacing:"0.1em",textTransform:"uppercase"}}>← New</button>
        </div>
      </div>

      {/* Recommendation */}
      <div style={{background:`${recColor}15`,border:`1px solid ${recColor}40`,borderRadius:"12px",padding:"16px 20px",marginBottom:"20px",display:"flex",alignItems:"flex-start",gap:"12px"}}>
        <span style={{fontSize:"20px"}}>{recIcon}</span>
        <div>
          <div style={{fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",color:recColor,marginBottom:"4px",fontWeight:"600"}}>System Recommendation</div>
          <div style={{fontSize:"14px",color:"#e2e8f0",lineHeight:"1.5"}}>{recommendation}</div>
        </div>
      </div>

      {/* Fair Value */}
      <div className="card" style={{marginBottom:"16px",borderColor:"#2d2d40"}}>
        <div className="section-title">Option Fair Value · Black-Scholes Model</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"12px",marginBottom:"16px"}}>
          {[
            {label:"BS Fair Value",value:`$${fairValue.toFixed(2)}`,color:"#6366f1",sub:"Model price"},
            {label:"Market Premium",value:`$${PREM.toFixed(2)}`,color:"#e2e8f0",sub:"What you collect"},
            {label:"Price Difference",value:`${priceDiff>=0?"+":""}$${priceDiff.toFixed(2)}`,color:priceDiff>=0?"#10b981":"#ef4444",sub:`${priceDiff>=0?"Over":"Under"}priced ${Math.abs(priceDiffPct).toFixed(1)}%`},
            {label:"Implied IV",value:`${impliedIV.toFixed(1)}%`,color:"#f59e0b",sub:`Model IV: ${(IV*100).toFixed(1)}%`},
          ].map(item=>(
            <div key={item.label} style={{background:"#0d0d18",borderRadius:"8px",padding:"14px"}}>
              <div className="label">{item.label}</div>
              <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"22px",fontWeight:"700",color:item.color,marginBottom:"2px"}}>{item.value}</div>
              <div style={{fontSize:"10px",color:"#4a5568"}}>{item.sub}</div>
            </div>
          ))}
        </div>
        <div style={{background:"#0d0d18",borderRadius:"8px",padding:"14px",marginBottom:"12px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
            <span style={{fontSize:"11px",color:"#94a3b8"}}>Fair Value vs Market Premium</span>
            <span className="badge" style={{background:`${fvVerdict.color}20`,color:fvVerdict.color,border:`1px solid ${fvVerdict.color}40`}}>{fvVerdict.icon} {fvVerdict.label}</span>
          </div>
          <div style={{position:"relative",height:"32px",background:"#13131f",borderRadius:"6px",overflow:"hidden"}}>
            <div style={{position:"absolute",top:0,left:0,height:"100%",width:`${Math.min((fairValue/Math.max(fairValue,PREM))*100,100)}%`,background:"#6366f130",borderRight:"2px solid #6366f1",display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:"6px"}}>
              <span style={{fontSize:"10px",color:"#6366f1",whiteSpace:"nowrap"}}>FV ${fairValue.toFixed(2)}</span>
            </div>
            <div style={{position:"absolute",top:0,left:0,height:"100%",width:`${Math.min((PREM/Math.max(fairValue,PREM))*100,100)}%`,background:"transparent",borderRight:"2px dashed #10b981",display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:"6px",paddingTop:"14px"}}>
              <span style={{fontSize:"10px",color:"#10b981",whiteSpace:"nowrap"}}>Mkt ${PREM}</span>
            </div>
          </div>
          <div style={{fontSize:"11px",color:"#4a5568",marginTop:"10px",lineHeight:"1.6"}}>{fvVerdict.detail}</div>
        </div>
        <div className="grid2">
          <div style={{background:"#0d0d18",borderRadius:"8px",padding:"14px"}}>
            <div className="label">Implied Volatility Spread</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"6px"}}>
              <div><div style={{fontSize:"10px",color:"#4a5568"}}>Market IV</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:"#f59e0b"}}>{impliedIV.toFixed(1)}%</div></div>
              <div style={{fontSize:"18px",color:"#2d2d40"}}>vs</div>
              <div style={{textAlign:"right"}}><div style={{fontSize:"10px",color:"#4a5568"}}>Model IV</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:"#6366f1"}}>{(IV*100).toFixed(1)}%</div></div>
            </div>
            <div style={{fontSize:"10px",color:"#4a5568",lineHeight:"1.5"}}>
              {impliedIV>(IV*100)?"Market expects MORE volatility than history. Premium is rich — good time to sell.":"Market expects LESS volatility than history. Premium may be thin — wait for an IV spike."}
            </div>
          </div>
          <div style={{background:"#0d0d18",borderRadius:"8px",padding:"14px"}}>
            <div className="label">Yield Comparison</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"6px"}}>
              <div><div style={{fontSize:"10px",color:"#4a5568"}}>Your yield</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:"#10b981"}}>{annualizedYield.toFixed(1)}%</div></div>
              <div style={{fontSize:"18px",color:"#2d2d40"}}>vs</div>
              <div style={{textAlign:"right"}}><div style={{fontSize:"10px",color:"#4a5568"}}>FV yield</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:"#6366f1"}}>{fairValueYield.toFixed(1)}%</div></div>
            </div>
            <div style={{fontSize:"10px",color:"#4a5568",lineHeight:"1.5"}}>
              {annualizedYield>fairValueYield?`Earning ${(annualizedYield-fairValueYield).toFixed(1)}% MORE than fair value annualized. Edge in your favor.`:`Earning ${(fairValueYield-annualizedYield).toFixed(1)}% LESS than fair value yield. Market is underpricing this option.`}
            </div>
          </div>
        </div>
      </div>

      {/* Price Chart */}
      <div className="card" style={{marginBottom:"16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px",borderBottom:"1px solid #1e1e2e",paddingBottom:"8px"}}>
          <div className="section-title" style={{marginBottom:0}}>Price History (90d) · {TICKER}</div>
          <span className="badge" style={{background:priceSource==="live"?"#10b98120":"#f59e0b20",color:priceSource==="live"?"#10b981":"#f59e0b",border:`1px solid ${priceSource==="live"?"#10b98140":"#f59e0b40"}`}}>
            {priceSource==="live"?"● Live Data":"◌ Simulated"}
          </span>
        </div>
        <svg width="100%" viewBox={`0 0 ${sparkW} ${sparkH+20}`} style={{overflow:"visible"}}>
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25"/>
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#areaGrad)"/>
          <path d={sparkPath} fill="none" stroke="#6366f1" strokeWidth="1.5"/>
          {/* cost basis line */}
          <line x1="0" y1={costY} x2={sparkW} y2={costY} stroke="#ef4444" strokeWidth="1" strokeDasharray="5,3" opacity="0.8"/>
          <rect x={sparkW-58} y={costY-10} width={56} height={12} rx="2" fill="#ef444420"/>
          <text x={sparkW-4} y={costY-1} fontSize="8" fill="#ef4444" textAnchor="end">Cost ${COST}</text>
          {/* strike line */}
          <line x1="0" y1={strikeY} x2={sparkW} y2={strikeY} stroke="#10b981" strokeWidth="1" strokeDasharray="5,3" opacity="0.8"/>
          <rect x={sparkW-62} y={strikeY-10} width={60} height={12} rx="2" fill="#10b98120"/>
          <text x={sparkW-4} y={strikeY-1} fontSize="8" fill="#10b981" textAnchor="end">Strike ${K}</text>
          {/* current price dot */}
          <circle cx={sparkW} cy={px(S)} r="4" fill="#6366f1"/>
          <circle cx={sparkW} cy={px(S)} r="7" fill="#6366f130"/>
        </svg>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:"4px"}}>
          <span style={{fontSize:"11px",color:"#4a5568"}}>← 90 days ago</span>
          <span style={{fontSize:"11px",color:"#4a5568"}}>Today ${S} →</span>
        </div>
        {/* price range */}
        <div style={{display:"flex",justifyContent:"space-between",marginTop:"8px",padding:"8px",background:"#0d0d18",borderRadius:"6px"}}>
          {[
            {label:"90d Low",value:`$${minP.toFixed(2)}`,color:"#ef4444"},
            {label:"90d High",value:`$${maxP.toFixed(2)}`,color:"#10b981"},
            {label:"Range",value:`$${(maxP-minP).toFixed(2)}`,color:"#94a3b8"},
            {label:"Current vs Low",value:`+${((S-minP)/minP*100).toFixed(1)}%`,color:"#6366f1"},
            {label:"Current vs High",value:`${((S-maxP)/maxP*100).toFixed(1)}%`,color:S>=maxP?"#10b981":"#f59e0b"},
          ].map(s=>(
            <div key={s.label} style={{textAlign:"center"}}>
              <div style={{fontSize:"9px",color:"#4a5568",marginBottom:"2px",letterSpacing:"0.1em",textTransform:"uppercase"}}>{s.label}</div>
              <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"13px",fontWeight:"600",color:s.color}}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Position Summary */}
      <div className="card" style={{marginBottom:"16px"}}>
        <div className="section-title">Position Summary</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"12px"}}>
          {[
            {label:"Cost Basis",value:`$${COST}`,color:"#94a3b8"},
            {label:"Breakeven",value:`$${breakeven.toFixed(2)}`,color:"#f59e0b"},
            {label:"Unrealized P&L",value:`${S>=COST?"+":"-"}$${Math.abs((S-COST)*SHARES).toFixed(0)}`,color:S>=COST?"#10b981":"#ef4444"},
            {label:"Premium Yield",value:`${annualizedYield.toFixed(1)}% ann.`,color:"#10b981"},
          ].map(item=>(
            <div key={item.label} style={{background:"#0d0d18",borderRadius:"8px",padding:"12px"}}>
              <div className="label">{item.label}</div>
              <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"600",color:item.color}}>{item.value}</div>
            </div>
          ))}
        </div>
        <div style={{marginTop:"12px",background:"#0d0d18",borderRadius:"8px",padding:"12px",borderLeft:"3px solid #6366f1"}}>
          <div className="label">If Called Away at ${K}</div>
          <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"16px",fontWeight:"600",color:totalPnL>=0?"#10b981":"#ef4444"}}>
            {totalPnL>=0?"+":" "}${totalPnL.toFixed(0)} total ({totalPnLPct.toFixed(1)}%)
          </div>
          <div style={{fontSize:"11px",color:"#4a5568",marginTop:"2px"}}>
            Capital {gainLossPerShare>=0?"gain":"loss"} ${Math.abs(gainLossPerShare*SHARES).toFixed(0)} + premium ${(PREM*SHARES).toFixed(0)}
          </div>
        </div>
      </div>

      {/* RSI + Greeks */}
      <div className="grid2" style={{marginBottom:"16px"}}>
        <div className="card">
          <div className="section-title">RSI Analysis</div>
          {[{label:"Daily RSI (14)",value:dailyRSI,tf:"Daily"},{label:"Weekly RSI (14)",value:weeklyRSI,tf:"Weekly"}].map(r=>(
            <div key={r.tf} style={{marginBottom:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
                <span style={{fontSize:"12px",color:"#94a3b8"}}>{r.label}</span>
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"20px",fontWeight:"600",color:rsiColor(r.value)}}>{r.value?.toFixed(1)}</span>
                  <span className="badge" style={{background:r.value>70?"#ef444420":r.value>60?"#f59e0b20":r.value<40?"#06b6d420":"#10b98120",color:rsiColor(r.value),border:`1px solid ${rsiColor(r.value)}40`}}>
                    {r.value>70?"Overbought":r.value>60?"Elevated":r.value<40?"Oversold":"Neutral"}
                  </span>
                </div>
              </div>
              <div className="rsi-bar"><div className="rsi-fill" style={{width:`${r.value}%`,background:rsiColor(r.value)}}/></div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:"2px"}}>
                <span style={{fontSize:"9px",color:"#2d3748"}}>0 — Oversold</span>
                <span style={{fontSize:"9px",color:"#2d3748"}}>70 — Overbought — 100</span>
              </div>
            </div>
          ))}
          <div style={{background:"#0d0d18",borderRadius:"8px",padding:"10px"}}>
            <div className="label">RSI Signal</div>
            <div style={{fontSize:"12px",color:"#94a3b8",marginTop:"4px"}}>
              {dailyRSI>70?"⚠️ Daily overbought — favorable for call selling":dailyRSI>60?"📊 Daily elevated — approaching overbought":dailyRSI<40?"📉 Oversold — avoid selling calls":"😐 RSI neutral — neither overbought nor oversold"}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="section-title">Black-Scholes Greeks · ${K} Strike</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"12px"}}>
            {greeks.map(g=>(
              <div key={g.name} className="greek">
                <div style={{fontSize:"11px",color:g.color,fontWeight:"600",marginBottom:"2px"}}>{g.name}</div>
                <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"20px",fontWeight:"700",marginBottom:"8px"}}>{g.value}</div>
                <div style={{fontSize:"10px",color:"#4a5568",lineHeight:"1.6"}}>{g.desc}</div>
              </div>
            ))}
          </div>
          <div style={{background:"#0d0d18",borderRadius:"8px",padding:"12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div className="label">Premium Collected</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"24px",fontWeight:"700",color:"#10b981"}}>${PREM.toFixed(2)}<span style={{fontSize:"14px",color:"#4a5568"}}>/share</span></div></div>
              <div style={{textAlign:"right"}}><div className="label">Total ({SHARES} shares)</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"24px",fontWeight:"700",color:"#10b981"}}>${(PREM*SHARES).toFixed(0)}</div></div>
            </div>
            <div style={{marginTop:"8px",fontSize:"11px",color:"#4a5568"}}>IV: {(IV*100).toFixed(1)}% · Ann. Yield: {annualizedYield.toFixed(1)}% · Theta/day: ${Math.abs(bs.theta).toFixed(3)}</div>
          </div>
        </div>
      </div>

      {/* Resistance + ARIMA */}
      <div className="grid2" style={{marginBottom:"16px"}}>
        <div className="card">
          <div className="section-title">Resistance Map</div>
          {resistanceLevels.map(r=>{
            const pct=((r.price-S)/S*100);
            const isStrike=Math.abs(r.price-K)<S*0.015;
            const isCost=r.price===COST;
            return(
              <div key={r.price} className="resist-row" style={{opacity:r.price<S?0.4:1}}>
                <div style={{display:"flex",alignItems:"center",gap:"8px",minWidth:"100px"}}>
                  <div className="tick" style={{background:isCost?"#ef4444":isStrike?"#10b981":r.strength==="Key"?"#f59e0b":r.strength==="Strong"?"#6366f1":"#4a5568"}}/>
                  <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:"600",fontSize:"13px"}}>${r.price}</span>
                </div>
                <div className="progress-track"><div style={{height:"100%",width:`${Math.min(Math.abs(pct)*4,100)}%`,background:isCost?"#ef4444":isStrike?"#10b981":"#6366f1",borderRadius:"3px"}}/></div>
                <div style={{textAlign:"right",minWidth:"80px"}}>
                  <div style={{fontSize:"10px",color:"#94a3b8"}}>{r.label}</div>
                  <div style={{fontSize:"10px",color:"#4a5568"}}>{pct>=0?"+":""}{pct.toFixed(1)}%</div>
                </div>
                {isStrike&&<span className="badge" style={{background:"#10b98120",color:"#10b981",border:"1px solid #10b98140",marginLeft:"4px"}}>STRIKE</span>}
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="section-title">ARIMA Momentum</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"12px"}}>
            {[
              {label:"5-Day Momentum",value:`${arima.momentum5>=0?"+":""}${arima.momentum5.toFixed(2)}%`,color:arima.momentum5>2?"#10b981":arima.momentum5<-2?"#ef4444":"#f59e0b"},
              {label:"20-Day Momentum",value:`${arima.momentum20>=0?"+":""}${arima.momentum20.toFixed(2)}%`,color:arima.momentum20>5?"#10b981":arima.momentum20<-5?"#ef4444":"#f59e0b"},
              {label:"AR(1) Coefficient",value:arima.ar1.toFixed(3),color:arima.ar1>0.1?"#10b981":arima.ar1<-0.1?"#ef4444":"#94a3b8",desc:arima.ar1>0.1?"Trending":"Mean-reverting"},
              {label:"Avg Daily Return",value:`${arima.avgDailyReturn.toFixed(3)}%`,color:arima.avgDailyReturn>0?"#10b981":"#ef4444"},
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
              {arima.ar1>0.1&&arima.momentum20>3?"📈 Strong uptrend detected. Capping upside now carries meaningful opportunity cost.":arima.ar1<0&&arima.momentum5<-1?"📉 Mean-reverting with negative momentum. Caution — could bounce.":"➡️ Mixed signals. Momentum not decisively trending. Neutral timing."}
            </div>
          </div>
        </div>
      </div>

      {/* AI Analysis */}
      <div className="card-dark" style={{marginBottom:"16px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
          <div className="section-title" style={{marginBottom:0}}>AI Options Strategist Analysis</div>
          <button onClick={fetchAI} style={{background:"#1e1e2e",border:"1px solid #2d2d40",borderRadius:"6px",color:"#94a3b8",fontSize:"10px",padding:"4px 12px",cursor:"pointer",letterSpacing:"0.1em",textTransform:"uppercase"}}>↺ Refresh</button>
        </div>
        {aiLoading
          ?<div style={{display:"flex",alignItems:"center",gap:"8px",color:"#4a5568"}}><span className="pulse">●</span><span style={{fontSize:"12px"}}>Analyzing position...</span></div>
          :<div className="ai-text">{aiAnalysis||"Click Refresh to generate AI analysis."}</div>
        }
      </div>

      {/* Strike Ladder */}
      <div className="card">
        <div className="section-title">Strike Ladder · {DTE} DTE · {(IV*100).toFixed(1)}% IV</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}>
            <thead>
              <tr style={{color:"#4a5568",borderBottom:"1px solid #1e1e2e"}}>
                {["Strike","Delta","BS Fair Value","Mkt vs FV","Ann. Yield","vs Cost Basis",""].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"right",fontWeight:"400",letterSpacing:"0.05em",fontSize:"10px",textTransform:"uppercase"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {strikes.filter(k=>k>=S*0.95&&k<=S*1.25).map(k=>{
                const b=blackScholes(S,k,T,RISK_FREE,IV);
                const annYld=(b.call/S)*(365/DTE)*100;
                const isSelected=k===K;
                const mktDiff=isSelected?priceDiff:null;
                return(
                  <tr key={k} style={{borderBottom:"1px solid #0d0d18",background:isSelected?"#6366f115":"transparent",color:isSelected?"#e2e8f0":"#94a3b8"}}>
                    <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"'Space Grotesk',sans-serif",fontWeight:isSelected?"600":"400",color:isSelected?"#6366f1":"inherit"}}>${k}{isSelected&&" ★"}</td>
                    <td style={{padding:"7px 10px",textAlign:"right"}}>{b.delta.toFixed(3)}</td>
                    <td style={{padding:"7px 10px",textAlign:"right",color:"#6366f1"}}>${b.call.toFixed(2)}</td>
                    <td style={{padding:"7px 10px",textAlign:"right",color:mktDiff!=null?(mktDiff>=0?"#10b981":"#ef4444"):"#4a5568"}}>
                      {mktDiff!=null?(mktDiff>=0?`+$${mktDiff.toFixed(2)}`:`-$${Math.abs(mktDiff).toFixed(2)}`):"—"}
                    </td>
                    <td style={{padding:"7px 10px",textAlign:"right",color:annYld>15?"#10b981":annYld>8?"#f59e0b":"#94a3b8"}}>{annYld.toFixed(1)}%</td>
                    <td style={{padding:"7px 10px",textAlign:"right",color:k>=COST?"#10b981":"#ef4444"}}>{k>=COST?"Above ✓":`-$${(COST-k).toFixed(0)}`}</td>
                    <td style={{padding:"7px 10px",textAlign:"right"}}>{b.delta<0.25&&b.delta>0.15&&<span className="badge" style={{background:"#10b98115",color:"#10b981",border:"1px solid #10b98130"}}>~0.20Δ</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{textAlign:"center",marginTop:"20px",fontSize:"10px",color:"#2d3748",letterSpacing:"0.1em"}}>
        {TICKER} · {priceSource==="live"?"LIVE YAHOO FINANCE DATA":"SIMULATED DATA"} · BLACK-SCHOLES · {new Date().toLocaleDateString()}
      </div>
    </div>
  );
}