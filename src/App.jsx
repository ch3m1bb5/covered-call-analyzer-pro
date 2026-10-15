// Covered Call Analyzer Pro v2
// Tabs: Overview · Payoff · Monte Carlo (GBM) · Vol Surface · Chain · American · BSM Reference · AI
import { useState, useEffect, useCallback } from "react";
import { BlackScholes } from "@uqee/black-scholes";
import AmericanTab    from "./AmericanOptions";
import BSMReference   from "./BSMReference";
import MonteCarloGBM  from "./MonteCarloGBM";

// ── API ───────────────────────────────────────────────────────────────────────
const API = "http://localhost:5050";
const bsEngine = new BlackScholes();

async function apiGreeks(flag,S,K,t,r,sigma,q=0,mkt=null){
  const b={flag,S,K,t,r,sigma,q}; if(mkt!=null)b.mkt_price=mkt;
  const res=await fetch(`${API}/greeks`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
  if(!res.ok)throw new Error(res.status); return res.json();
}
async function apiSurface(S,r,sigma,strikes,expiries,q=0){
  const res=await fetch(`${API}/surface`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({S,r,sigma,q,strikes,expiries})});
  if(!res.ok)throw new Error(res.status); return res.json();
}
async function apiChain(S,t,r,options,q=0){
  const res=await fetch(`${API}/chain`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({S,t,r,q,options})});
  if(!res.ok)throw new Error(res.status); return res.json();
}
async function checkServer(){
  try{const r=await fetch(`${API}/health`,{signal:AbortSignal.timeout(2000)});return r.ok?r.json():null;}catch{return null;}
}

// ── @uqee fallback ────────────────────────────────────────────────────────────
function erf(x){const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;const s=x<0?-1:1;x=Math.abs(x);const t=1/(1+p*x);return s*(1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x));}
const NC=x=>0.5*(1+erf(x/Math.sqrt(2)));
const NP=x=>Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);
function bsFB(flag,S,K,t,r,sigma){
  if(t<=0)return{price:Math.max(flag==="c"?S-K:K-S,0),delta:0,gamma:0,theta:0,vega:0,rho:0,iv:sigma};
  try{const type=flag==="c"?"call":"put";const o=bsEngine.option({type,underlying:S,strike:K,time:t,rate:r,sigma});return{price:o.price,delta:o.delta,gamma:o.gamma,theta:o.theta/365,vega:o.vega/100,rho:0,iv:sigma};}
  catch{const d1=(Math.log(S/K)+(r+.5*sigma*sigma)*t)/(sigma*Math.sqrt(t)),d2=d1-sigma*Math.sqrt(t);const c=S*NC(d1)-K*Math.exp(-r*t)*NC(d2),p=K*Math.exp(-r*t)*NC(-d2)-S*NC(-d1);return{price:flag==="c"?c:p,delta:flag==="c"?NC(d1):-NC(-d1),gamma:NP(d1)/(S*sigma*Math.sqrt(t)),theta:(-S*NP(d1)*sigma/(2*Math.sqrt(t))-r*K*Math.exp(-r*t)*(flag==="c"?NC(d2):NC(-d2)))/365,vega:S*NP(d1)*Math.sqrt(t)/100,rho:flag==="c"?K*t*Math.exp(-r*t)*NC(d2)/100:-K*t*Math.exp(-r*t)*NC(-d2)/100,iv:sigma};}
}
function ivFB(S,K,t,r,mkt){
  if(mkt<=0||t<=0)return 0;
  try{const iv=bsEngine.sigma({type:"call",underlying:S,strike:K,time:t,rate:r,price:mkt});return isFinite(iv)&&iv>0?iv:ivSearch(S,K,t,r,mkt);}catch{return ivSearch(S,K,t,r,mkt);}
}
function ivSearch(S,K,t,r,mkt){let lo=0.001,hi=5;for(let i=0;i<100;i++){const m=(lo+hi)/2,p=bsFB("c",S,K,t,r,m).price;if(Math.abs(p-mkt)<0.0001)return m;p>mkt?hi=m:lo=m;}return(lo+hi)/2;}
async function computeG(flag,S,K,t,r,sigma,mkt=null,online=true){
  if(online){try{return await apiGreeks(flag,S,K,t,r,sigma,0,mkt);}catch{}}
  const fb=bsFB(flag,S,K,t,r,sigma);
  fb.iv=mkt!=null?ivFB(S,K,t,r,mkt):sigma; fb.iv_pct=fb.iv*100;
  fb.engine="@uqee/black-scholes (offline)"; return fb;
}

