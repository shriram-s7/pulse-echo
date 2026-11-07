import numpy as np, pandas as pd, polars as pl
from common import *
cat = pl.read_parquet(INTERIM / "catchments.parquet").to_pandas(); names = set(cat.stop_name)
arr = []; starts = []
for d in WIN_DAYS:
    df = pl.read_parquet(INTERIM / f"etm_{d}_clean.parquet", columns=["fleet_no", "waybill_no", "trip_no", "source", "pax", "ts", "route", "dir", "route_service_type", "Trip_Destination", "valid"]) \
           .filter(pl.col("valid") & pl.col("route").is_not_null() & (pl.col("ts").dt.date() == pl.lit(d).str.to_date()))
    ts_ = df.group_by(["fleet_no", "waybill_no", "trip_no", "route", "dir"]).agg(pl.col("ts").min().alias("start")).with_columns(day=pl.lit(d))
    starts.append(ts_)
    srcs = df["source"].unique().drop_nulls().to_list(); m = pl.DataFrame({"source": srcs, "stop_name": [norm(s) for s in srcs]}).filter(pl.col("stop_name").is_in(list(names)))
    a = df.join(m, on="source").group_by(["fleet_no", "waybill_no", "trip_no", "route", "dir", "stop_name"]).agg(
        pl.col("ts").min().alias("t"), pl.col("pax").sum().alias("boardings"), pl.col("route_service_type").first().alias("stype"), pl.col("Trip_Destination").first().alias("trip_dest")).with_columns(day=pl.lit(d))
    arr.append(a)
A = pl.concat(arr).to_pandas().sort_values(["day", "stop_name", "route", "dir", "t"]).reset_index(drop=True)
g = A.groupby(["day", "stop_name", "route", "dir"]).t
A["gap_min"] = g.diff().dt.total_seconds() / 60
A["hour"] = A.t.dt.hour; A["tsec"] = (A.t - A.t.dt.normalize()).dt.total_seconds()
# headway per (stop,route,dir,hour): median gap
hw = A.groupby(["stop_name", "route", "dir", "hour"]).gap_min.median().rename("headway_min").reset_index()
A = A.merge(hw, on=["stop_name", "route", "dir", "hour"], how="left")
S = pl.concat(starts).to_pandas().sort_values(["day", "fleet_no", "route", "dir", "start"])
S["gap"] = S.groupby(["day", "fleet_no", "route", "dir"]).start.diff().dt.total_seconds() / 60
cyc = S[(S.gap >= 10) & (S.gap <= 400)].groupby(["route", "dir"]).gap.median().rename("cycle_min").reset_index()
pl.from_pandas(A).write_parquet(INTERIM / "bus_arrivals.parquet"); pl.from_pandas(cyc).write_parquet(INTERIM / "route_cycle.parquet")
print(len(A), "arrivals;", A.stop_name.nunique(), "stops;", A.route.nunique(), "routes;", len(cyc), "route-dir cycles; median cycle", round(cyc.cycle_min.median(), 1))
print(A.stype.value_counts().head(8).to_string())
