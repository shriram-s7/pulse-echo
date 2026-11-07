import json, numpy as np, pandas as pd, polars as pl
from common import *
E = pl.read_parquet(INTERIM / "echo_arrivals.parquet").to_pandas(); exh = pd.read_parquet(INTERIM / "exits_hour.parquet"); R = pd.read_parquet(INTERIM / "regulars.parquet")
st = pd.read_csv(REF / "stations.csv"); cat = pl.read_parquet(INTERIM / "catchments.parquet").to_pandas(); cat = cat[cat.group == "treatment"].drop_duplicates(["station_id", "stop_name"])
slug = lambda s: s.lower().replace(" ", "-"); WL = CFG["wait_levels"]
exd = exh.groupby("station_id").exits_h.sum()
TERM = json.load(open(INTERIM / "terminals.json")); PLC = json.load(open(INTERIM / "placebo.json")); tpd = cat.groupby("station_id").pax_day.sum()
def wavg(g):
    s = g.echo_s.sum(); return float((g.echo_s * g.wait_arr.fillna(0)).sum() / s) if s > 0 else 0.0
def wlevel(w): return "good" if w < WL["good_lt"] else ("bad" if w > WL["bad_gt"] else "ok")
rows = []; tr_all = E.groupby("station_id").echo_s.sum() / 4
tert = tr_all.reindex(st.id).fillna(0).rank(method="first", pct=True)
for _, s in st.iterrows():
    g = E[E.station_id == s.id]; tr = float(tr_all.get(s.id, 0)); ex = float(exd.get(s.id, 0)); w = wavg(g); hourly = []
    for h in range(5, 23):
        gh = g[g.hour == h]; eh = exh[(exh.station_id == s.id) & (exh.hour == h)].exits_h
        hourly.append(dict(hour=h, exits=round(float(eh.iloc[0]) if len(eh) else 0, 1), transfers=round(float(gh.echo_s.sum() / 4), 1), avg_wait_min=round(wavg(gh), 1)))
    q = tert[s.id]
    rows.append(dict(id=s.id, exits_per_day=round(ex), transfers_per_day=round(tr), transfer_pct=round(tr / ex * 100, 1) if ex else 0, avg_wait_min=round(w, 1),
                     level="high" if q > 2 / 3 else ("medium" if q > 1 / 3 else "low"), wait_level=wlevel(w), method="quick_estimate_placebo", data_quality="limited" if tpd.get(s.id, 0) < 1500 else "good", hourly=hourly))
H = pd.DataFrame(rows); cand = H[H.transfers_per_day >= CFG["transfers_min_per_day"]]
hot = {"window": "2026-03-03..2026-03-06", "stations": rows, "totals": dict(transfers_per_day=int(H.transfers_per_day.sum()), top_station=H.sort_values("transfers_per_day").iloc[-1].id, worst_wait_station=cand.sort_values("avg_wait_min").iloc[-1].id)}
json.dump(hot, open(OUT / "hotspots.json", "w"))
flows = []
for _, s in st.iterrows():
    g = E[E.station_id == s.id]; ex = float(exd.get(s.id, 0)); tot = 0.0
    byst = g.groupby("stop_name").echo_s.sum().div(4).sort_values(ascending=False)
    for sn, tr in byst.head(8).items():
        if tr <= 0 or ex == 0: continue
        gs = g[g.stop_name == sn]; c = cat[(cat.station_id == s.id) & (cat.stop_name == sn)].iloc[0]
        routes = []
        for rt, gr in gs.groupby("route"):
            t = gr.echo_s.sum() / 4
            if t > 0: routes.append(dict(route=str(rt), transfers_per_day=round(float(t), 1), share_pct=round(float(t / ex * 100), 2), avg_wait_min=round(wavg(gr), 1), headway_min=round(float(gr.gap_min.median()), 1)))
        routes = sorted(routes, key=lambda r: -r["transfers_per_day"])[:6]
        hourly = []
        for h in range(5, 23):
            eh = exh[(exh.station_id == s.id) & (exh.hour == h)].exits_h; t = gs[gs.hour == h].echo_s.sum() / 4
            if t > 0 and len(eh) and eh.iloc[0] > 0: hourly.append(dict(hour=h, transfers=round(float(t), 1), share_pct=round(float(t / eh.iloc[0] * 100), 2)))
        flows.append(dict(station_id=s.id, stop_id=slug(sn), stop_name=sn, stop_lat=round(float(c.stop_lat), 6), stop_lon=round(float(c.stop_lon), 6), walk_m=int(c.walk_m), direction="metro_to_bus", stop_type="terminal" if TERM.get(sn, False) else "stop",
                          transfers_per_day=round(float(tr), 1), share_pct=round(float(tr / ex * 100), 2), routes=routes, hourly=hourly)); tot += tr
    rem_h = []
    for h in range(5, 23):
        eh = exh[(exh.station_id == s.id) & (exh.hour == h)].exits_h
        if not len(eh) or eh.iloc[0] <= 0: continue
        shown_h = sum(x["share_pct"] for f in flows if f["station_id"] == s.id for x in f["hourly"] if x["hour"] == h)
        rem_h.append(dict(hour=h, transfers=round(float(eh.iloc[0] * (100 - shown_h) / 100), 1), share_pct=round(100 - shown_h, 2)))
    shp = sum(f["share_pct"] for f in flows if f["station_id"] == s.id)
    flows.append(dict(station_id=s.id, stop_id="other", stop_name="Walk / auto / not a nearby bus", stop_lat=float(s.lat), stop_lon=float(s.lon), walk_m=0, direction="metro_to_bus", stop_type="other",
                      transfers_per_day=round(ex - tot, 1), share_pct=round(100 - shp, 2), routes=[], hourly=rem_h))
