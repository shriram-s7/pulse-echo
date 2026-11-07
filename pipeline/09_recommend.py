import json, math, numpy as np, pandas as pd, polars as pl
from common import *
E = pl.read_parquet(INTERIM / "echo_arrivals.parquet").to_pandas(); P = pl.read_parquet(INTERIM / "pulses.parquet").to_pandas()
cyc = pl.read_parquet(INTERIM / "route_cycle.parquet").to_pandas().groupby("route").cycle_min.median()
st = pd.read_csv(REF / "stations.csv"); title = {r.id: r["name"].replace(" METRO", "").title() for _, r in st.iterrows()}
exh = pd.read_parquet(INTERIM / "exits_hour.parquet"); exd = exh.groupby("station_id").exits_h.sum()
cat = pl.read_parquet(INTERIM / "catchments.parquet").to_pandas(); tp = cat[cat.group == "treatment"].drop_duplicates(["station_id", "stop_name"]).groupby("station_id").pax_day.sum()
P = P[P["size"] >= CFG["pulse_min_size"]].copy(); P["sod"] = P.t_median % 86400
BANDS = [(5, 7), (7, 10), (10, 13), (13, 16), (16, 20), (20, 23)]; CAP = CFG["capacity"]; TW = CFG["target_wait_min"]; CAPW = CFG["max_transfer_window_min"] * 60
band = lambda h: next((i for i, (a, b) in enumerate(BANDS) if a <= h < b), -1)
def cap_of(s):
    s = str(s); return CAP["Small Bus"] if "Small" in s else CAP["AC"] if "A/C" in s else CAP["Deluxe"] if "Deluxe" in s else CAP["Ordinary"]
E["band"] = E.hour.map(band); E = E[E.band >= 0]
routes = set(E[E.echo_s > 0].route)
# trip-level boardings: sum of passengers over all stops of a trip, by route and start-hour band
tl = []
for d in WIN_DAYS:
    df = pl.read_parquet(INTERIM / f"etm_{d}_clean.parquet", columns=["fleet_no", "waybill_no", "trip_no", "route", "dir", "pax", "ts", "valid"]).filter(pl.col("valid") & pl.col("route").is_in(list(routes)))
    tl.append(df.group_by(["fleet_no", "waybill_no", "trip_no", "route", "dir"]).agg(pl.col("pax").sum().alias("trip_pax"), pl.col("ts").min().alias("t0")).to_pandas())
T = pd.concat(tl); T["band"] = T.t0.dt.hour.map(band); trip_mean = T[T.band >= 0].groupby(["route", "band"]).trip_pax.mean()
def sim(Pd, arrs, shift_s=0.0):
    num = den = 0.0
    for d, (p, w) in Pd.items():
        a = arrs.get(d)
        if a is None or len(a) == 0: wt = np.full(len(p), CAPW)
        else:
            a = a + shift_s; i = np.searchsorted(a, p, "left"); wt = np.minimum(np.where(i < len(a), a[np.minimum(i, len(a) - 1)] - p, CAPW), CAPW)
        num += (wt * w).sum(); den += w.sum()
    return num / den / 60 if den else np.nan