// ── SABR ──────────────────────────────────────────────────────────────────────
function sabrIV(F,K,T,a,b,rho,nu){
  if(T<=0)return a;
  if(Math.abs(F-K)<1e-8){const FK=Math.pow(F*K,(1-b)/2),l=Math.log(F/K);const A=a/(FK*(1+Math.pow(1-b,2)/24*l*l+Math.pow(1-b,4)/1920*Math.pow(l,4)));return Math.max(0.001,A*(1+(Math.pow(1-b,2)/24*a*a/Math.pow(FK,2)+rho*b*nu*a/(4*FK)+(2-3*rho*rho)/24*nu*nu)*T));}
  const FK=Math.pow(F*K,(1-b)/2),l=Math.log(F/K);const z=(nu/a)*FK*l,xz=Math.log((Math.sqrt(1-2*rho*z+z*z)+z-rho)/(1-rho));const A=a/(FK*(1+Math.pow(1-b,2)/24*l*l+Math.pow(1-b,4)/1920*Math.pow(l,4)));return Math.max(0.001,A*(Math.abs(xz)<1e-10?1:z/xz)*(1+(Math.pow(1-b,2)/24*a*a/Math.pow(FK,2)+rho*b*nu*a/(4*FK)+(2-3*rho*rho)/24*nu*nu)*T));
}
// SABR default params: alpha scaled so that ATM SABR vol ≈ IV (alpha is in F^(1-β) units)
function sabrDef(IV,F,b=0.5){return{alpha:IV*Math.pow(F,1-b),beta:b,rho:-0.3,nu:0.4};}
function calibSABR(F,T,mK,mV,beta=0.5){
  const atm=mV[Math.floor(mV.length/2)];let best={alpha:atm,beta,rho:-0.3,nu:0.4},bErr=Infinity;
  for(const rho of[-0.7,-0.5,-0.3,-0.1,0,0.1])for(const nu of[0.2,0.4,0.6,0.8,1.0]){let alpha=atm;for(let i=0;i<10;i++){const v=sabrIV(F,F,T,alpha,beta,rho,nu);const dv=(sabrIV(F,F,T,alpha*1.001,beta,rho,nu)-v)/(alpha*0.001);if(Math.abs(dv)<1e-12)break;alpha=Math.max(0.001,alpha-(v-atm)/dv);}let err=0;for(let i=0;i<mK.length;i++)err+=Math.pow(sabrIV(F,mK[i],T,alpha,beta,rho,nu)-mV[i],2);if(err<bErr){bErr=err;best={alpha,beta,rho,nu};}}
  return best;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function calcRSI(p,per=14){if(!p||p.length<per+1)return 50;let g=0,l=0;for(let i=1;i<=per;i++){const d=p[i]-p[i-1];d>0?g+=d:l-=d;}let ag=g/per,al=l/per;for(let i=per+1;i<p.length;i++){const d=p[i]-p[i-1];ag=(ag*(per-1)+(d>0?d:0))/per;al=(al*(per-1)+(d<0?-d:0))/per;}return al===0?100:100-(100/(1+ag/al));}
function histVol(p,w=30){if(!p||p.length<2)return 0.3;const lr=[];for(let i=1;i<p.length;i++)lr.push(Math.log(p[i]/p[i-1]));const s=lr.slice(-w),m=s.reduce((a,b)=>a+b,0)/s.length;return Math.sqrt(s.reduce((a,b)=>a+(b-m)**2,0)/s.length*252);}
function arimaScore(p){if(!p||p.length<22)return{momentum5:0,momentum20:0,ar1:0};const n=p.length,ret=[];for(let i=1;i<n;i++)ret.push((p[i]-p[i-1])/p[i-1]);const rr=ret.slice(-20),avg=rr.reduce((a,b)=>a+b,0)/rr.length;let cov=0,vx=0;for(let i=1;i<ret.length;i++){cov+=(ret[i]-avg)*(ret[i-1]-avg);vx+=(ret[i-1]-avg)**2;}return{momentum5:(p[n-1]-p[Math.max(0,n-6)])/p[Math.max(0,n-6)]*100,momentum20:(p[n-1]-p[Math.max(0,n-21)])/p[Math.max(0,n-21)]*100,ar1:vx>0?cov/vx:0};}
function wkP(d){const w=[];for(let i=0;i<d.length;i+=5)w.push(d[i]);return w;}
function bldStrikes(S){const b=Math.round(S/5)*5,s=[];for(let k=b-10;k<=b+50;k+=5)s.push(k);return s;}
async function fetchPrices(ticker){const end=Math.floor(Date.now()/1000),start=end-90*24*60*60;const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${start}&period2=${end}`;const j=await(await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`)).json();const d=JSON.parse(j.contents);const c=d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;if(!c?.length)throw new Error("No data");return c.filter(p=>p!=null).map(p=>parseFloat(p.toFixed(2)));}
async function fetchChain(ticker){const url=`https://query1.finance.yahoo.com/v7/finance/options/${ticker}`;const j=await(await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`)).json();const d=JSON.parse(j.contents);const r=d?.optionChain?.result?.[0];if(!r)throw new Error("No options");return{calls:r?.options?.[0]?.calls||[],puts:r?.options?.[0]?.puts||[],quote:r?.quote};}
// Simulated 90-day history (used only when Yahoo is unreachable): GBM walked backwards from S, ~30% annual vol
function fbPrices(S){const n=90,dv=0.30/Math.sqrt(252),p=[S];let v=S;for(let i=1;i<n;i++){const z=Math.sqrt(-2*Math.log(Math.random()||1e-9))*Math.cos(2*Math.PI*Math.random());v=v/Math.exp(0.0006+dv*z);p.unshift(parseFloat(v.toFixed(2)));}return p;}

const INP={background:"#0d0d18",border:"1px solid #2d2d40",borderRadius:"6px",color:"#e2e8f0",padding:"8px 10px",fontSize:"13px",width:"100%",fontFamily:"'DM Mono',monospace",outline:"none",boxSizing:"border-box"};
const LBL={fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#4a5568",marginBottom:"4px",display:"block"};

// ── Server Badge ──────────────────────────────────────────────────────────────
function ServerBadge({online,engine}){
  return(<div style={{display:"flex",alignItems:"center",gap:"8px",background:"#0d0d18",border:`1px solid ${online?"#10b98140":"#ef444440"}`,borderRadius:"8px",padding:"8px 14px",marginBottom:"16px"}}>
    <span style={{fontSize:"10px",color:online?"#10b981":"#ef4444"}}>{online?"●":"○"}</span>
    <div>
      <div style={{fontSize:"10px",color:online?"#10b981":"#ef4444",fontWeight:"600",letterSpacing:"0.1em",textTransform:"uppercase"}}>{online?"py_vollib online":"py_vollib offline"}</div>
      <div style={{fontSize:"9px",color:"#4a5568",marginTop:"1px"}}>{online?`${engine} · localhost:5050`:"Fallback: @uqee/black-scholes · Run start_greeks_server.bat"}</div>
    </div>
  </div>);
}

function TabBar({tabs,active,onChange}){
  return(<div style={{display:"flex",gap:"3px",marginBottom:"20px",background:"#0d0d18",borderRadius:"8px",padding:"4px",flexWrap:"wrap"}}>
    {tabs.map(t=><button key={t.id} onClick={()=>onChange(t.id)} style={{flex:1,minWidth:"80px",padding:"7px 4px",border:"none",borderRadius:"6px",cursor:"pointer",fontSize:"9px",letterSpacing:"0.08em",textTransform:"uppercase",fontFamily:"'DM Mono',monospace",fontWeight:"600",background:active===t.id?"#6366f1":"transparent",color:active===t.id?"#fff":"#4a5568",transition:"all 0.1s"}}>{t.icon} {t.label}</button>)}
  </div>);
}

// ── Payoff Diagram ────────────────────────────────────────────────────────────
function Payoff({S,K,COST,PREM,SHARES}){
  const W=560,H=220,pad=24,pMin=S*0.7,pMax=S*1.4;
  const prices=Array.from({length:100},(_,i)=>pMin+(pMax-pMin)*i/99);
  const pnls=prices.map(p=>(Math.min(p,K)-COST+PREM)*SHARES);
  const naked=prices.map(p=>(p-COST)*SHARES);
  const all=[...pnls,...naked],minV=Math.min(...all),maxV=Math.max(...all);
  const xS=p=>pad+(p-pMin)/(pMax-pMin)*(W-pad*2),yS=v=>pad+(1-(v-minV)/(maxV-minV))*(H-pad*2);
  const zY=yS(0),be=COST-PREM,mp=(K-COST+PREM)*SHARES;
  const cP=prices.map((p,i)=>`${i===0?"M":"L"}${xS(p)},${yS(pnls[i])}`).join("");
  const nP=prices.map((p,i)=>`${i===0?"M":"L"}${xS(p)},${yS(naked[i])}`).join("");
  return(<div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px",marginBottom:"16px"}}>
      {[{l:"Max Profit",v:`${mp<0?"-":""}$${Math.abs(mp).toFixed(0)}`,s:`capped at $${K}`,c:mp>=0?"#10b981":"#ef4444"},{l:"Breakeven",v:`$${be.toFixed(2)}`,s:"after premium",c:"#f59e0b"},{l:"Premium",v:`$${(PREM*SHARES).toFixed(0)}`,s:`$${PREM}×${SHARES}`,c:"#6366f1"}].map(i=>(
      <div key={i.l} style={{background:"#0d0d18",borderRadius:"8px",padding:"12px",textAlign:"center"}}>
        <div style={{fontSize:"9px",color:"#4a5568",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"4px"}}>{i.l}</div>
        <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:i.c}}>{i.v}</div>
        <div style={{fontSize:"9px",color:"#4a5568",marginTop:"2px"}}>{i.s}</div>
      </div>))}
    </div>
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible",background:"#0d0d18",borderRadius:"8px"}}>
      <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity="0.15"/><stop offset="100%" stopColor="#10b981" stopOpacity="0"/></linearGradient></defs>
      <line x1={pad} y1={zY} x2={W-pad} y2={zY} stroke="#2d2d40" strokeWidth="1" strokeDasharray="4,3"/>
      <line x1={xS(K)} y1={pad} x2={xS(K)} y2={H-pad} stroke="#6366f1" strokeWidth="1" strokeDasharray="4,3" opacity="0.7"/>
      <text x={xS(K)+3} y={pad+10} fontSize="8" fill="#6366f1">Strike ${K}</text>
      <path d={nP} fill="none" stroke="#4a5568" strokeWidth="1.5" strokeDasharray="6,3" opacity="0.5"/>
      <path d={cP+`L${W-pad},${H-pad} L${pad},${H-pad}Z`} fill="url(#cg)"/>
      <path d={cP} fill="none" stroke="#10b981" strokeWidth="2.5"/>
      <circle cx={xS(K)} cy={yS(mp)} r="4" fill="#10b981"/>
      <circle cx={xS(be)} cy={zY} r="4" fill="#f59e0b"/>
      <text x={xS(be)+5} y={zY-6} fontSize="8" fill="#f59e0b">BE ${be.toFixed(0)}</text>
      {[S*0.8,S*0.9,S,K,S*1.2,S*1.3].filter(p=>p>=pMin&&p<=pMax).map(p=><g key={p}><line x1={xS(p)} y1={H-pad} x2={xS(p)} y2={H-pad+4} stroke="#2d2d40"/><text x={xS(p)} y={H-pad+13} fontSize="7" fill="#4a5568" textAnchor="middle">${p.toFixed(0)}</text></g>)}
      <line x1={W-130} y1={14} x2={W-110} y2={14} stroke="#10b981" strokeWidth="2"/><text x={W-106} y={18} fontSize="8" fill="#10b981">Covered Call</text>
      <line x1={W-130} y1={27} x2={W-110} y2={27} stroke="#4a5568" strokeWidth="1.5" strokeDasharray="5,3"/><text x={W-106} y={31} fontSize="8" fill="#4a5568">Naked Stock</text>
    </svg>
  </div>);
}

// ── Vol Surface ───────────────────────────────────────────────────────────────
function VolSurface({S,IV,r,T,chain,online}){
  const [surf,setSurf]=useState(null),[load,setLoad]=useState(true),[src,setSrc]=useState("");
  const exps=[7,14,30,45,60,90,120,180].map(d=>d/365);
  const eLbls=["1W","2W","1M","6W","2M","3M","4M","6M"];
  const stks=[0.80,0.85,0.90,0.95,1.00,1.05,1.10,1.15,1.20].map(m=>Math.round(S*m/5)*5);
  useEffect(()=>{(async()=>{
    setLoad(true);
    let sp=sabrDef(IV,S),ss="defaults";
    if(chain?.calls?.length>2){const F=S*Math.exp(r*T),mS=[],mV=[];chain.calls.filter(c=>c.strike>=S*0.85&&c.strike<=S*1.15&&c.impliedVolatility>0.01).sort((a,b)=>a.strike-b.strike).forEach(c=>{mS.push(c.strike);mV.push(c.impliedVolatility);});if(mS.length>=3){sp=calibSABR(F,T,mS,mV,0.5);ss=`live ${mS.length} strikes`;}}
    // SABR IV per cell is always computed locally; server /surface uses a flat sigma (no smile)
    const grid=exps.map(eT=>{const F=S*Math.exp(r*eT),tA=sp.alpha*(1+0.08*Math.sqrt(eT/(T||0.082)));return stks.map(K=>{const iv=sabrIV(F,K,eT,tA,sp.beta,sp.rho,sp.nu);const g=bsFB("c",S,K,eT,r,iv);return{strike:K,t:eT,call_price:g.price,delta:g.delta,gamma:g.gamma,theta:g.theta,vega:g.vega,iv_pct:iv*100};});});
    setSurf({grid,sp,engine:"SABR"});setSrc(`SABR Hagan 2002 · ${ss}`);setLoad(false);
  })();},[S,IV,r,T,chain,online]);
  if(load)return<div style={{display:"flex",alignItems:"center",gap:"12px",padding:"40px",justifyContent:"center",color:"#4a5568"}}><span style={{animation:"pulse 1s infinite"}}>◎</span><span>Computing surface...</span></div>;
  const{grid,sp}=surf,all=grid.flat().map(c=>c.iv_pct||0),minIV=Math.min(...all),maxIV=Math.max(...all);
  const col=iv=>{const t=(iv-minIV)/(maxIV-minIV||1);if(t<0.33)return`rgb(${Math.round(99+t*3*56)},${Math.round(102+t*3*54)},241)`;if(t<0.66)return`rgb(245,${Math.round(158-(t-0.33)*3*120)},11)`;return`rgb(239,${Math.round(68-(t-0.66)*3*68)},68)`;};
  const atmI=Math.floor(stks.length/2),cW=58,cH=32,W=stks.length*cW+80,H=exps.length*cH+50;
  return(<div>
    <div style={{background:"#0d0d18",border:"1px solid #2d2d40",borderRadius:"8px",padding:"14px",marginBottom:"16px"}}>
      <div style={{fontSize:"10px",color:"#4a5568",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"10px"}}>SABR · {src}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px"}}>
        {[{l:"σ ATM (α)",v:(sabrIV(S*Math.exp(r*T),S*Math.exp(r*T),T||0.082,sp.alpha,sp.beta,sp.rho,sp.nu)*100).toFixed(1)+"%",d:`α = ${sp.alpha.toFixed(3)}`,c:"#6366f1"},{l:"β Beta",v:sp.beta.toFixed(2),d:"Backbone",c:"#8b5cf6"},{l:"ρ Rho",v:sp.rho.toFixed(2),d:"Skew",c:"#f59e0b"},{l:"ν Nu",v:sp.nu.toFixed(2),d:"Vol-of-vol",c:"#10b981"}].map(p=>(
        <div key={p.l} style={{background:"#13131f",borderRadius:"6px",padding:"10px"}}><div style={{fontSize:"10px",color:p.c,fontWeight:"600",marginBottom:"2px"}}>{p.l}</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700"}}>{p.v}</div><div style={{fontSize:"9px",color:"#4a5568",marginTop:"2px"}}>{p.d}</div></div>))}
      </div>
    </div>
    <div style={{overflowX:"auto"}}>
      <svg width={W} height={H} style={{fontFamily:"'DM Mono',monospace"}}>
        {stks.map((K,ki)=><g key={K}><text x={80+ki*cW+cW/2} y={18} fontSize="8" fill={Math.abs(K-S)<S*0.03?"#10b981":"#4a5568"} textAnchor="middle" fontWeight={Math.abs(K-S)<S*0.03?"600":"400"}>${K}</text>{Math.abs(K-S)<S*0.03&&<text x={80+ki*cW+cW/2} y={28} fontSize="6" fill="#10b981" textAnchor="middle">ATM</text>}</g>)}
        {grid.map((row,ti)=><g key={ti}><text x={74} y={40+ti*cH+cH/2+4} fontSize="8" fill="#94a3b8" textAnchor="end">{eLbls[ti]}</text>{row.map((cell,ki)=>{const iv=cell.iv_pct||0,isATM=Math.abs(stks[ki]-S)<S*0.03,is30=ti===2;return<g key={ki}><rect x={80+ki*cW+1} y={34+ti*cH+1} width={cW-2} height={cH-2} fill={col(iv)} opacity="0.85" rx="3" stroke={isATM&&is30?"#fff":"none"} strokeWidth="1.5"/><text x={80+ki*cW+cW/2} y={34+ti*cH+cH/2+4} fontSize="8" fill="#fff" textAnchor="middle" fontWeight="600">{iv.toFixed(1)}%</text></g>;})} </g>)}
      </svg>
    </div>
    <div style={{marginTop:"12px",padding:"10px",background:"#0d0d18",borderRadius:"8px",fontSize:"10px",color:"#4a5568"}}><span style={{color:"#6366f1"}}>■ Low</span>&nbsp;<span style={{color:"#f59e0b"}}>■ Mid</span>&nbsp;<span style={{color:"#ef4444"}}>■ High IV</span>&nbsp;·&nbsp;{src}</div>
  </div>);
}

// ── Chain View ────────────────────────────────────────────────────────────────
function ChainView({chain,S,COST,T,r,IV,loading,error,online,sp}){
  const [tab,setTab]=useState("calls"),[enriched,setEnriched]=useState(null),[enriching,setEnriching]=useState(false);
  useEffect(()=>{if(!chain)return;(async()=>{setEnriching(true);const data=tab==="calls"?chain.calls:chain.puts;const rows=data.filter(o=>o.strike>=S*0.85&&o.strike<=S*1.20).slice(0,18);const flag=tab==="calls"?"c":"p";if(online&&rows.length>0){try{const opts=rows.map(o=>({flag,K:o.strike,sigma:o.impliedVolatility||IV,mkt_price:o.lastPrice||undefined}));const res=await apiChain(S,T,r,opts);setEnriched(rows.map((o,i)=>({...o,computed:res.results[i]})));setEnriching(false);return;}catch{}}setEnriched(rows.map(o=>{const g=bsFB(flag,S,o.strike,T,r,o.impliedVolatility||IV);return{...o,computed:{...g,iv_pct:(o.impliedVolatility||IV)*100}};}));setEnriching(false);})();},[chain,tab,online]);
  if(loading)return<div style={{display:"flex",alignItems:"center",gap:"12px",padding:"40px",justifyContent:"center",color:"#4a5568"}}><span style={{animation:"pulse 1s infinite",fontSize:"20px"}}>◎</span><span>Fetching chain...</span></div>;
  if(error||!chain)return<div style={{padding:"24px",background:"#0d0d18",borderRadius:"8px",textAlign:"center"}}><div style={{fontSize:"24px",marginBottom:"8px"}}>⚠️</div><div style={{color:"#f59e0b",fontSize:"13px",marginBottom:"4px"}}>Live chain unavailable</div><div style={{color:"#4a5568",fontSize:"11px"}}>{error}</div></div>;
  const spP=sp||sabrDef(IV,S),F=S*Math.exp(r*T);
  return(<div>
    {chain.quote&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px",marginBottom:"16px"}}>{[{l:"Last",v:`$${chain.quote.regularMarketPrice?.toFixed(2)||S}`,c:"#e2e8f0"},{l:"Change",v:`${chain.quote.regularMarketChangePercent>=0?"+":""}${chain.quote.regularMarketChangePercent?.toFixed(2)||"0"}%`,c:chain.quote.regularMarketChangePercent>=0?"#10b981":"#ef4444"},{l:"Volume",v:chain.quote.regularMarketVolume?.toLocaleString()||"N/A",c:"#94a3b8"},{l:"Greeks",v:online?"py_vollib":"@uqee",c:online?"#10b981":"#f59e0b"}].map(s=><div key={s.l} style={{background:"#0d0d18",borderRadius:"8px",padding:"12px"}}><div style={{fontSize:"9px",color:"#4a5568",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"4px"}}>{s.l}</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"15px",fontWeight:"700",color:s.c}}>{s.v}</div></div>)}</div>}
    <div style={{display:"flex",gap:"4px",marginBottom:"12px",background:"#0d0d18",borderRadius:"6px",padding:"3px",width:"200px"}}>{["calls","puts"].map(t=><button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"6px",border:"none",borderRadius:"4px",cursor:"pointer",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"'DM Mono',monospace",fontWeight:"600",background:tab===t?"#6366f1":"transparent",color:tab===t?"#fff":"#4a5568"}}>{t}</button>)}</div>
    {enriching&&<div style={{fontSize:"10px",color:"#4a5568",marginBottom:"8px",padding:"8px",background:"#0d0d18",borderRadius:"6px"}}>⏳ Computing greeks...</div>}
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:"11px"}}>
        <thead><tr style={{color:"#4a5568",borderBottom:"1px solid #1e1e2e"}}>{["Strike","Last","Bid","Ask","Mkt IV","SABR IV","IV Edge","Δ","Γ","Θ/day","V Vega","OI",""].map(h=><th key={h} style={{padding:"7px 8px",textAlign:"right",fontWeight:"400",fontSize:"9px",letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
        <tbody>{(enriched||[]).map(opt=>{const g=opt.computed||{};const isATM=Math.abs(opt.strike-S)<S*0.03,isITM=tab==="calls"?opt.strike<S:opt.strike>S;const sv=sabrIV(F,opt.strike,T,spP.alpha,spP.beta,spP.rho,spP.nu)*100,mv=(opt.impliedVolatility||0)*100,edge=mv-sv;return(<tr key={opt.contractSymbol||opt.strike} style={{borderBottom:"1px solid #0d0d18",background:isATM?"#6366f110":isITM?"#10b98108":"transparent",color:isATM?"#e2e8f0":"#94a3b8"}}>
          <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"'Space Grotesk',sans-serif",fontWeight:isATM?"600":"400",color:isATM?"#6366f1":"inherit"}}>${opt.strike}{isATM&&" ★"}</td>
          <td style={{padding:"6px 8px",textAlign:"right"}}>${opt.lastPrice?.toFixed(2)||"—"}</td>
          <td style={{padding:"6px 8px",textAlign:"right",color:"#ef4444"}}>${opt.bid?.toFixed(2)||"—"}</td>
          <td style={{padding:"6px 8px",textAlign:"right",color:"#10b981"}}>${opt.ask?.toFixed(2)||"—"}</td>
          <td style={{padding:"6px 8px",textAlign:"right",color:"#f59e0b"}}>{mv>0?mv.toFixed(1)+"%":"—"}</td>
          <td style={{padding:"6px 8px",textAlign:"right",color:"#6366f1"}}>{sv.toFixed(1)}%</td>
          <td style={{padding:"6px 8px",textAlign:"right",color:edge>1?"#10b981":edge<-1?"#ef4444":"#4a5568",fontSize:"10px"}}>{mv>0?(edge>0?"+":"")+edge.toFixed(1)+"%":"—"}</td>
          <td style={{padding:"6px 8px",textAlign:"right",color:"#6366f1"}}>{(g.delta||0).toFixed(3)}</td>
          <td style={{padding:"6px 8px",textAlign:"right",color:"#8b5cf6"}}>{(g.gamma||0).toFixed(4)}</td>
          <td style={{padding:"6px 8px",textAlign:"right",color:"#10b981"}}>${Math.abs(g.theta||0).toFixed(3)}</td>
          <td style={{padding:"6px 8px",textAlign:"right",color:"#f59e0b"}}>${(g.vega||0).toFixed(3)}</td>
          <td style={{padding:"6px 8px",textAlign:"right"}}>{opt.openInterest?.toLocaleString()||"—"}</td>
          <td style={{padding:"6px 8px",textAlign:"right"}}>{(g.delta||0)<0.25&&(g.delta||0)>0.15&&tab==="calls"&&<span style={{background:"#10b98115",color:"#10b981",border:"1px solid #10b98130",display:"inline-block",padding:"1px 6px",borderRadius:"99px",fontSize:"9px"}}>~0.20Δ</span>}</td>
        </tr>);})}
        </tbody>
      </table>
    </div>
    <div style={{marginTop:"8px",fontSize:"10px",color:"#4a5568"}}>⏱ 15-min delayed · IV Edge = Mkt IV − SABR IV</div>
  </div>);
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function CoveredCallDashboard(){
  const [form,setForm]=useState({ticker:"UAL",currentPrice:"167.76",costBasis:"197",shares:"100",strike:"175",premium:"2.50",dte:"30",iv:""});
  const [sub,setSub]=useState(false),[params,setParams]=useState(null);
  const [aiTxt,setAiTxt]=useState(""),[aiLoad,setAiLoad]=useState(false);
  const [loading,setLoading]=useState(false),[pSrc,setPSrc]=useState("simulated");
  const [chain,setChain]=useState(null),[chainLoad,setChainLoad]=useState(false),[chainErr,setChainErr]=useState(null);
  const [tab,setTab]=useState("overview"),[sp,setSP]=useState(null);
  const [online,setOnline]=useState(false),[eng,setEng]=useState("");
  const [mainG,setMainG]=useState(null);

  useEffect(()=>{const chk=async()=>{const h=await checkServer();setOnline(!!h);if(h)setEng(h.engine||"");};chk();const id=setInterval(chk,30000);return()=>clearInterval(id);},[]);

  const chg=e=>setForm(f=>({...f,[e.target.name]:e.target.value}));

  const submit=async()=>{
    const S=parseFloat(form.currentPrice),K=parseFloat(form.strike),COST=parseFloat(form.costBasis);
    const SH=parseInt(form.shares),PR=parseFloat(form.premium),DTE=parseInt(form.dte);
    if(!S||!K||!COST||!SH||!PR||!DTE)return;
    setLoading(true);
    let dp,src="simulated";
    try{dp=await fetchPrices(form.ticker.toUpperCase());dp[dp.length-1]=S;src="live";}catch{dp=fbPrices(S);}
    const IV=form.iv?parseFloat(form.iv)/100:histVol(dp)*1.15;
    const p={TICKER:form.ticker.toUpperCase()||"CUSTOM",S,K,COST,SHARES:SH,PREM:PR,DTE,IV,dailyPrices:dp};
    setParams(p);setPSrc(src);setSub(true);setAiTxt("");setLoading(false);
    const g=await computeG("c",S,K,DTE/365,0.053,IV,PR,online);setMainG(g);
    setChainLoad(true);setChainErr(null);
    try{const c=await fetchChain(form.ticker.toUpperCase());setChain(c);if(c.calls?.length>2){const F=S*Math.exp(0.053*DTE/365),mS=[],mV=[];c.calls.filter(o=>o.strike>=S*0.85&&o.strike<=S*1.15&&o.impliedVolatility>0.01).sort((a,b)=>a.strike-b.strike).forEach(o=>{mS.push(o.strike);mV.push(o.impliedVolatility);});if(mS.length>=3)setSP(calibSABR(F,DTE/365,mS,mV,0.5));}}catch(e){setChainErr(e.message);}
    setChainLoad(false);
  };

  useEffect(()=>{if(!params)return;const{S,K,DTE,IV,PREM}=params;computeG("c",S,K,DTE/365,0.053,IV,PREM,online).then(setMainG);},[online,params]);

  const reset=()=>{setSub(false);setParams(null);setAiTxt("");setPSrc("simulated");setChain(null);setTab("overview");setSP(null);setMainG(null);};

  const fetchAI=useCallback(async()=>{
    if(!params)return;
    const{TICKER,S,K,COST,SHARES,PREM,DTE,IV}=params,T=DTE/365,r=0.053;
    const g=mainG||await computeG("c",S,K,T,r,IV,PREM,online);
    const ivMkt=(g.iv_pct||g.iv*100||IV*100),aY=(PREM/S)*(365/DTE)*100;
    const spP=sp||sabrDef(IV,S),F=S*Math.exp(r*T),sIV=sabrIV(F,K,T,spP.alpha,spP.beta,spP.rho,spP.nu)*100;
    const rsi=calcRSI(params.dailyPrices),ar=arimaScore(params.dailyPrices);
    setAiLoad(true);setAiTxt("");
    const prompt=`Professional options strategist. ${g.engine||"py_vollib"} greeks.
POSITION: ${TICKER} | ${SHARES}sh | Cost $${COST} | Now $${S} | P&L $${((S-COST)*SHARES).toFixed(0)}
OPTION: Strike $${K} | Premium $${PREM} | DTE ${DTE} | Mkt IV ${ivMkt.toFixed(1)}%
BSM FV: $${(g.price||0).toFixed(2)} | Edge: ${(PREM-(g.price||0))>=0?"over":"under"}priced $${Math.abs(PREM-(g.price||0)).toFixed(2)}
GREEKS: Δ=${(g.delta||0).toFixed(4)} Γ=${(g.gamma||0).toFixed(5)} Θ=$${Math.abs(g.theta||0).toFixed(4)}/day V=$${(g.vega||0).toFixed(4)} ρ=$${(g.rho||0).toFixed(4)}
SABR: α=${spP.alpha.toFixed(3)} ρ=${spP.rho.toFixed(2)} ν=${spP.nu.toFixed(2)} | SABR IV=${sIV.toFixed(1)}% | Edge=${(ivMkt-sIV).toFixed(1)}%
ANN YIELD: ${aY.toFixed(1)}% | RSI: ${rsi?.toFixed(1)} | Momentum 5d: ${ar.momentum5.toFixed(2)}%
4 sections: 1.TIMING VERDICT 2.KEY RISKS (3 bullets, include Vega risk) 3.ALTERNATIVE STRATEGY 4.BOTTOM LINE. Be direct.`;
    try{const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":import.meta.env.VITE_ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:800,messages:[{role:"user",content:prompt}]})});const d=await res.json();setAiTxt(d.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"Analysis unavailable.");}catch{setAiTxt("Unable to fetch AI analysis.");}
    setAiLoad(false);
  },[params,mainG,sp,online]);

  useEffect(()=>{if(sub&&params&&mainG)fetchAI();},[sub,mainG]);

  // ── FORM ──────────────────────────────────────────────────────────────────
  if(!sub)return(
    <div style={{fontFamily:"'DM Mono',monospace",background:"#0a0a0f",minHeight:"100vh",color:"#e2e8f0",padding:"24px",maxWidth:"640px",margin:"0 auto"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap');input:focus{border-color:#6366f1!important;}@keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.3;}}`}</style>
      <div style={{marginBottom:"24px"}}>
        <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"26px",fontWeight:"700",letterSpacing:"-0.02em",marginBottom:"4px"}}>Covered Call Analyzer <span style={{color:"#6366f1"}}>Pro</span></div>
        <div style={{fontSize:"11px",color:"#4a5568",letterSpacing:"0.1em"}}>PY_VOLLIB · SABR · GBM MONTE CARLO · AMERICAN OPTIONS · BSM REFERENCE</div>
      </div>
      <ServerBadge online={online} engine={eng}/>
      {[{t:"Position",fields:[{n:"ticker",l:"Ticker",p:"UAL"},{n:"shares",l:"Shares",p:"100"},{n:"currentPrice",l:"Current Price ($)",p:"167.76"},{n:"costBasis",l:"Cost Basis ($)",p:"197.00"}]},{t:"Option Details",fields:[{n:"strike",l:"Strike Price ($)",p:"175"},{n:"premium",l:"Market Premium ($/share)",p:"2.50"},{n:"dte",l:"Days to Expiration",p:"30"},{n:"iv",l:"IV % (optional)",p:"Auto-calculate"}]}].map(sec=>(
      <div key={sec.t} style={{background:"#13131f",border:"1px solid #1e1e2e",borderRadius:"12px",padding:"24px",marginBottom:"16px"}}>
        <div style={{fontSize:"11px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a5568",marginBottom:"16px",borderBottom:"1px solid #1e1e2e",paddingBottom:"8px"}}>{sec.t}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px"}}>{sec.fields.map(f=><div key={f.n}><label style={LBL}>{f.l}</label><input style={INP} name={f.n} value={form[f.n]} onChange={chg} placeholder={f.p}/></div>)}</div>
      </div>))}
      <button onClick={submit} disabled={loading} style={{width:"100%",padding:"14px",background:loading?"#2d2d40":"#6366f1",border:"none",borderRadius:"8px",color:"#fff",fontSize:"13px",fontWeight:"600",cursor:loading?"not-allowed":"pointer",letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"'DM Mono',monospace"}}>
        {loading?"⏳ Fetching data...":"Analyze Position →"}
      </button>
    </div>
  );

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  const{TICKER,S,K,COST,SHARES,PREM,DTE,IV,dailyPrices}=params;
  const T=DTE/365,R=0.053;
  const g=mainG||bsFB("c",S,K,T,R,IV);
  const fv=g.price||bsFB("c",S,K,T,R,IV).price,diff=PREM-fv,diffPct=(diff/fv)*100,ivMkt=(g.iv_pct||g.iv*100||IV*100);
  const aY=(PREM/S)*(365/DTE)*100,gLPS=K-COST,tPnL=(gLPS+PREM)*SHARES,tPct=((K+PREM-COST)/COST)*100,be=COST-PREM;
  const rsi=calcRSI(dailyPrices),wrsi=calcRSI(wkP(dailyPrices)),ar=arimaScore(dailyPrices),stk=bldStrikes(S);
  const minP=Math.min(...dailyPrices),maxP=Math.max(...dailyPrices);
  const isOB=rsi>65,isTrnd=ar.momentum5>3||ar.ar1>0.15,abvCost=K>COST;
  const nR=[{price:parseFloat((S*1.025).toFixed(2))},{price:parseFloat((S*1.05).toFixed(2))},{price:parseFloat((S*1.10).toFixed(2))},{price:COST}].sort((a,b)=>a.price-b.price).some(r=>Math.abs(r.price-K)<S*0.03);
  let rec,rcol,ricon;
  if(!isOB&&isTrnd&&!abvCost){rec="WAIT — Trending strongly, strike below cost basis.";rcol="#f59e0b";ricon="⏳";}
  else if(isOB&&nR&&abvCost){rec="FAVORABLE — RSI elevated, strike at resistance, above cost basis.";rcol="#10b981";ricon="✅";}
  else if(!abvCost){rec="WAIT — Strike below cost basis. Selling here locks in a loss.";rcol="#ef4444";ricon="🚫";}
  else{rec="NEUTRAL — Mixed conditions. Review all tabs.";rcol="#8b5cf6";ricon="⚖️";}
  const spW=400,spH=70,px=p=>Math.max(2,Math.min(spH-2,spH-((p-minP)/(maxP-minP||1))*spH));
  const spPath=dailyPrices.map((p,i)=>`${i===0?"M":"L"}${i/(dailyPrices.length-1)*spW},${px(p)}`).join("");
  const rsiC=v=>v>70?"#ef4444":v>60?"#f59e0b":v<40?"#06b6d4":"#10b981";
  const isOP=diff>0,isSig=Math.abs(diffPct)>10;
  const fvV=isOP?isSig?{l:"Overpriced",c:"#10b981",i:"🟢",d:`$${diff.toFixed(2)} (${diffPct.toFixed(1)}%) above BSM. Strong edge.`}:{l:"Slightly Over",c:"#86efac",i:"🟡",d:`$${diff.toFixed(2)} above FV.`}:isSig?{l:"Underpriced",c:"#ef4444",i:"🔴",d:`$${Math.abs(diff).toFixed(2)} below FV.`}:{l:"Fair Value",c:"#94a3b8",i:"⚪",d:`Within $${Math.abs(diff).toFixed(2)} of FV.`};
  const greeks=[{n:"Δ Delta",v:(g.delta||0).toFixed(4),c:"#6366f1",d:`~${((g.delta||0)*100).toFixed(0)}% ITM prob.`},{n:"Γ Gamma",v:(g.gamma||0).toFixed(5),c:"#8b5cf6",d:"Delta shifts per $1."},{n:"Θ Theta",v:`$${Math.abs(g.theta||0).toFixed(4)}`,c:"#10b981",d:"Daily decay."},{n:"V Vega",v:`$${(g.vega||0).toFixed(4)}`,c:"#f59e0b",d:"Per 1% IV shift."},{n:"ρ Rho",v:`$${(g.rho||0).toFixed(4)}`,c:"#06b6d4",d:"Per 1% rate move."}];
  const engLabel=g.engine||"py_vollib";
  const tabs=[
    {id:"overview",label:"Overview",icon:"📊"},{id:"payoff",label:"Payoff",icon:"📈"},
    {id:"montecarlo",label:"Monte Carlo",icon:"🎲"},{id:"volsurface",label:"Vol Surface",icon:"🌊"},
    {id:"chain",label:"Chain",icon:"🔗"},{id:"american",label:"American",icon:"🇺🇸"},
    {id:"bsm",label:"BSM Ref",icon:"📐"},{id:"ai",label:"AI Analysis",icon:"🤖"},
  ];

  return(
    <div style={{fontFamily:"'DM Mono',monospace",background:"#0a0a0f",minHeight:"100vh",color:"#e2e8f0",padding:"20px",maxWidth:"1020px",margin:"0 auto"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap');.card{background:#13131f;border:1px solid #1e1e2e;border-radius:12px;padding:20px;}.card-dark{background:#0d0d18;border:1px solid #1a1a2e;border-radius:12px;padding:20px;}.label{font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#4a5568;margin-bottom:4px;}.badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;font-weight:600;}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}.st{font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#4a5568;margin-bottom:12px;border-bottom:1px solid #1e1e2e;padding-bottom:8px;}.greek{background:#0d0d18;border:1px solid #1a1a2e;border-radius:8px;padding:14px;}.rsi-bar{height:6px;background:#1e1e2e;border-radius:3px;overflow:hidden;margin-top:6px;}.rsi-fill{height:100%;border-radius:3px;}.ai-text{font-size:13px;line-height:1.8;color:#94a3b8;white-space:pre-wrap;}.pulse{animation:pulse 2s infinite;}@keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}input:focus{border-color:#6366f1!important;}`}</style>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
            <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"26px",fontWeight:"700"}}>{TICKER}</span>
            <span className="badge" style={{background:"#1a1a2e",color:"#64748b",border:"1px solid #2d2d40"}}>COVERED CALL PRO</span>
            <span className="badge" style={{background:pSrc==="live"?"#10b98120":"#f59e0b20",color:pSrc==="live"?"#10b981":"#f59e0b",border:`1px solid ${pSrc==="live"?"#10b98140":"#f59e0b40"}`}}>{pSrc==="live"?"● Live":"◌ Sim"}</span>
          </div>
          <div style={{fontSize:"11px",color:"#4a5568",marginTop:"3px"}}>{SHARES} shares · Strike ${K} · Premium ${PREM} · DTE {DTE}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
          <div style={{textAlign:"right"}}>
            <div className="label">CURRENT</div>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"26px",fontWeight:"700"}}>${S}</div>
            <div style={{fontSize:"11px",color:S>=COST?"#10b981":"#ef4444"}}>{S>=COST?`↑ $${(S-COST).toFixed(2)} above`:`↓ $${(COST-S).toFixed(2)} below`} cost</div>
          </div>
          <button onClick={reset} style={{background:"#1e1e2e",border:"1px solid #2d2d40",borderRadius:"6px",color:"#94a3b8",fontSize:"10px",padding:"6px 14px",cursor:"pointer",letterSpacing:"0.1em",textTransform:"uppercase"}}>← New</button>
        </div>
      </div>

      <ServerBadge online={online} engine={eng}/>

      <div style={{background:`${rcol}15`,border:`1px solid ${rcol}40`,borderRadius:"10px",padding:"14px 18px",marginBottom:"16px",display:"flex",gap:"12px",alignItems:"center"}}>
        <span style={{fontSize:"20px"}}>{ricon}</span>
        <div><div style={{fontSize:"9px",letterSpacing:"0.15em",textTransform:"uppercase",color:rcol,marginBottom:"3px",fontWeight:"600"}}>System Recommendation</div><div style={{fontSize:"13px",color:"#e2e8f0"}}>{rec}</div></div>
      </div>

      <TabBar tabs={tabs} active={tab} onChange={setTab}/>

      {/* ── Overview ── */}
      {tab==="overview"&&(<div>
        <div className="card" style={{marginBottom:"14px"}}>
          <div className="st">Option Fair Value · {engLabel}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"10px",marginBottom:"14px"}}>
            {[{l:"BSM Fair Value",v:`$${fv.toFixed(2)}`,c:"#6366f1",s:engLabel},{l:"Market Premium",v:`$${PREM.toFixed(2)}`,c:"#e2e8f0",s:"you collect"},{l:"IV Edge",v:`${diff>=0?"+":""}$${diff.toFixed(2)}`,c:diff>=0?"#10b981":"#ef4444",s:`${Math.abs(diffPct).toFixed(1)}% ${diff>=0?"over":"under"}`},{l:"Implied IV",v:`${ivMkt.toFixed(1)}%`,c:"#f59e0b",s:`model: ${(IV*100).toFixed(1)}%`}].map(it=>(
            <div key={it.l} style={{background:"#0d0d18",borderRadius:"8px",padding:"12px"}}><div className="label">{it.l}</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"20px",fontWeight:"700",color:it.c}}>{it.v}</div><div style={{fontSize:"9px",color:"#4a5568",marginTop:"2px"}}>{it.s}</div></div>))}
          </div>
          <div style={{background:"#0d0d18",borderRadius:"8px",padding:"12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:"11px",color:"#4a5568"}}>{fvV.d}</div>
            <span className="badge" style={{background:`${fvV.c}20`,color:fvV.c,border:`1px solid ${fvV.c}40`,flexShrink:0,marginLeft:"12px"}}>{fvV.i} {fvV.l}</span>
          </div>
        </div>
        <div className="grid2" style={{marginBottom:"14px"}}>
          <div className="card">
            <div className="st">Price History (90d) · {TICKER}</div>
            <svg width="100%" viewBox={`0 0 ${spW} ${spH+10}`} style={{overflow:"visible"}}>
              <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity="0.3"/><stop offset="100%" stopColor="#6366f1" stopOpacity="0"/></linearGradient></defs>
              <path d={spPath+`L${spW},${spH} L0,${spH}Z`} fill="url(#ag)"/>
              <path d={spPath} fill="none" stroke="#6366f1" strokeWidth="1.5"/>
              <line x1="0" y1={px(COST)} x2={spW} y2={px(COST)} stroke="#ef4444" strokeWidth="1" strokeDasharray="4,3" opacity="0.7"/>
              <text x={spW-2} y={Math.max(8,px(COST)-3)} fontSize="7" fill="#ef4444" textAnchor="end">Cost ${COST}</text>
              <line x1="0" y1={px(K)} x2={spW} y2={px(K)} stroke="#10b981" strokeWidth="1" strokeDasharray="4,3" opacity="0.7"/>
              <text x={spW-2} y={Math.max(8,px(K)-3)} fontSize="7" fill="#10b981" textAnchor="end">Strike ${K}</text>
              <circle cx={spW} cy={px(S)} r="4" fill="#6366f1"/>
            </svg>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:"6px",padding:"6px",background:"#0d0d18",borderRadius:"6px"}}>
              {[{l:"Low",v:`$${minP.toFixed(0)}`,c:"#ef4444"},{l:"High",v:`$${maxP.toFixed(0)}`,c:"#10b981"},{l:"Range",v:`$${(maxP-minP).toFixed(0)}`,c:"#94a3b8"}].map(s=><div key={s.l} style={{textAlign:"center"}}><div style={{fontSize:"9px",color:"#4a5568",textTransform:"uppercase",letterSpacing:"0.1em"}}>{s.l}</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"13px",fontWeight:"600",color:s.c}}>{s.v}</div></div>)}
            </div>
          </div>
          <div className="card">
            <div className="st">Position Summary</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
              {[{l:"Cost Basis",v:`$${COST}`,c:"#94a3b8"},{l:"Breakeven",v:`$${be.toFixed(2)}`,c:"#f59e0b"},{l:"Unrealized P&L",v:`${S>=COST?"+":"-"}$${Math.abs((S-COST)*SHARES).toFixed(0)}`,c:S>=COST?"#10b981":"#ef4444"},{l:"Ann. Yield",v:`${aY.toFixed(1)}%`,c:"#10b981"}].map(it=><div key={it.l} style={{background:"#0d0d18",borderRadius:"8px",padding:"10px"}}><div className="label">{it.l}</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"16px",fontWeight:"600",color:it.c}}>{it.v}</div></div>)}
            </div>
            <div style={{marginTop:"10px",background:"#0d0d18",borderRadius:"8px",padding:"12px",borderLeft:"3px solid #6366f1"}}>
              <div className="label">If Called Away at ${K}</div>
              <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"15px",fontWeight:"600",color:tPnL>=0?"#10b981":"#ef4444"}}>{tPnL>=0?"+":" "}${tPnL.toFixed(0)} ({tPct.toFixed(1)}%)</div>
              <div style={{fontSize:"10px",color:"#4a5568",marginTop:"2px"}}>Stock {gLPS>=0?"gain":"loss"} ${Math.abs(gLPS*SHARES).toFixed(0)} + premium ${(PREM*SHARES).toFixed(0)}</div>
            </div>
          </div>
        </div>
        <div className="grid2" style={{marginBottom:"14px"}}>
          <div className="card">
            <div className="st">RSI Analysis</div>
            {[{l:"Daily RSI (14)",v:rsi,k:"D"},{l:"Weekly RSI (14)",v:wrsi,k:"W"}].map(r=>(
            <div key={r.k} style={{marginBottom:"14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
                <span style={{fontSize:"12px",color:"#94a3b8"}}>{r.l}</span>
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"20px",fontWeight:"600",color:rsiC(r.v)}}>{r.v?.toFixed(1)}</span>
                  <span className="badge" style={{background:r.v>70?"#ef444420":r.v>60?"#f59e0b20":r.v<40?"#06b6d420":"#10b98120",color:rsiC(r.v),border:`1px solid ${rsiC(r.v)}40`}}>{r.v>70?"Overbought":r.v>60?"Elevated":r.v<40?"Oversold":"Neutral"}</span>
                </div>
              </div>
              <div className="rsi-bar"><div className="rsi-fill" style={{width:`${r.v}%`,background:rsiC(r.v)}}/></div>
            </div>))}
            <div style={{background:"#0d0d18",borderRadius:"8px",padding:"10px"}}><div style={{fontSize:"11px",color:"#94a3b8"}}>{rsi>70?"⚠️ Overbought — good time to sell calls":rsi>60?"📊 Elevated — approaching overbought":rsi<40?"📉 Oversold — avoid selling":"😐 Neutral RSI"}</div></div>
          </div>
          <div className="card">
            <div className="st">Greeks · {engLabel} · ${K}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"10px"}}>
              {greeks.map(g=><div key={g.n} className="greek"><div style={{fontSize:"10px",color:g.c,fontWeight:"600",marginBottom:"2px"}}>{g.n}</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"17px",fontWeight:"700",marginBottom:"4px"}}>{g.v}</div><div style={{fontSize:"9px",color:"#4a5568",lineHeight:"1.5"}}>{g.d}</div></div>)}
            </div>
            <div style={{background:"#0d0d18",borderRadius:"8px",padding:"10px",display:"flex",justifyContent:"space-between"}}>
              <div><div className="label">Premium/share</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:"#10b981"}}>${PREM}</div></div>
              <div style={{textAlign:"right"}}><div className="label">Total</div><div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:"18px",fontWeight:"700",color:"#10b981"}}>${(PREM*SHARES).toFixed(0)}</div></div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="st">Strike Ladder · {DTE} DTE · {(IV*100).toFixed(1)}% IV</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:"11px"}}>
              <thead><tr style={{color:"#4a5568",borderBottom:"1px solid #1e1e2e"}}>{["Strike","Delta","Gamma","BSM Price","Mkt vs FV","Ann Yield","vs Cost",""].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"right",fontWeight:"400",fontSize:"9px",letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
              <tbody>
                {stk.filter(k=>k>=S*0.95&&k<=S*1.25).map(k=>{const b=bsFB("c",S,k,T,R,IV),ay=(b.price/S)*(365/DTE)*100,sel=k===K,md=sel?PREM-b.price:null;return(<tr key={k} style={{borderBottom:"1px solid #0d0d18",background:sel?"#6366f115":"transparent",color:sel?"#e2e8f0":"#94a3b8"}}>
                  <td style={{padding:"6px 10px",textAlign:"right",fontFamily:"'Space Grotesk',sans-serif",fontWeight:sel?"600":"400",color:sel?"#6366f1":"inherit"}}>${k}{sel&&" ★"}</td>
                  <td style={{padding:"6px 10px",textAlign:"right"}}>{sel?(g.delta||b.delta).toFixed(4):b.delta.toFixed(3)}</td>
                  <td style={{padding:"6px 10px",textAlign:"right",color:"#8b5cf6"}}>{sel?(g.gamma||b.gamma).toFixed(5):b.gamma.toFixed(4)}</td>
                  <td style={{padding:"6px 10px",textAlign:"right",color:"#6366f1"}}>${(sel?fv:b.price).toFixed(2)}</td>
                  <td style={{padding:"6px 10px",textAlign:"right",color:md!=null?(md>=0?"#10b981":"#ef4444"):"#4a5568"}}>{md!=null?(md>=0?`+$${md.toFixed(2)}`:`-$${Math.abs(md).toFixed(2)}`):"—"}</td>
                  <td style={{padding:"6px 10px",textAlign:"right",color:ay>15?"#10b981":ay>8?"#f59e0b":"#94a3b8"}}>{ay.toFixed(1)}%</td>
                  <td style={{padding:"6px 10px",textAlign:"right",color:k>=COST?"#10b981":"#ef4444"}}>{k>=COST?"✓ Above":`-$${(COST-k).toFixed(0)}`}</td>
                  <td style={{padding:"6px 10px",textAlign:"right"}}>{b.delta<0.25&&b.delta>0.15&&<span className="badge" style={{background:"#10b98115",color:"#10b981",border:"1px solid #10b98130",fontSize:"9px"}}>~0.20Δ</span>}</td>
                </tr>);})}
              </tbody>
            </table>
          </div>
        </div>
      </div>)}

      {tab==="payoff"&&<div className="card"><div className="st">Payoff Diagram at Expiration</div><Payoff S={S} K={K} COST={COST} PREM={PREM} SHARES={SHARES}/></div>}

      {/* ── Monte Carlo — now uses full Kyle GBM component ── */}
      {tab==="montecarlo"&&(
        <div className="card">
          <div className="st">GBM Monte Carlo · S[t] = S[t−1]·exp((μ−σ²/2)·Δt + σ·√Δt·Z)</div>
          <MonteCarloGBM S={S} IV={IV}/>
        </div>
      )}

      {tab==="volsurface"&&<div className="card"><div className="st">SABR Volatility Surface · Hagan 2002</div><VolSurface S={S} IV={IV} r={R} T={T} chain={chain} online={online}/></div>}
      {tab==="chain"&&<div className="card"><div className="st">Live Options Chain · {TICKER} · Yahoo Finance</div><ChainView chain={chain} S={S} COST={COST} T={T} r={R} IV={IV} loading={chainLoad} error={chainErr} online={online} sp={sp}/></div>}
      {tab==="american"&&<div className="card"><div className="st">American Options · BS1993 · BS2002 · CRR Binomial Tree</div><AmericanTab S={S} K={K} T={T} r={R} IV={IV} PREM={PREM} serverOnline={online} COST={COST} SHARES={SHARES}/></div>}

      {/* ── BSM Reference — pre-populated with current position ── */}
      {tab==="bsm"&&(
        <div className="card">
          <div className="st">BSM Formula Reference · Generalised Black-Scholes-Merton · Live Sliders</div>
          <BSMReference defaultS={S} defaultK={K} defaultDTE={DTE} defaultIV={Math.round(IV*100)}/>
        </div>
      )}

      {tab==="ai"&&<div className="card-dark"><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}><div className="st" style={{marginBottom:0}}>AI Strategist · {engLabel}</div><button onClick={fetchAI} style={{background:"#1e1e2e",border:"1px solid #2d2d40",borderRadius:"6px",color:"#94a3b8",fontSize:"10px",padding:"5px 14px",cursor:"pointer",letterSpacing:"0.1em",textTransform:"uppercase"}}>↺ Refresh</button></div>{aiLoad?<div style={{display:"flex",alignItems:"center",gap:"10px",color:"#4a5568",padding:"20px 0"}}><span className="pulse">●</span><span style={{fontSize:"12px"}}>Analyzing...</span></div>:<div className="ai-text">{aiTxt||"Click Refresh."}</div>}</div>}

      <div style={{textAlign:"center",marginTop:"20px",fontSize:"9px",color:"#2d3748",letterSpacing:"0.1em"}}>
        {TICKER} · {online?"PY_VOLLIB":"@UQEE"} · SABR HAGAN 2002 · GBM MC · AMERICAN BS1993/BS2002/CRR · BSM REF · {pSrc==="live"?"LIVE":"SIM"}
      </div>
    </div>
  );
}
