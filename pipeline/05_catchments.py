import numpy as np, pandas as pd, geopandas as gpd, polars as pl
from common import *
st = pd.read_csv(REF / "stations.csv"); bs = pd.read_csv(REF / "bus_stops.csv"); sm = pd.read_csv(REF / "stop_matches.csv")
sm = sm[sm.matched]; vol = sm.groupby("excel_norm").agg(etm_pax=("pax", "sum"), etm_tickets=("tickets", "sum")).reset_index()
bs = bs.merge(vol, left_on="norm", right_on="excel_norm", how="left").drop(columns="excel_norm"); bs["has_tickets"] = bs.etm_pax.notna()
sg = gpd.GeoSeries(gpd.points_from_xy(st.lon, st.lat), crs=4326).to_crs(32644); bg = gpd.GeoSeries(gpd.points_from_xy(bs.lon, bs.lat), crs=4326).to_crs(32644)
R = CFG["treatment_radius_m"]; c0, c1 = CFG["control_ring_m"]; wf = CFG["walk_factor"]; sp = CFG["walk_speed_mps"]
rows = []
for i, s in st.iterrows():
    d = bg.distance(sg.iloc[i]).values
    for grp, m in (("treatment", d <= R), ("control", (d >= c0) & (d <= c1))):
        for j in np.where(m)[0]:
            rows.append(dict(station_id=s.id, group=grp, stop_id=bs.stop_id[j], stop_name=bs.norm[j], stop_lat=bs.lat[j], stop_lon=bs.lon[j],
                             straight_m=round(d[j]), walk_m=round(d[j] * wf), walk_min=round(d[j] * wf / sp / 60, 2), has_tickets=bool(bs.has_tickets[j]), etm_pax=bs.etm_pax[j]))
c = pd.DataFrame(rows); pl.from_pandas(c).write_parquet(INTERIM / "catchments.parquet")
print(c.groupby(["station_id", "group"]).size().unstack(fill_value=0).to_string())
print("treatment stops with tickets:", int(c[(c.group == "treatment")].has_tickets.sum()), "of", int((c.group == "treatment").sum()))