json.dump({"flows": flows}, open(OUT / "flows.json", "w"))
for a, b in (("recommendations_raw.json", "recommendations.json"), ("nudge_raw.json", "nudge.json")): open(OUT / b, "w").write(open(INTERIM / a).read())
Rg = R[R.dest_lat.notna()].sort_values("regular_cards", ascending=False).groupby("station_id").head(3)
json.dump({"flows": [dict(station_id=r.station_id, window=r.window, regular_cards=int(r.regular_cards), top_route=r.top_route, dest_name=r.destination_hint if "(" in r.destination_hint else r.dest_name,
                          dest_lat=round(float(r.dest_lat), 5), dest_lon=round(float(r.dest_lon), 5), likely_purpose=r.likely_purpose) for r in Rg.itertuples()]}, open(OUT / "regulars.json", "w"))
ex_all = pl.read_parquet(INTERIM / "cmrl_exit_clean.parquet").filter(pl.col("valid") & (pl.col("ttype") == "Exit"))
day = ex_all.group_by("date").len().sort("len", descending=True)["date"][0]; dstr = str(day)
ex5 = ex_all.filter(pl.col("date") == day).with_columns(m=(pl.col("ts").dt.hour().cast(pl.Int32) * 60 + (pl.col("ts").dt.minute().cast(pl.Int32) // 5) * 5)).filter((pl.col("m") >= 360) & (pl.col("m") < 660)).group_by("station", "m").len().to_pandas()
ex5["station_id"] = ex5.station.map(dict(zip(st.name, st.id))); (OUT / "station").mkdir(exist_ok=True)
def capof(x):
    x = str(x); return CFG["capacity"]["Small Bus"] if "Small" in x else CFG["capacity"]["AC"] if "A/C" in x else CFG["capacity"]["Ordinary"]
for _, s in st.iterrows():
    g = E[E.station_id == s.id]; gd = g[(g.day == dstr) & (g.hour >= 6) & (g.hour < 11) & (g.echo_s >= 1)].sort_values("tsec")
    e5 = ex5[ex5.station_id == s.id].set_index("m")["len"]; bins = [dict(t=f"{m // 60:02d}:{m % 60:02d}", v=int(e5.get(m, 0))) for m in range(360, 660, 5)]
    arr = [dict(t=f"{int(x.tsec) // 3600:02d}:{(int(x.tsec) % 3600) // 60:02d}", stop_id=slug(x.stop_name), route=str(x.route), boardings=int(x.boardings), echo=round(float(x.echo_s), 1)) for x in gd.itertuples()][:400]
    ex = float(exd.get(s.id, 0)); rts = []
    for (rt, sn), gr in g.groupby(["route", "stop_name"]):
        t = gr.echo_s.sum() / 4
        if t <= 0 or ex == 0: continue
        pk = gr[(gr.hour >= 7) & (gr.hour < 10)]; pk = pk if len(pk) else gr
        rts.append(dict(route=str(rt), stop_id=slug(sn), transfers_per_day=round(float(t), 1), share_pct=round(float(t / ex * 100), 2), avg_wait_min=round(wavg(gr), 1),
                        headway_min_peak=round(float(pk.gap_min.median()), 1), boardings_per_trip_peak=round(float(pk.boardings.mean()), 1), capacity=capof(gr.stype.mode().iloc[0])))
    rts = sorted(rts, key=lambda r: -r["transfers_per_day"])[:10]
    rg = [dict(window=r.window, regular_cards=int(r.regular_cards), top_route=r.top_route, likely_purpose=r.likely_purpose, destination_hint=f"likely {r.destination_hint}") for r in R[R.station_id == s.id].sort_values("regular_cards", ascending=False).head(5).itertuples()]
    json.dump(dict(id=s.id, pulse_echo=dict(date=dstr, exits_5min=bins, bus_arrivals=arr), routes=rts, regulars=rg, method="quick_estimate", validation=None), open(OUT / "station" / f"{s.id}.json", "w"))
print("exported; busiest day", dstr, "| flows rows", len(flows), "| regulars flows", len(Rg))

import yaml
cfg = yaml.safe_load(open(ROOT / "config.yaml"))
M = {"steps": ["Group Metro exit taps into pulses (train arrivals) per station; tune the gap so pulses are 3-5 min apart at peak.",
               "For each bus arrival near a station, echo = boardings minus the local baseline over the gap, counted only if a pulse could have walked there in time.",
               "Placebo: run the same method on stops 600-1500 m away and subtract that false-echo rate from nearby stops; cap a stop at 35% and a station at 50% of exits.",
               "Estimate wait from pulse arrival to the next bus, rank fixes by passenger-minutes saved, and find regulars from cards exiting within +-20 min of their own median on 3+ of 4 days."],
     "validation": {"alpha_control_avg": round(PLC["alpha_control_avg"], 3), "transfers_before_correction": round(PLC["transfers_before_correction"]), "transfers_after_correction": round(PLC["transfers_after_correction"])},
     "assumptions": [f"{k}: {cfg[k]}" for k in ("treatment_radius_m", "treatment_widen_m", "control_ring_m", "walk_factor", "walk_speed_mps", "pulse_gap_s", "max_transfer_window_min", "capacity", "target_wait_min", "regulars_min_days", "regulars_min_cards", "radius_override_m")],
     "limits": ["Transfers are a quick estimate; the placebo and caps are blunt and should be read as indicative.", "Stops are matched by name; terminals and large stops merge several physical stops.",
                "Stations with limited bus-stop data (data_quality = limited) have weak estimates.", "Only Metro-to-bus flows are estimated; trip-level boardings count total boardings, not load.", "Bus data covers 1-7 March; Metro window is 3-6 March."]}
json.dump(M, open(OUT / "method.json", "w"), indent=1)
