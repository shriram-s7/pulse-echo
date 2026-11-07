import numpy as np, pandas as pd, polars as pl
from rapidfuzz import process, fuzz
from common import *
zones = [("Tidel Park Taramani","IT park",12.9889,80.2486),("DLF IT Park Ramapuram","IT park",13.0213,80.1826),("Olympia Tech Park Guindy","IT park",13.0105,80.2060),
 ("Guindy Industrial Estate","industrial estate",13.0075,80.2075),("OMR IT corridor (Sholinganallur)","IT corridor",12.9010,80.2279),("SIPCOT Siruseri","IT park",12.8290,80.2210),
 ("Ambattur Industrial Estate","industrial estate",13.1143,80.1548),("IIT Madras","college",12.9916,80.2336),("Anna University","college",13.0108,80.2354),
 ("CMBT Koyambedu","bus terminus",13.0694,80.2048),("Chennai Central","railway hub",13.0827,80.2757),("Egmore","railway hub",13.0732,80.2609),("T Nagar","commercial",13.0418,80.2341),
 ("Rajiv Gandhi Govt Hospital","hospital",13.0810,80.2778),("Chennai Port","port",13.1010,80.2970),("Mount Road offices","offices",13.0604,80.2606),
 ("Ekkattuthangal","industrial/commercial",13.0165,80.2052),("Perungudi","IT/commercial",12.9650,80.2461),("Taramani","IT/commercial",12.9850,80.2400),
 ("Kathipara","junction",13.0067,80.2064),("Velachery","commercial/residential",12.9815,80.2180)]
pd.DataFrame(zones, columns=["zone", "type", "lat", "lon"]).assign(source="hand-curated (approximate)").to_csv(REF / "poi_zones.csv", index=False)
Z = pd.read_csv(REF / "poi_zones.csv")
ex = pl.read_parquet(INTERIM / "cmrl_exit_clean.parquet").filter(pl.col("valid") & (pl.col("ttype") == "Exit"))        .with_columns(m=(pl.col("ts").dt.hour().cast(pl.Int32) * 60 + pl.col("ts").dt.minute().cast(pl.Int32)), day=pl.col("date").cast(pl.Utf8))
st = pd.read_csv(REF / "stations.csv"); n2i = dict(zip(st.name, st.id))
ex = ex.with_columns(med=pl.col("m").median().over(["station", "card"])).filter((pl.col("m") - pl.col("med")).abs() <= 20)
cd = ex.group_by(["station", "card"]).agg(pl.col("day").n_unique().alias("nd"), pl.col("med").first()).filter(pl.col("nd") >= CFG["regulars_min_days"])        .with_columns(win=((pl.col("med") // 30) * 30).cast(pl.Int32)).group_by(["station", "win"]).len().rename({"len": "regular_cards"})        .filter(pl.col("regular_cards") >= CFG["regulars_min_cards"]).to_pandas()
cd["station_id"] = cd.station.map(n2i)
E = pl.read_parquet(INTERIM / "echo_arrivals.parquet").to_pandas()
bs = pd.read_csv(REF / "bus_stops.csv"); bn = list(bs.norm.unique()); bpt = bs.groupby("norm")[["lat", "lon"]].first()
def geocode(name):
    n = norm(name); 
    if n in bpt.index: return n, *bpt.loc[n]
    b = process.extractOne(n, bn, scorer=fuzz.token_set_ratio)
    if b and b[1] >= CFG["fuzzy_threshold"]: return b[0], *bpt.loc[b[0]]
    return None, None, None
dest_cache = {}
def hav(a, b, c, d): return np.hypot((a - c) * 111000, (b - d) * 108000)
rows = []
for _, r in cd.iterrows():
    g = E[(E.station_id == r.station_id) & (E.hour >= r.win // 60) & (E.hour <= (r.win + 29) // 60)]
    if g.echo_s.sum() <= 0: continue
    rt = g.groupby("route").echo_s.sum(); route = rt.idxmax(); gr = g[g.route == route]
    td = gr.groupby("trip_dest").echo_s.sum().idxmax() if gr.trip_dest.notna().any() else None
    if td is None: continue
    if td not in dest_cache: dest_cache[td] = geocode(td)
    gn, la, lo = dest_cache[td]
    hint = str(td).title()
    if la is not None:
        dz = Z.assign(d=hav(Z.lat, Z.lon, la, lo)).sort_values("d").iloc[0]
        if dz.d <= 1500: hint = f"{dz.zone} ({dz.type})"
    w0 = f"{r.win // 60:02d}:{r.win % 60:02d}"; e = r.win + 30; w1 = f"{e // 60:02d}:{e % 60:02d}"
    purpose = "work/education" if 7 * 60 <= r.win < 10 * 60 + 30 else "other"
    rows.append(dict(station_id=r.station_id, window=f"{w0}-{w1}", regular_cards=int(r.regular_cards), top_route=route, route_share_pct=round(rt[route] / rt.sum() * 100, 1),
                     likely_purpose=purpose, destination_hint=hint, dest_name=str(td).title(), dest_lat=la, dest_lon=lo))
R = pd.DataFrame(rows); R.to_parquet(INTERIM / "regulars.parquet")
print(len(cd), "windows >= thresholds;", len(R), "with route+dest;", int(R.dest_lat.notna().sum()), "geocoded"); print(R.sort_values("regular_cards", ascending=False).head(8).to_string())
