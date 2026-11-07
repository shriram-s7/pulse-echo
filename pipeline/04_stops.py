import re, numpy as np, pandas as pd, polars as pl, geopandas as gpd
from rapidfuzz import process, fuzz
from common import *
def norm(s):
    s = str(s).upper().replace("&", " AND ")
    s = re.sub(r"\b([A-Z])\.([A-Z])\.?", r"\1\2", s)          # R.S. -> RS
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\b(BUS STAND|BUSSTAND|BUS STOP|BUS STN|BUS STATION)\b", "BS", s)
    s = re.sub(r"\b(RAILWAY STATION|RLY STATION|RLY STN|RAILWAY STN|RAIL STATION)\b", "RS", s)
    s = re.sub(r"\b(METRO STATION|METRO RAIL|METRO RLY|METRO RAILWAY STATION)\b", "METRO", s)
    s = re.sub(r"\b(JUNCTION|JCN|JUN|JN)\b", "JN", s)
    return re.sub(r"\s+", " ", s).strip()
xl = pd.concat([d.assign(sheet=k) for k, d in pd.read_excel(RAW / "Tambaram, Avadi, GCC Bus Stops List  1.xlsx", sheet_name=None).items()], ignore_index=True)
xl = xl.dropna(subset=["Latitude", "Longitude", "Bus Stop Name"]).copy()
xl["norm"] = xl["Bus Stop Name"].map(norm)
xl["stop_id"] = xl["norm"].str.lower().str.replace(" ", "-") + "-" + (xl.groupby("norm").cumcount() + 1).astype(str)
xl.rename(columns={"Latitude": "lat", "Longitude": "lon", "Bus Stop Name": "stop_name_raw"})[["stop_id", "norm", "stop_name_raw", "sheet", "lat", "lon"]].to_csv(REF / "bus_stops.csv", index=False)
# ETM source volumes (passengers, valid rows, all 1-7 Mar)
vol = pl.concat([pl.read_parquet(INTERIM / f"etm_{d}_clean.parquet", columns=["source", "pax", "valid"]).filter(pl.col("valid")).group_by("source").agg(pl.col("pax").sum().alias("pax"), pl.len().alias("tickets")) for d in CFG["ingest_days"]]) \
        .group_by("source").agg(pl.col("pax").sum(), pl.col("tickets").sum()).drop_nulls("source").to_pandas()
vol["norm"] = vol["source"].map(norm)
vol = vol.groupby("norm", as_index=False).agg(pax=("pax", "sum"), tickets=("tickets", "sum"), etm_names=("source", lambda x: "|".join(sorted(set(x))[:3])))
xnames = sorted(xl["norm"].unique()); thr = CFG["fuzzy_threshold"]
ov_path = REF / "stop_overrides.csv"
ov = dict(pd.read_csv(ov_path).values[:, :2]) if ov_path.exists() else {}
rows = []
for _, r in vol.iterrows():
    n = r["norm"]
    if n in ov: m, sc, how = ov[n], 100, "override"
    elif n in set(xnames): m, sc, how = n, 100, "exact"
    else:
        b = process.extractOne(n, xnames, scorer=fuzz.token_set_ratio)
        m, sc = (b[0], b[1]) if b else (None, 0); how = "fuzzy"
    rows.append(dict(etm_norm=n, etm_names=r["etm_names"], pax=int(r["pax"]), tickets=int(r["tickets"]), excel_norm=m, score=sc, how=how, matched=sc >= thr and m is not None))
sm = pd.DataFrame(rows).sort_values("pax", ascending=False); sm.to_csv(REF / "stop_matches.csv", index=False)
print(f"ETM unique normalised source names: {len(sm)}; matched names {sm.matched.sum()} ({sm.matched.mean():.1%})")
print(f"MATCH RATE BY TICKET VOLUME: pax {sm[sm.matched].pax.sum()/sm.pax.sum():.1%}, tickets {sm[sm.matched].tickets.sum()/sm.tickets.sum():.1%}")
# unmatched high-volume names: best fuzzy candidate, listed if candidate within 1.5 km of a station
st = pd.read_csv(REF / "stations.csv"); sg = gpd.GeoSeries(gpd.points_from_xy(st.lon, st.lat), crs=4326).to_crs(32644)
xg = gpd.GeoSeries(gpd.points_from_xy(xl.Longitude, xl.Latitude), crs=4326).to_crs(32644)
xl["dstn"] = [float(sg.distance(p).min()) for p in xg]; nearst = xl.groupby("norm").dstn.min()
um = sm[~sm.matched].head(300).copy()
cand = []
for n in um.etm_norm:
    b = process.extractOne(n, xnames, scorer=fuzz.WRatio); cand.append((b[0], b[1]))
um["cand"] = [c[0] for c in cand]; um["cand_score"] = [c[1] for c in cand]; um["cand_dist_to_stn_m"] = um.cand.map(nearst).round(0)
um = um[um.cand_dist_to_stn_m <= 1500]
um.to_csv(INTERIM / "unmatched_near_station.csv", index=False)
pd.set_option("display.width", 250, "display.max_colwidth", 50)
print("Unmatched high-volume (best candidate within 1.5 km of a station):"); print(um.head(40)[["etm_norm", "pax", "cand", "cand_score", "cand_dist_to_stn_m"]].to_string())
print("top unmatched overall:"); print(sm[~sm.matched].head(25)[["etm_norm", "pax", "score"]].to_string())
