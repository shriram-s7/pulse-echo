import pandas as pd, polars as pl, geopandas as gpd, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt, json
from common import *
st = pd.read_csv(REF / "stations.csv"); c = pl.read_parquet(INTERIM / "catchments.parquet").to_pandas()
ex = pl.read_parquet(INTERIM / "cmrl_exit_clean.parquet").filter(pl.col("valid") & (pl.col("ttype") == "Exit")).group_by("station").len().to_pandas()
days = 4; ex["exits_per_day"] = (ex["len"] / days).round(0); top = ex.sort_values("exits_per_day", ascending=False).head(10)
name2id = dict(zip(st.name, st.id)); top["id"] = top.station.map(name2id)
pd.set_option("display.width", 250, "display.max_colwidth", 45)
for _, r in top.iterrows():
    t = c[(c.station_id == r.id) & (c.group == "treatment")].sort_values("walk_m")
    print(f"\n{r.id}: ~{int(r.exits_per_day)} exits/day, {len(t)} treatment stops, {int(t.has_tickets.sum())} with ETM tickets")
    print(t[["stop_name", "walk_m", "walk_min", "has_tickets", "etm_pax"]].head(8).to_string(index=False))
fig, ax = plt.subplots(figsize=(14, 14))
lines = json.load(open(OUT / "stations.json"))["lines"]; gpd.GeoDataFrame.from_features(lines["features"]).plot(ax=ax, color="#bbb", lw=1)
tr = c[c.group == "treatment"]; ax.scatter(tr.stop_lon[~tr.has_tickets], tr.stop_lat[~tr.has_tickets], s=6, c="#aaa", label="treatment stop, no ETM match")
ax.scatter(tr.stop_lon[tr.has_tickets], tr.stop_lat[tr.has_tickets], s=14, c="#E07A1F", label="treatment stop, ETM matched")
ax.scatter(st.lon, st.lat, s=40, c="#3B6FE0", label="Metro station"); 
for _, r in st.iterrows(): ax.annotate(r["id"], (r.lon, r.lat), fontsize=6)
ax.legend(); ax.set_aspect(1.03); fig.savefig(OUT / "debug" / "stations_map.png", dpi=110, bbox_inches="tight")
