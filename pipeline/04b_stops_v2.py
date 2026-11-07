import re, numpy as np, pandas as pd, polars as pl, geopandas as gpd, yaml
from rapidfuzz import fuzz
from common import *
st = pd.read_csv(REF / "stations.csv"); bs = pd.read_csv(REF / "bus_stops.csv")
v = pl.concat([pl.read_parquet(INTERIM / f"etm_{d}_clean.parquet", columns=["source", "pax", "valid"]).filter(pl.col("valid")).group_by("source").agg(pl.col("pax").sum()) for d in WIN_DAYS]) \
      .group_by("source").agg(pl.col("pax").sum()).drop_nulls("source").to_pandas()
v["norm"] = v.source.map(norm); v = v.groupby("norm", as_index=False).pax.sum(); v["pax_day"] = v.pax / 4
vol = dict(zip(v.norm, v.pax_day)); enames = list(vol)
KW = {"thousand-lights": r"THOUSAND LIGHTS?|T LIGHTS?|THOUSANDLIGHT", "teynampet": r"TEYNAMPET|TEYNAM", "alandur": r"ALANDUR|ALANTHUR",
 "government-estate": r"GOVT ESTATE|GOVERNMENT ESTATE", "lic": r"\bLIC\b", "central": r"CENTRAL|MGRCENTRAL",
 "airport": r"AIRPORT|MEENAMBAKKAM|MEEANAMBAKKAM|TIRUSULAM|THIRUSULAM", "meenambakkam": r"MEENAMBAKKAM|MEEANAMBAKKAM",
 "high-court": r"HIGH COURT|BROADWAY|FORT STATION", "cmbt": r"CMBT|MGRKOYAMBEDU|KOYAMBEDU BT|KOYAMBEDU", "koyambedu": r"KOYAMBEDU|MGRKOYAMBEDU",
 "ota-nanganallur-road": r"NANGANALLUR", "st-thomas-mount": r"THOMAS MOUNT", "pachiappas-college": r"PACHAIYAPPA|PACHIAPPA|PACHAIAPPA",
 "little-mount": r"LITTLE MOUNT", "ag-dms": r"\bDMS\b|ANNA SALAI", "mannadi": r"MANNADY|MANNADI", "thiyagaraya-college": r"THIYAGARAYA|TONDIARPET",
 "washermenpet": r"WASHERMENPET|WASHERMANPET", "new-washermenpet": r"WASHERMENPET|WASHERMANPET", "anna-nagar-east": r"ANNA NAGAR",
 "anna-nagar-tower": r"ANNA NAGAR", "thirumangalam": r"THIRUMANGALAM|ANNA NAGAR", "ashok-nagar": r"ASHOK NAGAR", "arumbakkam": r"ARUMBAKKAM",
 "vadapalani": r"VADAPALANI", "saidapet": r"SAIDAPET", "nandanam": r"NANDANAM", "guindy": r"GUINDY", "egmore": r"EGMORE", "kilpauk": r"KILPAUK",
 "nehru-park": r"NEHRU PARK|NERU PARK", "shenoy-nagar": r"SHENOY", "ekkattuthangal": r"EKKATTUTHANGAL|EKKATUTHANGAL", "tondiarpet": r"TONDIARPET",
 "tollgate": r"TOLL ?GATE", "kaladipet": r"KALADIPET", "thiruvotriyur": r"THIRUVOTRIYUR|TIRUVOTTIYUR", "thiruvotriyur-theradi": r"THERADI",
 "wimco-nagar": r"WIMCO", "wimco-nagar-depot": r"WIMCO"}
sg = gpd.GeoSeries(gpd.points_from_xy(st.lon, st.lat), crs=4326).to_crs(32644)
bg = gpd.GeoSeries(gpd.points_from_xy(bs.lon, bs.lat), crs=4326).to_crs(32644)
R0, R1 = CFG["treatment_radius_m"], CFG["treatment_widen_m"]; RC = CFG["local_candidate_radius_m"]; FT = CFG["local_fuzzy_threshold"]; off = CFG["station_proxy_offset_m"]
rows = []
for i, s in st.iterrows():
    d = bg.distance(sg.iloc[i]).values; near = np.where(d <= RC)[0]
    pat = re.compile(KW.get(s.id, re.escape(norm(s["name"]).replace(" METRO", ""))))
    nn = {}
    for j in near:
        k = bs.norm[j]
        if k not in nn or d[j] < nn[k][0]: nn[k] = (d[j], j)
    for e in enames:
        reason = None; best = None
        if pat.search(e): reason = "name"
        for k, (dj, j) in nn.items():
            if fuzz.token_set_ratio(e, k) >= FT and (best is None or dj < best[0]): best = (dj, j)
        if best is not None: reason = (reason + "+fuzzy") if reason else "fuzzy"
        if reason is None: continue
        if best is not None:
            dj, j = best; lat, lon, gs, dist = bs.lat[j], bs.lon[j], "excel", dj
        else:
            lat, lon, gs, dist = s.lat + off / 111000, s.lon, "station_proxy", off
        rows.append(dict(station_id=s.id, etm_norm=e, cand_reason=reason, lat=lat, lon=lon, geo_source=gs, straight_m=round(dist), pax_day=vol[e]))
