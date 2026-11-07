import json, re, numpy as np, pandas as pd, polars as pl, geopandas as gpd
from common import *
base = RAW / "Public Transport" / "Metro Rail"
pts = gpd.read_file(base / "Operational_Metro_Stns.shp")
ex_ = pts["Name"].str.extract(r"(C[12])-Stations (\d+)"); pts["shp"] = [f"{a}-{int(b)}" if isinstance(a, str) else n for a, b, n in zip(ex_[0], ex_[1], pts["Name"])]
pts = pts.set_index("shp")
# CMRL name -> (id, shapefile point). Order along line from the shapefile numbering (C1 = Blue, N->S; C2 = Green),
# cross-checked below against Excel bus stops and known public coordinates.
M = [
 ("WIMCO NAGAR DEPOT","wimco-nagar-depot","C1-1"),("WIMCO NAGAR METRO","wimco-nagar","C1-2"),
 ("THIRUVOTRIYUR METRO","thiruvotriyur","C1-3"),("THIRUVOTRIYUR THERADI METRO","thiruvotriyur-theradi","C1-4"),
 ("KALADIPET METRO","kaladipet","C1-5"),("TOLLGATE METRO","tollgate","C1-6"),("NEW WASHERMENPET METRO","new-washermenpet","C1-7"),
 ("TONDIARPET METRO","tondiarpet","C1-8"),("THIYAGARAYA COLLEGE METRO","thiyagaraya-college","C1-9"),
 ("WASHERMENPET","washermenpet","C1-10"),("MANNADI","mannadi","C1-11"),("HIGH COURT","high-court","C1-12"),
 ("PURATCHI THALAIVAR DR.M.G.RAMACHANDRAN CENTRAL METRO","central","C2-18"),
 ("GOVERNMENT ESTATE","government-estate","C1-14"),("LIC","lic","C1-15"),("THOUSAND LIGHT","thousand-lights","C1-16"),
 ("AG-DMS","ag-dms","C1-17"),("TEYNAMPET","teynampet","C1-18"),("NANDANAM","nandanam","C1-19"),("SAIDAPET","saidapet","C1-20"),
 ("LITTLE MOUNT","little-mount","C1-21"),("GUINDY","guindy","C1-22"),("ARIGNAR ANNA ALANDUR METRO","alandur","C2-17"),
 ("OTA - NANGANALLUR ROAD","ota-nanganallur-road","C1-24"),("MEENAMBAKKAM","meenambakkam","C1-25"),("AIRPORT","airport","C1-26"),
 ("VADAPALANI","vadapalani","C2-1"),("PACHIAPPAS COLLEGE","pachiappas-college","C2-2"),("SHENOY NAGAR","shenoy-nagar","C2-3"),
 ("ANNA NAGAR EAST","anna-nagar-east","C2-4"),("ANNA NAGAR TOWER","anna-nagar-tower","C2-5"),("THIRUMANGALAM","thirumangalam","C2-6"),
 ("EGMORE","egmore","C2-8"),("NEHRU PARK","nehru-park","C2-9"),("KILPAUK","kilpauk","C2-10"),("EKKATTUTHANGAL","ekkattuthangal","C2-11"),
 ("ASHOK NAGAR","ashok-nagar","C2-12"),("ARUMBAKKAM","arumbakkam","C2-13"),
 ("PURATCHI THALAIVI DR.J.JAYALALITHAA CMBT METRO","cmbt","C2-14"),("KOYAMBEDU","koyambedu","C2-15"),("ST. THOMAS MOUNT","st-thomas-mount","C2-16"),
]
# Method 1: Excel bus stops whose name contains METRO (and rough station keyword)
xl = pd.concat(pd.read_excel(RAW / "Tambaram, Avadi, GCC Bus Stops List  1.xlsx", sheet_name=None).values())
xl = xl[xl["Bus Stop Name"].str.contains("metro", case=False, na=False)]
xg = gpd.GeoDataFrame(xl, geometry=gpd.points_from_xy(xl.Longitude, xl.Latitude), crs=4326).to_crs(32644)
ent = pl.read_parquet(INTERIM / "cmrl_entry_clean.parquet"); ex = pl.read_parquet(INTERIM / "cmrl_exit_clean.parquet")
lines = pl.concat([ent.select("station", "line"), ex.filter(pl.col("station").is_not_null()).select("station", "line")]).unique()
lmap = {}
for n, l in lines.iter_rows():
    if l: lmap.setdefault(n, set()).add(l.split()[0])
rows = []
for name, sid, sp in M:
    p = pts.loc[sp].geometry; pp = gpd.GeoSeries([p], crs=4326).to_crs(32644).iloc[0]
    d = xg.geometry.distance(pp); j = d.idxmin() if len(d) else None
    dmin = float(d.min()); near = xg.loc[d.idxmin(), "Bus Stop Name"] if len(d) else ""
    ln = lmap.get(name, set()); line = "Both" if len(ln) > 1 or sid in ("central", "alandur") else (next(iter(ln)) if ln else "?")
    if dmin <= 250: src, conf = f"shp_point:{sp} + excel_check:'{near}' {dmin:.0f}m", "high"
    else: src, conf = f"shp_point:{sp} (ordered along {'Blue' if sp[:2]=='C1' else 'Green'} line; no METRO bus stop <250m)", "medium"
    rows.append(dict(id=sid, name=name, line=line, lat=round(p.y, 6), lon=round(p.x, 6), source=src, confidence=conf))
df = pd.DataFrame(rows)
# well-known public sanity check for a few stations (Guindy per contract)
chk = {"guindy": (13.0094, 80.2133), "airport": (12.9814, 80.1655)}
for k, (la, lo) in chk.items():
    r = df[df.id == k].iloc[0]; dm = np.hypot((r.lat-la)*111000, (r.lon-lo)*108000)
    print(f"sanity {k}: {dm:.0f} m from public coords")
df.to_csv(REF / "stations.csv", index=False)
pd.set_option("display.width", 250, "display.max_colwidth", 90); print(df.to_string())
print("not high confidence:", df[df.confidence != "high"].id.tolist())
lines_gj = gpd.read_file(base / "Operational_Metro.shp")
lines_gj["name"] = lines_gj["Corridors"]
colmap = {"Blue Line": "Blue", "Green Line": "Green"}
feat = []
for _, r in lines_gj.iterrows():
    if r["Corridors"] in colmap:
        feat.append({"type": "Feature", "properties": {"line": colmap[r["Corridors"]]}, "geometry": json.loads(gpd.GeoSeries([r.geometry], crs=4326).to_json())["features"][0]["geometry"]})
out = {"stations": [dict(id=r.id, name=r["name"], line=r.line, lat=r.lat, lon=r.lon) for _, r in df.iterrows()],
       "lines": {"type": "FeatureCollection", "features": feat}}
json.dump(out, open(OUT / "stations.json", "w"))