pbs = {sid: {d: g.sort_values("sod") for d, g in gg.groupby("day")} for sid, gg in P.groupby("station_id")}
items = []
for (route, bi), g in E.groupby(["route", "band"]):
    tr = g.echo_s.sum() / 4
    if tr < CFG["transfers_min_per_day"]: continue
    b0, b1 = BANDS[bi]; wait = float((g.echo_s * g.wait_arr.fillna(0)).sum() / max(g.echo_s.sum(), 1e-9)); hw = float(g.gap_min.median())
    cy = cyc.get(route, np.nan); tpax = trip_mean.get((route, bi), np.nan); cap = cap_of(g.stype.mode().iloc[0])
    if np.isnan(cy) or np.isnan(tpax) or hw <= 0: continue
    cur = max(1, math.ceil(cy / hw)); tgt = max(8.0, 0.6 * hw)
    stn = g.groupby("station_id").echo_s.sum().div(4); stn = stn[stn >= 10].sort_values(ascending=False)
    if stn.empty: stn = g.groupby("station_id").echo_s.sum().div(4).sort_values(ascending=False).head(1)
    ctx = []
    for sid, t in stn.items():
        gs = g[g.station_id == sid]; main = gs.groupby("stop_name").echo_s.sum().idxmax(); gm = E[(E.station_id == sid) & (E.route == route) & (E.stop_name == main)]
        walk = float(gm.walk_min.iloc[0]) * 60; Pd = {}
        for d, pp in pbs.get(sid, {}).items():
            p = pp.sod.values + walk; m = (p >= b0 * 3600) & (p < b1 * 3600); Pd[d] = (p[m], pp["size"].values[m].astype(float))
        arrs = {d: np.sort(x.tsec.values) for d, x in gm.groupby("day")}; s0 = sim(Pd, arrs)
        if s0 and not np.isnan(s0): ctx.append((sid, t, Pd, arrs, s0))
    if not ctx: continue
    W = sum(c[1] for c in ctx)
    def ratio(fn): return sum(c[1] * fn(c) / c[4] for c in ctx) / W
    curve = [{"shift_min": s, "avg_wait_min": round(wait * ratio(lambda c: sim(c[2], c[3], s * 60)), 2)} for s in range(-5, 6)]
    best = min(curve, key=lambda c: c["avg_wait_min"]); cut = (wait - best["avg_wait_min"]) / wait if wait > 0 else 0
    rec = None
    if hw <= 15 and cut >= 0.10 and best["shift_min"] != 0: rec = dict(type="retime", extra=0, shift=best["shift_min"], after=best["avg_wait_min"])
    elif tpax > cap and wait <= TW: rec = dict(type="bigger_bus", extra=0, shift=0, after=wait)
    elif (wait > TW or tpax > 0.9 * cap) and tgt < hw:
        extra = min(max(1, math.ceil(cy / tgt) - math.ceil(cy / hw)), max(1, cur // 2))
        eff_h = max(tgt, hw * cur / (cur + extra)) if False else tgt
        sa = np.mean([ratio(lambda c: sim(c[2], {d: np.arange(b0 * 3600 + ph * eff_h * 60, b1 * 3600 + 3600, eff_h * 60) for d in c[2]})) for ph in (0, .25, .5, .75)])
        rec = dict(type="add_buses", extra=extra, shift=0, after=min(wait, wait * sa))
    if rec is None: continue
    saved = tr * (wait - rec["after"]) if rec["type"] != "bigger_bus" else 0.0
    h = g[g.echo_s > 0].hour; hrs = f"{int(h.min()):02d}:00-{int(h.max()) + 1:02d}:00"; sids = [c[0] for c in ctx]; nm = ", ".join(title[s] for s in sids[:3]) + (f" +{len(sids) - 3} more" if len(sids) > 3 else "")
    act = {"add_buses": f"Add {rec['extra']} bus{'es' if rec['extra'] > 1 else ''} on {route} (headway {hw:.0f} to {tgt:.0f} min), {hrs}, serving {nm}",
           "retime": f"Shift {route} departures {abs(rec['shift'])} min {'earlier' if rec['shift'] < 0 else 'later'}, {hrs}, to meet trains at {nm}",
           "bigger_bus": f"Use higher-capacity buses on {route}, {hrs}, serving {nm}"}[rec["type"]]
    items.append(dict(station_id=sids[0], stations=sids, route=route, hours=hrs, type=rec["type"], action=act,
        evidence=dict(transfers=round(tr, 1), avg_wait_min=round(wait, 1), headway_min=round(hw, 1), boardings_per_trip=round(float(tpax), 1), capacity=cap),
        extra_buses=int(rec["extra"]), shift_min=int(rec["shift"]), current_buses=cur, target_headway_min=round(tgt, 1) if rec["type"] == "add_buses" else round(hw, 1),
        before_after=dict(wait_before=round(wait, 1), wait_after=round(rec["after"], 1)), passenger_minutes_saved_per_day=round(saved),
        _metric=saved / max(rec["extra"], 0.5), _curve=curve, _best=best["shift_min"]))
q75 = exd.quantile(0.75); trs = E.groupby("station_id").echo_s.sum() / 4
for sid in exd.index:
    pct = trs.get(sid, 0) / exd[sid] * 100
    if exd[sid] >= q75 and pct < 3 and tp.get(sid, 0) >= 1500:
        items.append(dict(station_id=sid, stations=[sid], route="NEW", hours="07:00-10:00", type="new_feeder", action=f"Start a feeder bus linking {title[sid]} Metro to nearby neighbourhoods (only ~{pct:.1f}% of exits switch to a bus)",
            evidence=dict(transfers=round(float(trs.get(sid, 0)), 1), avg_wait_min=0, headway_min=0, boardings_per_trip=0, capacity=CAP["Ordinary"]), extra_buses=0, shift_min=0, current_buses=0, target_headway_min=0,
            before_after=dict(wait_before=0, wait_after=0), passenger_minutes_saved_per_day=0, _metric=0.0, _curve=None, _best=0))
# one item per route: keep the best band per route+type, then pick top 15 with >=3 of each type that fires
bt = {}
for i in items:
    k = (i["route"], i["type"]) if i["type"] != "new_feeder" else (i["station_id"], "new_feeder")
    if k not in bt or i["_metric"] > bt[k]["_metric"]: bt[k] = i
pool = sorted(bt.values(), key=lambda i: -i["_metric"]); top = []
for t in ("retime", "add_buses", "bigger_bus", "new_feeder"): top += [i for i in pool if i["type"] == t][:3]
top += [i for i in pool if i not in top][: 15 - len(top)]; top = sorted(top[:15], key=lambda i: -i["_metric"])
for r, i in enumerate(top, 1): i["id"] = f"r{r}"; i["rank"] = r
summary = dict(extra_buses_total=int(sum(i["extra_buses"] for i in top)), routes_affected=len({i["route"] for i in top if i["route"] != "NEW"}), passenger_minutes_saved_per_day=int(sum(i["passenger_minutes_saved_per_day"] for i in top)))
curves = [dict(station_id=i["station_id"], route=i["route"], hours=i["hours"], points=i["_curve"], best_shift_min=i["_best"]) for i in top if i["_curve"]]
for i in top: [i.pop(k) for k in ("_curve", "_best", "_metric")]
json.dump({"summary": summary, "items": top}, open(INTERIM / "recommendations_raw.json", "w")); json.dump({"curves": curves}, open(INTERIM / "nudge_raw.json", "w"))
print(summary, "| candidates", len(items), "| in top:", pd.Series([i["type"] for i in top]).value_counts().to_dict(), "| fired:", pd.Series([i["type"] for i in items]).value_counts().to_dict())
