"""
Greeks API Server — py_vollib + American Options
Models: Bjerksund-Stensland 1993, Bjerksund-Stensland 2002, CRR Binomial Tree
Based on dedwards25/Python_Option_Pricing GBS methodology

Install:
    pip install py_vollib flask flask-cors numpy

Run:
    python greeks_server.py
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import math, random

app = Flask(__name__)
CORS(app)

# ── py_vollib ─────────────────────────────────────────────────────────────────
try:
    from py_vollib.black_scholes_merton.greeks.analytical import delta, gamma, theta, vega, rho
    from py_vollib.black_scholes_merton import black_scholes_merton as bsm_price
    from py_vollib.black_scholes_merton.implied_volatility import implied_volatility as bsm_iv
    VOLLIB_OK = True
    ENGINE = "py_vollib (LetsBeRational)"
except ImportError:
    VOLLIB_OK = False
    ENGINE = "manual BSM fallback"
    print("⚠️  py_vollib not found — run: pip install py_vollib")

try:
    import numpy as np
    NUMPY_OK = True
except ImportError:
    NUMPY_OK = False

# ═══════════════════════════════════════════════════════════════════════
# MATH HELPERS
# ═══════════════════════════════════════════════════════════════════════
def _N(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

def _n(x):
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)

def _gbs(flag, F, X, T, r, b, v):
    """Generalized Black-Scholes price (cost-of-carry form)."""
    if T <= 1e-10:
        return max(F - X, 0) if flag == 'c' else max(X - F, 0)
    d1 = (math.log(F / X) + (b + 0.5 * v**2) * T) / (v * math.sqrt(T))
    d2 = d1 - v * math.sqrt(T)
    if flag == 'c':
        return F * math.exp((b - r) * T) * _N(d1) - X * math.exp(-r * T) * _N(d2)
    return X * math.exp(-r * T) * _N(-d2) - F * math.exp((b - r) * T) * _N(-d1)

# ═══════════════════════════════════════════════════════════════════════
# BJERKSUND-STENSLAND 1993
# dedwards25 GBS notebook — American option approximation
# ═══════════════════════════════════════════════════════════════════════
def _phi(S, T, gamma_bs, H, I, r, b, v):
    lam = (-r + gamma_bs * b + 0.5 * gamma_bs * (gamma_bs - 1.0) * v**2) * T
    d   = -(math.log(S / H) + (b + (gamma_bs - 0.5) * v**2) * T) / (v * math.sqrt(T))
    kap = 2.0 * b / v**2 + (2.0 * gamma_bs - 1.0)
    return (math.exp(lam) * S**gamma_bs
            * (_N(d) - (I / S)**kap * _N(d - 2.0 * math.log(I / S) / (v * math.sqrt(T)))))


def _american_call_1993(F, X, T, r, b, v):
    if b >= r:
        return _gbs('c', F, X, T, r, b, v)
    beta  = (0.5 - b / v**2) + math.sqrt((b / v**2 - 0.5)**2 + 2.0 * r / v**2)
    Binf  = beta / (beta - 1.0) * X
    B0    = max(X, r / (r - b) * X)
    ht    = -(b * T + 2.0 * v * math.sqrt(T)) * B0 / (Binf - B0)
    I     = B0 + (Binf - B0) * (1.0 - math.exp(ht))
    alpha = (I - X) * I**(-beta)
    if F >= I:
        return F - X
    return (alpha * F**beta
            - alpha * _phi(F, T, beta, I, I, r, b, v)
            + _phi(F, T, 1.0, I, I, r, b, v)
            - _phi(F, T, 1.0, X, I, r, b, v)
            - X * _phi(F, T, 0.0, I, I, r, b, v)
            + X * _phi(F, T, 0.0, X, I, r, b, v))


def american_bs1993(flag, S, K, T, r, b, v):
    """Bjerksund-Stensland 1993. Uses put-call symmetry for puts."""
    if flag == 'c':
        return _american_call_1993(S, K, T, r, b, v)
    # Put via symmetry: price put as call on mirrored problem
    return _american_call_1993(K, S, T, r - b, -b, v)


# ═══════════════════════════════════════════════════════════════════════
# BJERKSUND-STENSLAND 2002  (refinement with two-piece approximation)
# ═══════════════════════════════════════════════════════════════════════
def _american_call_2002(F, X, T, r, b, v):
    if b >= r:
        return _gbs('c', F, X, T, r, b, v)

    beta  = (0.5 - b / v**2) + math.sqrt((b / v**2 - 0.5)**2 + 2.0 * r / v**2)
    Binf  = beta / (beta - 1.0) * X
    B0    = max(X, r / (r - b) * X)

    ht1   = -(b * T / 2.0 + 2.0 * v * math.sqrt(T / 2.0)) * X**2 / ((Binf - B0) * B0)
    ht2   = -(b * T + 2.0 * v * math.sqrt(T)) * X**2 / ((Binf - B0) * B0)
    I1    = B0 + (Binf - B0) * (1.0 - math.exp(ht1))
    I2    = B0 + (Binf - B0) * (1.0 - math.exp(ht2))
    alpha1 = (I1 - X) * I1**(-beta)
    alpha2 = (I2 - X) * I2**(-beta)

    if F >= I2:
        return F - X

    # Two-piece phi construction
    return (alpha2 * F**beta
            - alpha2 * _phi(F, T, beta, I2, I2, r, b, v)
            + _phi(F, T, 1.0, I2, I2, r, b, v)
            - _phi(F, T, 1.0, X, I2, r, b, v)
            - X * _phi(F, T, 0.0, I2, I2, r, b, v)
            + X * _phi(F, T, 0.0, X, I2, r, b, v)
            + alpha1 * _phi(F, T, beta, I1, I2, r, b, v)
            - alpha1 * _phi(F, T / 2.0, beta, I1, I1, r, b, v)
            + _phi(F, T / 2.0, 1.0, I1, I2, r, b, v)
            - _phi(F, T / 2.0, 1.0, X, I1, r, b, v)
            - X * _phi(F, T / 2.0, 0.0, I1, I2, r, b, v)
            + X * _phi(F, T / 2.0, 0.0, X, I1, r, b, v))


def american_bs2002(flag, S, K, T, r, b, v):
    """Bjerksund-Stensland 2002 — most accurate closed-form American."""
    if flag == 'c':
        return _american_call_2002(S, K, T, r, b, v)
    return _american_call_2002(K, S, T, r - b, -b, v)


# ═══════════════════════════════════════════════════════════════════════
# CRR BINOMIAL TREE  (gold standard numerical method)
# Cox-Ross-Rubinstein 1979
# ═══════════════════════════════════════════════════════════════════════
def american_binomial_crr(flag, S, K, T, r, q, v, n=500):
    """
    CRR binomial tree for American options.
    n=500 gives very high accuracy (~0.01% error vs true price).
    """
    if T <= 1e-10:
        intrinsic = max(S - K, 0) if flag == 'c' else max(K - S, 0)
        return {"price": intrinsic, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0,
                "early_exercise_premium": 0.0, "european_equivalent": 0.0}

    dt    = T / n
    u     = math.exp(v * math.sqrt(dt))
    d     = 1.0 / u
    pu    = (math.exp((r - q) * dt) - d) / (u - d)
    pd    = 1.0 - pu
    disc  = math.exp(-r * dt)

    def _tree(s, k, t_local, vv, nsteps):
        """Build CRR tree and return price."""
        if t_local <= 1e-10:
            return max(s - k, 0) if flag == 'c' else max(k - s, 0)
        dt_l = t_local / nsteps
        ul   = math.exp(vv * math.sqrt(dt_l))
        dl   = 1.0 / ul
        pul  = (math.exp((r - q) * dt_l) - dl) / (ul - dl)
        pdl  = 1.0 - pul
        dcl  = math.exp(-r * dt_l)
        if NUMPY_OK:
            j  = np.arange(nsteps + 1)
            ST = s * ul ** (2 * j - nsteps)
            V  = np.maximum(ST - k, 0.0) if flag == 'c' else np.maximum(k - ST, 0.0)
            for i in range(nsteps - 1, -1, -1):
                ST2 = s * ul ** (2 * np.arange(i + 1) - i)
                intr = np.maximum(ST2 - k, 0.0) if flag == 'c' else np.maximum(k - ST2, 0.0)
                V = np.maximum(dcl * (pul * V[1:i+2] + pdl * V[0:i+1]), intr)
            return float(V[0])
        else:
            V = [max(s * ul**(2*j - nsteps) - k, 0) if flag == 'c'
                 else max(k - s * ul**(2*j - nsteps), 0)
                 for j in range(nsteps + 1)]
            for i in range(nsteps - 1, -1, -1):
                V = [max(dcl * (pul * V[j+1] + pdl * V[j]),
                         max(s * ul**(2*j - i) - k, 0) if flag == 'c'
                         else max(k - s * ul**(2*j - i), 0))
                     for j in range(i + 1)]
            return V[0]

    price = _tree(S, K, T, v, n)

    # Greeks via finite differences (use smaller tree for speed)
    ng   = 60
    h_s  = S * 0.01
    h_v  = 0.001
    h_t  = 1.0 / 365.0

    pu_  = _tree(S + h_s,     K, T, v,       ng)
    pd_  = _tree(S - h_s,     K, T, v,       ng)
    p0_  = _tree(S,           K, T, v,       ng)
    puu_ = _tree(S + 2 * h_s, K, T, v,       ng)
    pdd_ = _tree(S - 2 * h_s, K, T, v,       ng)
    pv1_ = _tree(S,           K, T, v + h_v, ng)
    pv2_ = _tree(S,           K, T, v - h_v, ng)
    pt_  = _tree(S,           K, max(T - h_t, 1e-6), v, ng)

    delta_v = (pu_ - pd_) / (2 * h_s)
    gamma_v = (pu_ - 2 * p0_ + pd_) / h_s**2
    theta_v = (pt_ - p0_) / h_t / 365.0   # per day
    vega_v  = (pv1_ - pv2_) / (2 * h_v * 100)  # per 1% IV

    euro = _gbs(flag, S, K, T, r, r - q, v)
    eep  = max(0.0, price - euro)

    return {
        "price":                    round(price, 6),
        "delta":                    round(delta_v, 6),
        "gamma":                    round(gamma_v, 6),
        "theta":                    round(theta_v, 6),
        "vega":                     round(vega_v, 6),
        "early_exercise_premium":   round(eep, 6),
        "european_equivalent":      round(euro, 6),
        "model":                    f"CRR Binomial Tree n={n}",
    }


# ── Early exercise boundary ────────────────────────────────────────────────────
def early_exercise_boundary(flag, S, K, T, r, q, v, n_pts=25):
    """Critical stock price at each time slice where early exercise is optimal."""
    boundary = []
    for i in range(1, n_pts + 1):
        t = T * i / n_pts
        # Binary search for S* where American price = intrinsic value
        lo, hi = K * 0.2, K * 3.0
        for _ in range(40):
            mid = (lo + hi) / 2.0
            b = r - q
            try:
                am  = american_bs2002(flag, mid, K, t, r, b, v)
                intr = max(mid - K, 0) if flag == 'c' else max(K - mid, 0)
                if am - intr < 0.005:
                    if flag == 'c': hi = mid
                    else: lo = mid
                else:
                    if flag == 'c': lo = mid
                    else: hi = mid
            except:
                break
        boundary.append({"t_remaining": round(t, 4), "critical_price": round((lo + hi) / 2, 2)})
    return boundary


# ── European Greeks (py_vollib or manual) ─────────────────────────────────────
def compute_greeks_european(flag, S, K, t, r, sigma, q=0.0, mkt_price=None):
    result = {"engine": ENGINE, "flag": flag}
    b = r - q
    iv = sigma
    if mkt_price is not None and mkt_price > 0 and t > 0:
        try:
            iv = bsm_iv(mkt_price, S, K, t, r, q, flag) if VOLLIB_OK else _iv_search(flag, S, K, t, r, b, mkt_price)
        except: pass
    result["iv"] = iv; result["iv_pct"] = round(iv * 100, 4)
    if VOLLIB_OK:
        try:
            result["price"] = round(bsm_price(flag, S, K, t, r, iv, q), 6)
            result["delta"] = round(delta(flag, S, K, t, r, iv, q), 6)
            result["gamma"] = round(gamma(flag, S, K, t, r, iv, q), 6)
            result["theta"] = round(theta(flag, S, K, t, r, iv, q), 6)
            result["vega"]  = round(vega(flag, S, K, t, r, iv, q), 6)
            result["rho"]   = round(rho(flag, S, K, t, r, iv, q), 6)
            return result
        except: pass
    # Manual fallback
    result.update(_manual_greeks(flag, S, K, t, r, b, iv))
    return result

def _iv_search(flag, S, K, t, r, b, mkt):
    lo, hi = 0.001, 5.0
    for _ in range(100):
        mid = (lo + hi) / 2
        p = _gbs(flag, S, K, t, r, b, mid)
        if abs(p - mkt) < 0.0001: return mid
        if p > mkt: hi = mid
        else: lo = mid
    return (lo + hi) / 2

def _manual_greeks(flag, S, K, t, r, b, v):
    if t <= 0:
        price = max(S-K,0) if flag=='c' else max(K-S,0)
        return {"price":price,"delta":1.0 if S>K else 0.0,"gamma":0,"theta":0,"vega":0,"rho":0}
    d1=(math.log(S/K)+(b+0.5*v**2)*t)/(v*math.sqrt(t)); d2=d1-v*math.sqrt(t)
    if flag=='c':
        price=S*math.exp((b-r)*t)*_N(d1)-K*math.exp(-r*t)*_N(d2)
        dlt=math.exp((b-r)*t)*_N(d1); rh=K*t*math.exp(-r*t)*_N(d2)/100
    else:
        price=K*math.exp(-r*t)*_N(-d2)-S*math.exp((b-r)*t)*_N(-d1)
        dlt=-math.exp((b-r)*t)*_N(-d1); rh=-K*t*math.exp(-r*t)*_N(-d2)/100
    gm=_n(d1)*math.exp((b-r)*t)/(S*v*math.sqrt(t))
    th=(-S*_n(d1)*v*math.exp((b-r)*t)/(2*math.sqrt(t))-(b-r)*S*(_N(d1) if flag=='c' else -_N(-d1))*math.exp((b-r)*t)-r*K*math.exp(-r*t)*(_N(d2) if flag=='c' else _N(-d2)))/365
    vg=S*_n(d1)*math.sqrt(t)*math.exp((b-r)*t)/100
    return {"price":round(price,6),"delta":round(dlt,6),"gamma":round(gm,6),"theta":round(th,6),"vega":round(vg,6),"rho":round(rh,6)}


# ═══════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════

@app.route("/greeks", methods=["POST"])
def greeks_ep():
    d=request.get_json()
    if not d: return jsonify({"error":"No body"}),400
    miss=[f for f in ["flag","S","K","t","r","sigma"] if f not in d]
    if miss: return jsonify({"error":f"Missing:{miss}"}),400
    try:
        return jsonify(compute_greeks_european(d["flag"],float(d["S"]),float(d["K"]),float(d["t"]),float(d["r"]),float(d["sigma"]),float(d.get("q",0)),float(d["mkt_price"]) if "mkt_price" in d else None))
    except Exception as e: return jsonify({"error":str(e)}),500


@app.route("/american", methods=["POST"])
def american_ep():
    """
    POST /american
    {
        "flag":   "c" | "p",
        "S":      167.76,
        "K":      175,
        "T":      0.0822,
        "r":      0.053,
        "q":      0.0,
        "sigma":  0.35,
        "n_tree": 500
    }
    Returns prices from BS1993, BS2002, CRR tree, European BSM,
    plus early exercise premium and exercise boundary.
    """
    d = request.get_json()
    if not d: return jsonify({"error":"No body"}),400
    try:
        flag = d["flag"]; S=float(d["S"]); K=float(d["K"]); T=float(d["T"])
        r=float(d["r"]); q=float(d.get("q",0)); v=float(d["sigma"]); n_t=int(d.get("n_tree",500))
        b = r - q
        res = {}

        # 1 — Bjerksund-Stensland 1993
        try:
            p93 = american_bs1993(flag, S, K, T, r, b, v)
            res["bs1993"] = {"price":round(p93,6),"model":"Bjerksund-Stensland 1993",
                "description":"Fast closed-form approximation (1993). Good baseline, less accurate deep ITM."}
        except Exception as e: res["bs1993"]={"error":str(e)}

        # 2 — Bjerksund-Stensland 2002
        try:
            p02 = american_bs2002(flag, S, K, T, r, b, v)
            res["bs2002"] = {"price":round(p02,6),"model":"Bjerksund-Stensland 2002",
                "description":"Improved two-piece closed-form (2002). Most accurate closed-form for equity options."}
        except Exception as e: res["bs2002"]={"error":str(e)}

        # 3 — CRR Binomial Tree
        try:
            crr = american_binomial_crr(flag, S, K, T, r, q, v, n=n_t)
            crr["model"] = f"CRR Binomial Tree (n={n_t})"
            crr["description"] = "Gold standard. Numerical convergence to true American price. Greeks via finite difference."
            res["crr"] = crr
        except Exception as e: res["crr"]={"error":str(e)}

        # 4 — European BSM (for comparison)
        try:
            euro = compute_greeks_european(flag, S, K, T, r, v, q)
            res["european"] = {**euro,
                "model": "European BSM ("+ENGINE+")",
                "description": "European equivalent. American ≥ European. Difference = early exercise premium."}
        except Exception as e: res["european"]={"error":str(e)}

        # 5 — Early exercise premium
        crr_p  = res.get("crr",{}).get("price")
        euro_p = res.get("european",{}).get("price")
        eep = max(0, crr_p - euro_p) if crr_p and euro_p else 0
        res["early_exercise_premium"] = round(eep, 6)
        res["early_exercise_pct"]     = round(eep / euro_p * 100, 2) if euro_p and euro_p > 0 else 0

        # 6 — Model spread (agreement quality)
        prices=[v2 for v2 in [res.get("bs1993",{}).get("price"),res.get("bs2002",{}).get("price"),crr_p] if v2]
        res["model_spread"]     = round(max(prices)-min(prices),4) if len(prices)>1 else 0
        res["recommended_price"]= crr_p or res.get("bs2002",{}).get("price")

        # 7 — Early exercise boundary
        try:
            res["boundary"] = early_exercise_boundary(flag,S,K,T,r,q,v,n_pts=25)
        except: res["boundary"]=[]

        # 8 — Moneyness analysis
        intrinsic   = max(S-K,0) if flag=='c' else max(K-S,0)
        time_value  = max(0, (crr_p or 0) - intrinsic)
        res["moneyness"]  = "ITM" if intrinsic>0 else "OTM"
        res["intrinsic"]  = round(intrinsic,4)
        res["time_value"] = round(time_value,4)
        res["inputs"]     = {"flag":flag,"S":S,"K":K,"T":T,"r":r,"q":q,"sigma":v}
        return jsonify(res)
    except Exception as e: return jsonify({"error":str(e)}),500


@app.route("/surface", methods=["POST"])
def surface_ep():
    d=request.get_json(); S=float(d["S"]); r=float(d["r"]); sigma=float(d["sigma"]); q=float(d.get("q",0))
    strikes=[float(k) for k in d["strikes"]]; expiries=[float(t) for t in d["expiries"]]
    grid=[]
    for t in expiries:
        row=[]
        for K in strikes:
            try:
                c=compute_greeks_european("c",S,K,t,r,sigma,q); p=compute_greeks_european("p",S,K,t,r,sigma,q)
                row.append({"strike":K,"t":t,"call_price":c["price"],"put_price":p["price"],"delta":c["delta"],"gamma":c["gamma"],"theta":c["theta"],"vega":c["vega"],"iv_pct":c["iv_pct"],"put_delta":p["delta"]})
            except Exception as e: row.append({"strike":K,"t":t,"error":str(e)})
        grid.append(row)
    return jsonify({"grid":grid,"strikes":strikes,"expiries":expiries,"engine":ENGINE})


@app.route("/chain", methods=["POST"])
def chain_ep():
    d=request.get_json(); S=float(d["S"]); t=float(d["t"]); r=float(d["r"]); q=float(d.get("q",0)); opts=d["options"]
    results=[compute_greeks_european(o["flag"],S,float(o["K"]),t,r,float(o.get("sigma",0.3)),q,float(o["mkt_price"]) if "mkt_price" in o else None) for o in opts]
    return jsonify({"results":results,"engine":ENGINE})


@app.route("/monte-carlo", methods=["POST"])
def mc_ep():
    d=request.get_json(); S=float(d["S"]); K=float(d["K"]); T=float(d["T"]); r=float(d["r"]); sigma=float(d["sigma"]); q=float(d.get("q",0)); N=int(d.get("n_paths",2000)); steps=int(d.get("n_steps",max(1,round(T*252))))
    dt=T/steps; drift=(r-q-0.5*sigma**2)*dt; diff=sigma*math.sqrt(dt)
    finals=[]
    for _ in range(N):
        p=S
        for _ in range(steps):
            u1=random.random() or 1e-10; u2=random.random() or 1e-10
            p*=math.exp(drift+diff*math.sqrt(-2*math.log(u1))*math.cos(2*math.pi*u2))
        finals.append(p)
    finals.sort()
    mc_p=math.exp(-r*T)*sum(max(p-K,0) for p in finals)/N
    prob=sum(1 for p in finals if p>K)/N
    def pct(a,p): return a[min(int(len(a)*p/100),len(a)-1)]
    bs=compute_greeks_european("c",S,K,T,r,sigma,q)
    return jsonify({"mc_price":round(mc_p,4),"bs_price":round(bs["price"],4),"prob_assignment":round(prob,4),"p5":round(pct(finals,5),2),"p25":round(pct(finals,25),2),"p50":round(pct(finals,50),2),"p75":round(pct(finals,75),2),"p95":round(pct(finals,95),2),"n_paths":N,"engine":ENGINE,"greeks":bs})


@app.route("/health", methods=["GET"])
def health_ep():
    return jsonify({"status":"ok","engine":ENGINE,"vollib_ready":VOLLIB_OK,"numpy_ready":NUMPY_OK,
                    "endpoints":["/greeks","/american","/surface","/chain","/monte-carlo","/health"]})


if __name__=="__main__":
    print("="*60)
    print(f"  American Options API — greeks_server.py")
    print(f"  Engine  : {ENGINE}")
    print(f"  vollib  : {'✅' if VOLLIB_OK else '❌  pip install py_vollib'}")
    print(f"  numpy   : {'✅' if NUMPY_OK else '❌  pip install numpy'}")
    print(f"  Port    : 5050")
    print(f"  Models  : BS1993 · BS2002 · CRR Binomial Tree · European BSM")
    print("="*60)
    app.run(host="0.0.0.0",port=5050,debug=False)
