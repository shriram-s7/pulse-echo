import numpy as np, pandas as pd, polars as pl, json
from common import *
ex = pl.read_parquet(INTERIM / "cmrl_exit_clean.parquet").filter(pl.col("valid") & (pl.col("ttype") == "Exit")).select("station", "ts", "date").sort("ts")
st = pd.read_csv(REF / "stations.csv"); n2i = dict(zip(st.name, st.id))
GAPS = [10, 15, 20, 30, 45, 60, 90, 120]
out = []; tuned = {}
for name, g in ex.group_by("station"):
    sid = n2i[name[0]]; days = {}
    for day, gd in g.group_by("date"):
        t = gd["ts"].sort().to_numpy().astype("datetime64[s]").astype("int64"); days[day[0]] = t
    def pulses(gap):
        res = []
        for day, t in days.items():
            if len(t) == 0: continue
            br = np.where(np.diff(t) > gap)[0] + 1; grp = np.split(t, br)
            for p in grp: res.append((day, int(np.median(p)), int(p[0]), int(p[-1]), len(p)))
        return res
    def peak_gap(res):
        d = pd.DataFrame(res, columns=["day", "tm", "t0", "t1", "n"]); d = d[d.n >= CFG["pulse_min_size"]]
        d["h"] = ((d.tm % 86400) // 3600); d = d[d.h.isin([7, 8, 9, 17, 18, 19])].sort_values(["day", "t0"])
        gg = d.groupby("day").t0.diff().dropna() / 60
        return float(gg.median()) if len(gg) else np.nan
    best = None
    for gp in GAPS:
        pg = peak_gap(pulses(gp))
        if np.isnan(pg): continue
        if 3 <= pg <= 10: best = (gp, pg); break
        if best is None or abs(pg - 5) < abs(best[1] - 5): best = (gp, pg)
    gp = best[0] if best else CFG["pulse_gap_s"]; tuned[sid] = {"gap_s": gp, "peak_median_gap_min": None if not best else round(best[1], 2)}
    for day, tm, t0, t1, n in pulses(gp): out.append(dict(station_id=sid, day=str(day), t_median=tm, t_start=t0, t_end=t1, size=n))
P = pd.DataFrame(out); P["t_median_dt"] = pd.to_datetime(P.t_median, unit="s")
pl.from_pandas(P).write_parquet(INTERIM / "pulses.parquet"); json.dump(tuned, open(INTERIM / "pulse_tuning.json", "w"), indent=1)
print(len(P), "pulses"); print(pd.DataFrame(tuned).T.describe().to_string()); print({k: v for k, v in tuned.items() if k in ("central", "guindy", "airport", "lic")})
