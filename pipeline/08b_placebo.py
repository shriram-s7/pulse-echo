import json, numpy as np, pandas as pd, polars as pl
from common import *
A = pl.read_parquet(INTERIM / "bus_arrivals.parquet").to_pandas(); P = pl.read_parquet(INTERIM / "pulses.parquet").to_pandas()
cat = pl.read_parquet(INTERIM / "catchments.parquet").to_pandas(); E = pl.read_parquet(INTERIM / "echo_arrivals.parquet").to_pandas()
P = P[P["size"] >= CFG["pulse_min_size"]].copy(); P["sod"] = P.t_median % 86400
A["r"] = A.boardings / A.gap_min; MAXW = CFG["max_transfer_window_min"]
p20 = A.groupby(["stop_name", "route"]).r.quantile(0.2).rename("p20_route"); p20b = A.groupby("stop_name").r.quantile(0.2).rename("p20_stop")
BANDS = [(5, 7), (7, 10), (10, 13), (13, 16), (16, 20), (20, 23)]
band = lambda h: next((i for i, (a, b) in enumerate(BANDS) if a <= h < b), -1)
# ---- placebo: same echo method on control stops
rows = []
for sid, cr in cat[cat.group == "control"].groupby("station_id"):
    Ps = {d: g.sort_values("sod") for d, g in P[P.station_id == sid].groupby("day")}
    for _, row in cr.drop_duplicates("stop_name").iterrows():
        a = A[(A.stop_name == row.stop_name) & A.gap_min.notna() & (A.gap_min > 0)].copy()
        if a.empty: continue
        a["tp"] = a.tsec - row.walk_min * 60; a["W"] = np.minimum(a.gap_min, MAXW) * 60; a["M"] = 0.0
        for d, g in a.groupby("day"):
            pp = Ps.get(d)
            if pp is None: continue
            tm = pp.sod.values; cs = np.concatenate([[0], np.cumsum(pp["size"].values.astype(float))])
            a.loc[g.index, "M"] = cs[np.searchsorted(tm, g.tp.values, "right")] - cs[np.searchsorted(tm, g.tp.values - g.W.values, "right")]
        nop = a[a.M == 0].groupby(["route", "hour"]).r.median().rename("base_loc")
        a = a.merge(nop, on=["route", "hour"], how="left").merge(p20, left_on=["stop_name", "route"], right_index=True, how="left").merge(p20b, left_on="stop_name", right_index=True, how="left")
        a["base"] = a.base_loc.fillna(a.p20_route).fillna(a.p20_stop).fillna(0)
        a["echo"] = np.where(a.M > 0, np.minimum(np.maximum(a.boardings - a.base * a.gap_min, 0), a.M), 0.0)
        a["station_id"] = sid; rows.append(a[["station_id", "hour", "boardings", "echo"]])
C = pd.concat(rows); C["band"] = C.hour.map(band); C = C[C.band >= 0]
cs_ = C.groupby(["station_id", "band"]).agg(e=("echo", "sum"), b=("boardings", "sum")).reset_index(); cs_["rate"] = cs_.e / cs_.b
city = C.groupby("band").agg(e=("echo", "sum"), b=("boardings", "sum")); city_rate = (city.e / city.b).to_dict()
rate = {(r.station_id, r.band): r.rate for r in cs_.itertuples()}
# ---- corrected treatment echo
E["band"] = E.hour.map(band); E["rate"] = [rate.get((s, b), city_rate.get(b, 0.0)) for s, b in zip(E.station_id, E.band)]
E["echo_raw"] = E.echo; E["echo_pc"] = np.where(E.band >= 0, np.maximum(0, E.echo - E.rate * E.boardings), 0.0)
exh = pd.read_parquet(INTERIM / "exits_hour.parquet"); exd = exh.groupby("station_id").exits_h.sum()
# caps: station-hour <= 50% of exits, single stop <= 35%/day, station total <= 50%/day
h = E.groupby(["station_id", "hour"]).echo_pc.sum().div(4).rename("t").reset_index().merge(exh, on=["station_id", "hour"], how="left"); h["f"] = np.where(h.t > 0.5 * h.exits_h, 0.5 * h.exits_h / h.t, 1.0).clip(0, 1)
E = E.merge(h[["station_id", "hour", "f"]].rename(columns={"f": "fh"}), on=["station_id", "hour"], how="left"); E["fh"] = E.fh.fillna(1.0); E["e1"] = E.echo_pc * E.fh
sp = E.groupby(["station_id", "stop_name"]).e1.sum().div(4).rename("t").reset_index(); sp["ex"] = sp.station_id.map(exd); sp["fs"] = np.where(sp.t > 0.35 * sp.ex, 0.35 * sp.ex / sp.t, 1.0)
E = E.merge(sp[["station_id", "stop_name", "fs"]], on=["station_id", "stop_name"], how="left"); E["e2"] = E.e1 * E.fs.fillna(1.0)
stt = (E.groupby("station_id").e2.sum() / 4).rename("t").reset_index(); stt["ex"] = stt.station_id.map(exd); stt["ft"] = np.where(stt.t > 0.5 * stt.ex, 0.5 * stt.ex / stt.t, 1.0)
E = E.merge(stt[["station_id", "ft"]], on="station_id", how="left"); E["echo_s"] = E.e2 * E.ft.fillna(1.0)
E = E.drop(columns=["fh", "fs", "ft", "e1", "e2", "rate"], errors="ignore")
pl.from_pandas(E).write_parquet(INTERIM / "echo_arrivals.parquet")
# ---- terminals
tv = []
for d in WIN_DAYS:
    df = pl.read_parquet(INTERIM / f"etm_{d}_clean.parquet", columns=["source", "Trip_Origin", "valid"]).filter(pl.col("valid") & pl.col("source").is_not_null())
    tv.append(df.group_by(["source", "Trip_Origin"]).len().to_pandas())
tv = pd.concat(tv); tv["sn"] = tv.source.map(norm); tv["on"] = tv.Trip_Origin.map(norm); tv["org"] = tv.sn == tv.on
g = tv.groupby("sn").apply(lambda x: x.loc[x.org, "len"].sum() / x.len.sum(), include_groups=False)
pat = r"\bBT\b|BUS TERMINUS|\bBS\b|BUS STAND|CMBT|KOYAMBEDU"
term = {s: bool(v > 0.40 or pd.Series([s]).str.contains(pat).iloc[0]) for s, v in g.items()}
json.dump(term, open(INTERIM / "terminals.json", "w"))
tb = E.groupby("station_id").echo_raw.sum().sum() / 4; ta = E.echo_s.sum() / 4
json.dump({"alpha_control_avg": float(np.mean(list(rate.values()))) if rate else 0.0, "alpha_city_by_band": {str(k): float(v) for k, v in city_rate.items()},
           "transfers_before_correction": float(tb), "transfers_after_correction": float(ta), "control_stations": int(cs_.station_id.nunique())}, open(INTERIM / "placebo.json", "w"), indent=1)
print(f"control rate avg {np.mean(list(rate.values())):.3f} | city by band {({k: round(v, 3) for k, v in city_rate.items()})} | stations w/ control {cs_.station_id.nunique()}/41")
print(f"transfers/day before {tb:.0f} after {ta:.0f} | terminals {sum(term.values())} of {len(term)}")
