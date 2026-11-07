import numpy as np, pandas as pd, polars as pl
from common import *
A = pl.read_parquet(INTERIM / "bus_arrivals.parquet").to_pandas(); P = pl.read_parquet(INTERIM / "pulses.parquet").to_pandas()
cat = pl.read_parquet(INTERIM / "catchments.parquet").to_pandas()
P = P[P["size"] >= CFG["pulse_min_size"]].copy(); P["sod"] = P.t_median % 86400
ex = pl.read_parquet(INTERIM / "cmrl_exit_clean.parquet").filter(pl.col("valid") & (pl.col("ttype") == "Exit")).with_columns(h=pl.col("ts").dt.hour()).group_by("station", "hour").len().to_pandas()
st = pd.read_csv(REF / "stations.csv"); ex["station_id"] = ex.station.map(dict(zip(st.name, st.id))); ex["exits_h"] = ex["len"] / 4
ex[["station_id", "hour", "exits_h"]].to_parquet(INTERIM / "exits_hour.parquet")
A["r"] = A.boardings / A.gap_min
res = []; MAXW = CFG["max_transfer_window_min"]
stop_p20 = A.groupby(["stop_name", "route"]).r.quantile(0.2).rename("p20_route"); stop_p20b = A.groupby("stop_name").r.quantile(0.2).rename("p20_stop")
for sid, tr in cat[cat.group == "treatment"].groupby("station_id"):
    ctrl = cat[(cat.station_id == sid) & (cat.group == "control")].stop_name.unique()
    cb = A[A.stop_name.isin(ctrl) & A.r.notna()].groupby(["route", "hour"]).r.median().rename("base_ctrl")
    Ps = {d: g.sort_values("sod") for d, g in P[P.station_id == sid].groupby("day")}
    for _, row in tr.drop_duplicates("stop_name").iterrows():
        a = A[(A.stop_name == row.stop_name) & A.gap_min.notna() & (A.gap_min > 0)].copy()
        if a.empty: continue
        w = row.walk_min * 60; a["tp"] = a.tsec - w; a["W"] = np.minimum(a.gap_min, MAXW) * 60
        a["M"] = 0.0; a["wsum"] = 0.0
        for d, g in a.groupby("day"):
            pp = Ps.get(d)
            if pp is None: continue
            tm = pp.sod.values; sz = pp["size"].values.astype(float); cs = np.concatenate([[0], np.cumsum(sz)]); cs2 = np.concatenate([[0], np.cumsum(sz * tm)])
            hi = np.searchsorted(tm, g.tp.values, "right"); lo = np.searchsorted(tm, g.tp.values - g.W.values, "right")
            M = cs[hi] - cs[lo]; a.loc[g.index, "M"] = M; a.loc[g.index, "wsum"] = g.tp.values * M - (cs2[hi] - cs2[lo])
        nop = a[a.M == 0].groupby(["route", "hour"]).r.median().rename("base_loc")
        a = a.merge(nop, on=["route", "hour"], how="left").merge(cb, on=["route", "hour"], how="left") \
             .merge(stop_p20, left_on=["stop_name", "route"], right_index=True, how="left").merge(stop_p20b, left_on="stop_name", right_index=True, how="left")
        a["base"] = a.base_loc.fillna(a.base_ctrl).fillna(a.p20_route).fillna(a.p20_stop).fillna(0)
        a["base_src"] = np.where(a.base_loc.notna(), "local", np.where(a.base_ctrl.notna(), "control", "p20"))
        a["echo"] = np.where(a.M > 0, np.minimum(np.maximum(a.boardings - a.base * a.gap_min, 0), a.M), 0.0)
        a["wait_arr"] = np.where(a.M > 0, a.wsum / np.where(a.M > 0, a.M, 1) / 60 * -1 * -1, np.nan)
        a["wait_arr"] = np.where(a.M > 0, (a.tp * a.M - 0) / 1, np.nan)  # placeholder replaced below
        a["wait_arr"] = np.where(a.M > 0, a.wsum / np.where(a.M > 0, a.M, 1) / 60, np.nan)
        a["station_id"] = sid; a["walk_min"] = row.walk_min; a["walk_m"] = row.walk_m; a["stop_lat"] = row.stop_lat; a["stop_lon"] = row.stop_lon
        res.append(a[["station_id", "stop_name", "stop_lat", "stop_lon", "walk_m", "walk_min", "route", "dir", "day", "tsec", "hour", "gap_min", "boardings", "M", "base", "base_src", "echo", "wait_arr", "stype", "trip_dest", "headway_min"]])
E = pd.concat(res, ignore_index=True)
# hourly cap: transfers <= share_cap_pct of exits that hour
hr = E.groupby(["station_id", "hour"]).echo.sum().div(4).rename("tr_h").reset_index().merge(pd.read_parquet(INTERIM / "exits_hour.parquet"), on=["station_id", "hour"], how="left")
hr["share"] = hr.tr_h / hr.exits_h * 100; hr["f"] = np.where(hr.share > CFG["share_cap_pct"], CFG["share_cap_pct"] / hr.share, 1.0)
E = E.merge(hr[["station_id", "hour", "f"]], on=["station_id", "hour"], how="left"); E["f"] = E.f.fillna(1.0); E["echo_s"] = E.echo * E.f
pl.from_pandas(E).write_parquet(INTERIM / "echo_arrivals.parquet")
s = E.groupby("station_id").agg(tr=("echo_s", lambda x: x.sum() / 4)).reset_index(); exd = pd.read_parquet(INTERIM / "exits_hour.parquet").groupby("station_id").exits_h.sum().rename("exits").reset_index()
s = s.merge(exd, on="station_id"); s["pct"] = s.tr / s.exits * 100; print(s.sort_values("tr", ascending=False).head(15).round(1).to_string()); print("stations with echo:", len(s), "| capped station-hours:", int((hr.f < 1).sum()), "of", len(hr))
print("baseline sources:", E.base_src.value_counts().to_dict())
