import json, glob
from common import *
bad = []
def need(o, keys, where):
    for k in keys:
        if k not in o: bad.append(f"{where}: missing {k}")
L = lambda f: json.load(open(OUT / f))
s = L("stations.json"); need(s, ["stations", "lines"], "stations")
for x in s["stations"]: need(x, ["id", "name", "line", "lat", "lon"], "stations.station")
h = L("hotspots.json"); need(h, ["window", "stations", "totals"], "hotspots"); need(h["totals"], ["transfers_per_day", "top_station", "worst_wait_station"], "hotspots.totals")
for x in h["stations"]:
    need(x, ["id", "exits_per_day", "transfers_per_day", "transfer_pct", "avg_wait_min", "level", "wait_level", "hourly"], "hotspots.station")
    for y in x["hourly"]: need(y, ["hour", "exits", "transfers", "avg_wait_min"], "hotspots.hourly")
f = L("flows.json"); sums = {}
for x in f["flows"]:
    need(x, ["station_id", "stop_id", "stop_name", "stop_lat", "stop_lon", "walk_m", "direction", "transfers_per_day", "share_pct", "routes", "hourly"], "flows")
    sums[x["station_id"]] = sums.get(x["station_id"], 0) + x["share_pct"]
    for r in x["routes"]: need(r, ["route", "transfers_per_day", "share_pct", "avg_wait_min", "headway_min"], "flows.routes")
    for r in x["hourly"]: need(r, ["hour", "transfers", "share_pct"], "flows.hourly")
for k, v in sums.items():
    if abs(v - 100) > 0.5: bad.append(f"flows shares for {k} sum {v}")
r = L("recommendations.json"); need(r, ["summary", "items"], "recs"); need(r["summary"], ["extra_buses_total", "routes_affected", "passenger_minutes_saved_per_day"], "recs.summary")
for x in r["items"]:
    need(x, ["id", "station_id", "route", "hours", "type", "action", "evidence", "extra_buses", "shift_min", "before_after", "passenger_minutes_saved_per_day", "rank"], "recs.item")
    need(x["evidence"], ["transfers", "avg_wait_min", "headway_min", "boardings_per_trip", "capacity"], "recs.evidence"); need(x["before_after"], ["wait_before", "wait_after"], "recs.ba")
g = L("regulars.json")
for x in g["flows"]: need(x, ["station_id", "window", "regular_cards", "top_route", "dest_name", "dest_lat", "dest_lon", "likely_purpose"], "regulars")
n = L("nudge.json")
for c in n["curves"]: need(c, ["station_id", "route", "hours", "points", "best_shift_min"], "nudge")
L("quality_report.json")
fs = glob.glob(str(OUT / "station" / "*.json"))
for p in fs:
    d = json.load(open(p)); need(d, ["id", "pulse_echo", "routes", "regulars", "method", "validation"], "station"); need(d["pulse_echo"], ["date", "exits_5min", "bus_arrivals"], "station.pe")
print("station files:", len(fs), "| problems:", len(bad)); print("\n".join(bad[:30]))
