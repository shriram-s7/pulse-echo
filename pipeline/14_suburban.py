import json, re, numpy as np, geopandas as gpd
from shapely.geometry import Point
from common import *
D = RAW / "Public Transport" / "Suburban Rail"
L = gpd.read_file(D / "Rail_Network_Updated.shp"); L = L[L.Type.notna() & (L.Type != "CheckAD")].to_crs(4326)
L = L[~L.geometry.is_empty & L.geometry.notna()]; L["geometry"] = L.geometry.simplify(0.0002)
feats = [dict(type="Feature", geometry=json.loads(gpd.GeoSeries([r.geometry], crs=4326).to_json())["features"][0]["geometry"], properties=dict(kind="line", type=str(r.Type), name=None)) for r in L.itertuples()]
# stations: KML points are generically named; name only the majors by nearest match (<400 m) to approximate public coordinates
txt = open(D / "Suburban Stations.kml", encoding="utf-8", errors="ignore").read()
pts = [(float(a), float(b)) for a, b in re.findall(r"<coordinates>\s*([\d.\-]+),([\d.\-]+)", txt)]
KNOWN = {"Chennai Central": (13.0827, 80.2757), "Chennai Egmore": (13.0732, 80.2609), "Park": (13.0787, 80.2703), "Chennai Beach": (13.0953, 80.2915),
         "Mambalam": (13.0392, 80.2228), "Guindy": (13.0092, 80.2210), "St. Thomas Mount": (12.9953, 80.1983), "Tambaram": (12.9249, 80.1177),
         "Velachery": (12.9758, 80.2208), "Perambur": (13.1171, 80.2413), "Avadi": (13.1070, 80.1010), "Chennai Fort": (13.0786, 80.2870)}
P = np.array([(la, lo) for lo, la in pts]); names = [None] * len(pts)
for nme, (la, lo) in KNOWN.items():
    d = np.hypot((P[:, 0] - la) * 111000, (P[:, 1] - lo) * 108000); i = int(d.argmin())
    if d[i] < 400 and names[i] is None: names[i] = nme
for (lo, la), n in zip(pts, names):
    feats.append(dict(type="Feature", geometry=dict(type="Point", coordinates=[round(lo, 5), round(la, 5)]), properties=dict(kind="station", type="Suburban", name=n, name_approximate=bool(n))))
json.dump(dict(type="FeatureCollection", features=feats, properties=dict(note="Display only. Station names for major stations are matched to approximate public coordinates; other stations are unnamed.")), open(OUT / "suburban.geojson", "w"), separators=(",", ":"))
print(len(L), "line features |", len(pts), "stations,", sum(n is not None for n in names), "named |", round((OUT / "suburban.geojson").stat().st_size / 1024), "KB")