c = pd.DataFrame(rows)
cfg = yaml.safe_load(open(ROOT / "config.yaml")); ov = {}; out = []
for sid, g in c.groupby("station_id"):
    n0 = ((g.straight_m <= R0) & (g.pax_day > 0)).sum()
    R = R0 if n0 >= CFG["treatment_min_stops_with_volume"] else R1
    if R != R0: ov[sid] = R
    out.append(g.assign(radius=R))
c = pd.concat(out); c["treat"] = c.straight_m <= c.radius
sm = pd.read_csv(REF / "stop_matches.csv"); sm = sm[sm.matched][["etm_norm", "excel_norm"]]
ctrl = []
for i, s in st.iterrows():
    d = bg.distance(sg.iloc[i]).values; ring = np.where((d >= CFG["control_ring_m"][0]) & (d <= CFG["control_ring_m"][1]))[0]
    rk = pd.DataFrame({"excel_norm": bs.norm.values[ring], "d": d[ring], "lat": bs.lat.values[ring], "lon": bs.lon.values[ring]}).sort_values("d").drop_duplicates("excel_norm")
    m = rk.merge(sm, on="excel_norm"); m = m[m.etm_norm.map(lambda x: vol.get(x, 0) > 0)]
    tn = set(c[(c.station_id == s.id) & c.treat].etm_norm)
    for _, r in m.iterrows():
        if r.etm_norm in tn: continue
        ctrl.append(dict(station_id=s.id, etm_norm=r.etm_norm, cand_reason="control", lat=r.lat, lon=r.lon, geo_source="excel", straight_m=round(r.d), pax_day=vol[r.etm_norm], radius=np.nan, treat=False))
cc = pd.DataFrame(ctrl)
allc = pd.concat([c[c.treat].assign(group="treatment"), cc.assign(group="control")], ignore_index=True)
allc["stop_id"] = allc.etm_norm.str.lower().str.replace(" ", "-")
allc["walk_m"] = (allc.straight_m * CFG["walk_factor"]).round(); allc["walk_min"] = (allc.walk_m / CFG["walk_speed_mps"] / 60).round(2)
allc = allc.rename(columns={"etm_norm": "stop_name", "lat": "stop_lat", "lon": "stop_lon"})
allc.to_csv(REF / "stop_matches_v2.csv", index=False); pl.from_pandas(allc).write_parquet(INTERIM / "catchments.parquet")
cfg["radius_override_m"] = {k: int(x) for k, x in ov.items()}
yaml.safe_dump(cfg, open(ROOT / "config.yaml", "w"), sort_keys=False)
exits = pl.read_parquet(INTERIM / "cmrl_exit_clean.parquet").filter(pl.col("valid") & (pl.col("ttype") == "Exit")).group_by("station").len().to_pandas()
exits["exits_day"] = exits["len"] / 4; exits["id"] = exits.station.map(dict(zip(st.name, st.id))); top = exits.sort_values("exits_day", ascending=False).head(15)
t = allc[allc.group == "treatment"]
print("widened stations:", ov)
for _, r in top.iterrows():
    g = t[t.station_id == r.id].sort_values("pax_day", ascending=False)
    print(f"{r.id:20s} exits/day {r.exits_day:6.0f} | stops w/ volume {len(g):2d} | pax/day there {g.pax_day.sum():8.0f} | proxy {int((g.geo_source=='station_proxy').sum())} | {', '.join(g.stop_name.head(3))}")
print("stations with 0 treatment stops:", sorted(set(st.id) - set(t.station_id)))
print("control rows", len(cc), "treatment rows", len(t))
