"""Consistency checks over out/route_flows/*.json -> out/debug/consistency_report.md"""
import warnings; warnings.filterwarnings("ignore")
import json, polars as pl, pandas as pd
from pyproj import Transformer
from shapely.geometry import Point, LineString
from common import *

RF = OUT / "route_flows"
to_m = Transformer.from_crs(4326, 32644, always_xy=True).transform
HOURS = range(5, 24)
E = pl.read_parquet(INTERIM / "echo_arrivals.parquet").to_pandas(); E = E[E.echo_s > 0]
cat = pl.read_parquet(INTERIM / "catchments.parquet").to_pandas(); cat = cat[cat.group == "treatment"].drop_duplicates(["station_id", "stop_name"])
stops_of = cat.groupby("station_id").stop_name.apply(set).to_dict()
fails = []; checks = 0; summary = dict(stations=0, routes=0, with_path=0)


def fail(sid, what, detail): fails.append((sid, what, detail))


for f in sorted(RF.glob("*.json")):
    if f.name == "index.json": continue
    d = json.load(open(f)); sid = d["station_id"]; summary["stations"] += 1; routes = d["routes"]
    if not routes: continue
    own = stops_of.get(sid, set())
    # 1. route shares sum to 100 — daily
    checks += 1; tot = sum(r["share_pct"] for r in routes) + d["others"]["share_pct"]
    if abs(tot - 100) > 0.5: fail(sid, "daily route shares", f"sum={tot:.1f}")
    # 1b. hourly
    oh = {x["hour"]: x["share_pct"] for x in d["others"].get("hourly", [])}
    for h in HOURS:
        if h not in oh: continue
        checks += 1; t = oh[h] + sum(x["share_pct"] for r in routes for x in r["hourly"] if x["hour"] == h)
        if abs(t - 100) > 0.5: fail(sid, "hourly route shares", f"hour {h} sum={t:.1f}")
    for r in routes:
        summary["routes"] += 1; tag = f"{r['route']} {r['dir']}"
        # 2. drop-offs + other = 100
        do = r["dropoffs"]
        for band, oth in (("all_day", "other_pct"), ("am_peak", "other_pct_am_peak"), ("pm_peak", "other_pct_pm_peak")):
            if do.get(band):
                checks += 1; t = sum(x["pct"] for x in do[band]) + do.get(oth, 0)
                if abs(t - 100) > 0.5: fail(sid, "drop-offs + other", f"{tag} {band} sum={t:.1f}")
        # 3. board stop is a treatment stop
        checks += 1
        if r.get("board_stop_raw") not in own: fail(sid, "board stop not a treatment stop", f"{tag}: {r.get('board_stop_raw')}")
        # 5. path starts near the board stop; 6. drop-offs near the path
        if r["has_shape"]:
            summary["with_path"] += 1; ah = r["ahead_path"]; fp = r["full_path"]
            checks += 1
            if r["board_index"] is None or fp[r["board_index"]] != ah[0]: fail(sid, "board_index mismatch", tag)
            bp = Point(*to_m(r["board_lon"], r["board_lat"])); ln = LineString([to_m(x, y) for x, y in ah])
            checks += 1
            if Point(ln.coords[0]).distance(bp) > 300: fail(sid, "path start > 300 m from board stop", f"{tag}: {Point(ln.coords[0]).distance(bp):.0f} m")
            for band in ("all_day", "am_peak", "pm_peak"):
                for x in do.get(band, []):
                    checks += 1; p = Point(*to_m(x["lon"], x["lat"])); dd = ln.distance(p)
                    if dd > 400: fail(sid, "drop-off outside 400 m of path", f"{tag} {x['name']}: {dd:.0f} m")
                    elif ln.project(p) < 100: fail(sid, "drop-off not after board stop", f"{tag} {x['name']}")
    # 4. most_likely[h] equals the top hourly share (re-derived independently from the echo table)
    g = E[E.station_id == sid]
    if g.empty: continue
    hr = g.groupby("hour").echo_s.sum() / 4
    grp = (g.groupby(["hour", "route", "dir", "stop_name"]).echo_s.sum() / 4).reset_index()
    for h in HOURS:
        ml = d["most_likely"].get(str(h)); checks += 1
        if ml is None: fail(sid, "most_likely missing", f"hour {h}"); continue
        if ml.get("fallback"):
            if hr.get(h, 0) > 0: fail(sid, "most_likely used fallback although hour has data", f"hour {h}")
            continue
        hh = grp[grp.hour == h].sort_values("echo_s", ascending=False).iloc[0]; exp = hh.echo_s / hr[h] * 100
        if (hh.route, hh.dir) != (ml["route"], ml["dir"]) and abs(exp - ml["share_pct_of_bus_takers"]) > 0.15:
            fail(sid, "most_likely != top hourly share", f"hour {h}: file {ml['route']} {ml['share_pct_of_bus_takers']}% vs top {hh.route} {exp:.1f}%")
        elif abs(exp - ml["share_pct_of_bus_takers"]) > 0.15: fail(sid, "most_likely share value", f"hour {h}: {ml['share_pct_of_bus_takers']} vs {exp:.1f}")
        if ml["board_stop_raw"] not in own: fail(sid, "most_likely board stop not a treatment stop", f"hour {h}: {ml['board_stop_raw']}")
        for ru in ml.get("runners_up", []):
            if ru["share_pct_of_bus_takers"] > ml["share_pct_of_bus_takers"] + 0.05: fail(sid, "most_likely ranking", f"hour {h}")

md = ["# Consistency report", "", f"Stations: {summary['stations']} · routes checked: {summary['routes']} (with path: {summary['with_path']}) · checks run: {checks} · **failures: {len(fails)}**", ""]
if fails:
    from collections import Counter
    md += ["## Failures by type", ""] + [f"- {k}: {v}" for k, v in Counter(w for _, w, _ in fails).most_common()] + ["", "## Detail", ""]
    md += [f"- `{sid}` — {w}: {dt}" for sid, w, dt in fails]
else:
    md.append("All checks passed.")
(OUT / "debug" / "consistency_report.md").write_text("\n".join(md), encoding="utf8")
print("\n".join(md[:40]))
