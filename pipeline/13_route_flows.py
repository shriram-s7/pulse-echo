"""Route flows per station: top-5 bus routes, clean full/ahead paths, validated drop-offs, hourly 'most likely'.

Output: out/route_flows/<station>.json  (+ index.json, out/debug/route_match_stats.json)
"""
import warnings; warnings.filterwarnings("ignore")
import json, re, numpy as np, pandas as pd, polars as pl, geopandas as gpd
from collections import defaultdict
from pyproj import Transformer
from shapely.geometry import Point, LineString, MultiLineString
from shapely.ops import linemerge, substring, transform
from shapely import STRtree
from common import *

RF = OUT / "route_flows"; RF.mkdir(exist_ok=True)
HOURS = list(range(5, 24))
BANDS = {"all_day": (0, 24), "am_peak": (7, 10), "pm_peak": (16, 20)}
MAX_BOARD_M, END_OK_M, DROP_OK_M, MIN_AFTER_M, SPUR_M, GAP_M = 300, 2000, 400, 150, 100, 1500
SIMPLIFY_DEG, MAX_PTS = 0.00005, 1500

rn = lambda s: re.sub(r"[\s\-\.]", "", str(s).upper())           # normalise route code
to_m = Transformer.from_crs(4326, 32644, always_xy=True).transform
to_deg = Transformer.from_crs(32644, 4326, always_xy=True).transform
pm = lambda lat, lon: Point(*to_m(lon, lat))                      # lat/lon -> metric point


def base_candidates(rk):
    """'28CT' -> ['28C', '28']: strip trailing letters while a digit remains."""
    out, s = [], rk
    while len(s) > 1 and s[-1].isalpha():
        s = s[:-1]
        if any(c.isdigit() for c in s): out.append(s)
    return out


def strip_base(rk):
    c = base_candidates(rk)
    return c[-1] if c else rk


E = pl.read_parquet(INTERIM / "echo_arrivals.parquet").to_pandas(); E = E[E.echo_s > 0].copy(); E["rk"] = E.route.map(rn)
st = pd.read_csv(REF / "stations.csv")
hot = {h["id"]: h for h in json.load(open(OUT / "hotspots.json"))["stations"]}
cat = pl.read_parquet(INTERIM / "catchments.parquet").to_pandas(); cat = cat[cat.group == "treatment"].drop_duplicates(["station_id", "stop_name"])
stops_of = cat.groupby("station_id").stop_name.apply(set).to_dict()

# ---------------- geocoding: v2 station-anchored stops, then the all-city Excel match
v2 = pd.read_csv(REF / "stop_matches_v2.csv").drop_duplicates("stop_name").set_index("stop_name")[["stop_lat", "stop_lon"]]
m1 = pd.read_csv(REF / "stop_matches.csv"); m1 = m1[m1.matched]
bs_df = pd.read_csv(REF / "bus_stops.csv"); bs = bs_df.groupby("norm")[["lat", "lon"]].first()
BS_ALL = {k: list(zip(g.lat, g.lon)) for k, g in bs_df.groupby("norm")}
m1 = m1[m1.excel_norm.isin(bs.index)].drop_duplicates("etm_norm").set_index("etm_norm")
nm = pd.read_csv(REF / "stop_matches.csv").drop_duplicates("etm_norm").set_index("etm_norm").etm_names.to_dict()


def geo(n):
    if n in v2.index: return float(v2.loc[n, "stop_lat"]), float(v2.loc[n, "stop_lon"])
    if n in m1.index: r = bs.loc[m1.loc[n, "excel_norm"]]; return float(r.lat), float(r.lon)
    return None


def cand_points(n):
    """Every plausible location for a (normalised) stop name: current geocode + all Excel stops sharing its normalised name."""
    pts, keys = [], {n}
    g = geo(n)
    if g: pts.append(g)
    if n in m1.index: keys.add(m1.loc[n, "excel_norm"])
    for k in keys: pts += BS_ALL.get(k, [])
    return list(dict.fromkeys(pts))


def label(n): return str(nm.get(n, n)).title()


# ---------------- paid tickets at treatment stops (3-6 Mar)
allstops = set(cat.stop_name); tk = []
for d in WIN_DAYS:
    df = pl.read_parquet(INTERIM / f"etm_{d}_clean.parquet", columns=["source", "destination", "route", "dir", "payment_type", "pax", "ts", "Trip_Destination", "valid"]) \
        .filter(pl.col("valid") & (pl.col("payment_type") != "FREE") & pl.col("destination").is_not_null() & pl.col("source").is_not_null() & pl.col("route").is_not_null() & pl.col("dir").is_not_null())
    srcs = df["source"].unique().to_list(); m = pl.DataFrame({"source": srcs, "sn": [norm(s) for s in srcs]}).filter(pl.col("sn").is_in(list(allstops)))
    df = df.join(m, on="source"); ds = df["destination"].unique().to_list(); td = df["Trip_Destination"].unique().drop_nulls().to_list()
    df = df.join(pl.DataFrame({"destination": ds, "dn": [norm(s) for s in ds]}), on="destination").join(pl.DataFrame({"Trip_Destination": td, "tn": [norm(s) for s in td]}), on="Trip_Destination", how="left")
    tk.append(df.with_columns(hour=pl.col("ts").dt.hour().cast(pl.Int32)).group_by(["sn", "route", "dir", "dn", "tn", "hour"]).agg(pl.col("pax").sum().alias("pax")).to_pandas())
TK = pd.concat(tk).groupby(["sn", "route", "dir", "dn", "tn", "hour"]).pax.sum().reset_index(); TK["rk"] = TK.route.map(rn)
print("paid ticket groups", len(TK), "pax", int(TK.pax.sum()))

# ---------------- route geometry (metric CRS)
G = gpd.read_file(RAW / "Public Transport" / "MTC" / "routes_merged.shp").to_crs(32644); G["rk"] = G.route_num.map(rn)
Gi = {k: g for k, g in G.groupby("rk")}
Gbase = defaultdict(set)
for k in Gi: Gbase[strip_base(k)].add(k)


def match_tiers(rk):
    """Ordered matching tiers [(keys, shape_source)]: exact, then base routes ('28CT' -> '28C' -> '28'), then sibling variants."""
    tiers = []
    if rk in Gi: tiers.append(([rk], "exact"))
    for b in base_candidates(rk):
        if b in Gi and b != rk: tiers.append(([b], "base_route"))
    for b in [rk] + base_candidates(rk):
        if b in Gbase:
            ks = [k for k in sorted(Gbase[b]) if k != rk and all(k not in t[0] for t in tiers)]
            if ks: tiers.append((ks, "base_route"))      # e.g. '28' -> 28A/28B variants
    return tiers


def match_keys(rk):
    t = match_tiers(rk)
    return (t[0][0], t[0][1]) if t else ([], "none")


def chain_parts(parts):
    """Merge polyline parts into ONE continuous line: linemerge, then chain by nearest endpoints, dropping spurs < 100 m."""
    parts = [p for p in parts if p.geom_type == "LineString" and not p.is_empty]
    if not parts: return None
    ml = linemerge(MultiLineString(parts)) if len(parts) > 1 else parts[0]
    if ml.geom_type == "LineString": return ml
    pieces = [p for p in ml.geoms if p.length >= SPUR_M] or [max(ml.geoms, key=lambda p: p.length)]
    pieces.sort(key=lambda p: -p.length)
    chain = list(pieces[0].coords); rest = [list(p.coords) for p in pieces[1:]]
    while rest:
        best = None
        for i, c in enumerate(rest):
            for rev in (False, True):
                cc = c[::-1] if rev else c
                for side in ("end", "start"):
                    a = chain[-1] if side == "end" else chain[0]; b = cc[0] if side == "end" else cc[-1]
                    d = Point(a).distance(Point(b))
                    if best is None or d < best[0]: best = (d, i, cc, side)
        d, i, cc, side = best
        if d > GAP_M: break
        chain = chain + cc[1:] if side == "end" else cc[:-1] + chain
        rest.pop(i)
    return LineString(chain)


_line_cache = {}
def route_lines(keys):
    """[(key, poly_idx, LineString)] — one merged line per direction (poly_idx)."""
    out = []
    for k in keys:
        for pi, g in Gi[k].groupby("poly_idx"):
            ck = (k, pi)
            if ck not in _line_cache: _line_cache[ck] = chain_parts(list(g.geometry))
            if _line_cache[ck] is not None: out.append((k, pi, _line_cache[ck]))
    return out


ZIG_MAX = 8


def zig_score(ln):
    """Zig-zag / back-tracking score of a metric line: hairpin turns (>~135 deg, legs >= 60 m) + 2 x self-crossings."""
    ln = ln.simplify(30)
    c = np.array(ln.coords)
    if len(c) < 3: return 0
    v = np.diff(c, axis=0); L = np.hypot(v[:, 0], v[:, 1]); hp = 0; prev = None
    for i in range(len(v)):
        if L[i] < 60: continue
        if prev is not None and (v[i] @ v[prev]) / (L[i] * L[prev]) < -0.7: hp += 1
        prev = i
    segs = [LineString(c[i:i + 2]) for i in range(len(c) - 1)]; t = STRtree(segs); cr = 0
    for i, sg in enumerate(segs):
        for j in t.query(sg):
            if j > i + 1 and sg.crosses(segs[j]): cr += 1
    return hp + 2 * cr


def insert_at(coords, d):
    """Insert the point at cumulative distance d (deg) into a coordinate list; return (coords, index)."""
    cum = 0.0
    for i in range(len(coords) - 1):
        seg = float(np.hypot(coords[i + 1][0] - coords[i][0], coords[i + 1][1] - coords[i][1]))
        if cum + seg >= d - 1e-12:
            t = 0 if seg == 0 else (d - cum) / seg
            p = [coords[i][0] + t * (coords[i + 1][0] - coords[i][0]), coords[i][1] + t * (coords[i + 1][1] - coords[i][1])]
            if t <= 1e-6: return coords, i
            if t >= 1 - 1e-6: return coords, i + 1
            return coords[:i + 1] + [p] + coords[i + 1:], i + 1
        cum += seg
    return coords, len(coords) - 1


stats = {}


def make_path(rt_key, bpt, end_cands, refs):
    """Pick direction/line for this route + board stop and build full/ahead paths. end_cands, refs: lists of metric Points."""
    tiers = match_tiers(rt_key)
    if not tiers: return None, "none"
    for keys, source in tiers:
        r = _make_path(keys, bpt, end_cands, refs)
        if r is not None: return r, source
    return None, tiers[0][1] + "_unusable"


def _make_path(keys, bpt, end_cands, refs):
    best = None
    for k, pi, ln0 in route_lines(keys):
        for rev in (False, True):
            ln = LineString(list(ln0.coords)[::-1]) if rev else ln0
            d_b = ln.distance(bpt)
            if d_b > MAX_BOARD_M: continue
            pb = ln.project(bpt)
            ends = [(ln.distance(e), ln.project(e)) for e in end_cands]
            d_e, pe = min(ends) if ends else (None, None)
            fwd_end = bool(ends) and d_e < END_OK_M and pe > pb + 100
            loop = ln.length > 2000 and Point(ln.coords[0]).distance(Point(ln.coords[-1])) < 400
            if loop and ends and d_e < END_OK_M: fwd_end = True
            rs = [ln.project(a) for a in refs if ln.distance(a) < 1500]
            ref_ok = sum(1 for x in rs if x > pb) / max(1, len(refs)) if refs else 0.0
            ahead_len = ln.length - pb
            cut_c = ln.length if (loop or not fwd_end or pe is None) else pe
            if cut_c - pb < 50: continue
            zs = zig_score(substring(ln, pb, cut_c))
            key = (fwd_end, zs < ZIG_MAX, round(ref_ok, 2), not rev, -(d_e or 0) // 250, -d_b // 50, -zs, ahead_len)
            if best is None or key > best[0]: best = (key, ln, pb, pe, d_e, fwd_end, loop, cut_c, zs)
    if best is None: return None
    _, ln, pb, pe, d_e, fwd_end, loop, cut, zs = best
    res = dict(line=ln, pb=pb, cut=cut, d_e=d_e, end_verified=fwd_end, loop=loop)
    res["full"], res["bi"], res["ahead"] = build_paths(res)
    res["zig"] = zig_score(LineString([to_m(x, y) for x, y in res["ahead"]]))     # measured on what we actually ship
    if res["zig"] >= ZIG_MAX:
        stats["zigzag_rejected"] = stats.get("zigzag_rejected", 0) + 1
        return None                                  # source polyline is a tangle: better list-only than a scribble
    return res


def build_paths(res):
    """Metric result -> simplified lon/lat full_path, board_index, ahead_path (board->route end)."""
    ln, pb, cut = res["line"], res["pb"], res["cut"]
    ln4 = transform(to_deg, ln); tol = SIMPLIFY_DEG
    while True:
        s = ln4.simplify(tol, preserve_topology=False)
        if len(s.coords) <= MAX_PTS: break
        tol *= 1.5
    coords = [list(c) for c in s.coords]
    bpt4 = transform(to_deg, ln.interpolate(pb)); ept4 = transform(to_deg, ln.interpolate(cut))
    coords, bi = insert_at(coords, s.project(bpt4))
    if cut >= ln.length - 1e-6: ei = len(coords) - 1
    else:
        coords, ei = insert_at(coords, LineString(coords).project(ept4))
        if ei <= bi: ei = len(coords) - 1
    full = [[round(x, 5), round(y, 5)] for x, y in coords]
    keep = [0] + [i for i in range(1, len(full)) if full[i] != full[i - 1] or i in (bi, ei)]
    remap = {old: new for new, old in enumerate(keep)}
    full = [full[i] for i in keep]; bi, ei = remap[bi], remap[ei]
    return full, bi, full[bi:ei + 1]


def dropoff_series(sub, own, chk, lo, hi, maxn=5, minpct=1.0):
    """Top drop-offs in an hour band; chk(name) -> validated/snapped point dict or None. Returns (list, total_pax)."""
    s = sub[(sub.hour >= lo) & (sub.hour < hi) & ~sub.dn.isin(own)].groupby("dn").pax.sum().sort_values(ascending=False)
    tot = float(s.sum()); lst = []
    if tot <= 0: return lst, 0.0
    for n, v in s.items():
        pct = v / tot * 100
        if pct < minpct: break
        g = chk(n)
        if g is None: continue
        lst.append(dict(name=label(n), lat=g["lat"], lon=g["lon"], pct=round(float(pct), 1)))
        if len(lst) == maxn: break
    return lst, tot


def make_checker(ahead_m):
    """Validator for a drop-off name against a metric ahead-line (or plain geocode when there is no path)."""
    cache = {}
    def chk(n):
        if n in cache: return cache[n]
        out = None
        pts = cand_points(n)
        if ahead_m is None:
            g = geo(n); out = dict(lat=round(g[0], 6), lon=round(g[1], 6)) if g else None
        else:
            orig = geo(n); order = ([orig] if orig else []) + [p for p in pts if p != orig]; best = None
            for lat, lon in order:
                p = pm(lat, lon); d = ahead_m.distance(p); al = ahead_m.project(p)
                if d <= DROP_OK_M and al >= MIN_AFTER_M:
                    if orig and (lat, lon) == orig: best = (d, al, p); break    # original geocode is valid: keep it
                    if best is None or d < best[0]: best = (d, al, p)
            if best is not None:
                sp = transform(to_deg, ahead_m.interpolate(best[1]))             # snap the dot onto the path
                out = dict(lat=round(sp.y, 6), lon=round(sp.x, 6), along_m=round(best[1]))
        cache[n] = out
        return out
    return chk


def other_pct_of(lst, tot): return round(max(0.0, 100 - sum(x["pct"] for x in lst)), 1) if tot > 0 else 0.0


def dropoffs(sub, own, chk):
    out = {}; others = {}
    for k, (a, b) in BANDS.items():
        lst, tot = dropoff_series(sub, own, chk, a, b); out[k] = lst; others[k] = other_pct_of(lst, tot)
    out["other_pct"] = others["all_day"]; out["other_pct_am_peak"] = others["am_peak"]; out["other_pct_pm_peak"] = others["pm_peak"]
    return out


# ---------------- main loop
index = []; stats.update(top5=0, key_exact=0, key_base=0, key_none=0, path_ok=0, full=0, partial=0, loops=0, dropoffs_kept=0)
for sid in st.id:
    g = E[E.station_id == sid]; tot = g.echo_s.sum() / 4; own = stops_of.get(sid, set()); hs = hot.get(sid, {})
    res = dict(station_id=sid, data_quality=hs.get("data_quality", "good"), total_bus_transfers_per_day=round(float(tot), 1), routes=[],
               others=dict(share_pct=0.0, route_count=0, hourly=[]), most_likely={},
               notes=["Drop-offs from paid tickets; free tickets assumed to follow the same pattern.", "Shares are placebo-corrected transfer estimates; route shapes from the MTC route file."])
    if tot > 0:
        pr = g.groupby(["route", "dir"]).echo_s.sum().div(4).sort_values(ascending=False)
        hr_tot = g.groupby("hour").echo_s.sum().div(4)
        top5_hourly = defaultdict(float); ctx = {}
        for (rt, dr), t in pr.head(5).items():
            gp = g[(g.route == rt) & (g.dir == dr)]; rk = rn(rt); stats["top5"] += 1
            hour_sum = gp.groupby("hour").echo_s.sum().div(4)
            hourly = [dict(hour=int(h), share_pct=round(float(x / hr_tot[h] * 100), 1)) for h, x in hour_sum.items() if h in HOURS and hr_tot.get(h, 0) > 0]
            for h, x in hour_sum.items():
                if h in HOURS and hr_tot.get(h, 0) > 0: top5_hourly[int(h)] += float(x)
            sub = TK[(TK.sn.isin(own)) & (TK.route == rt) & (TK.dir == dr)]
            _, ksrc = match_keys(rk); stats["key_exact" if ksrc == "exact" else "key_base" if ksrc == "base_route" else "key_none"] += 1
            # route end: most common ticket trip-destination, candidates re-geocoded against each line
            re_name, end_cands = None, []
            if len(sub):
                tn = sub.dropna(subset=["tn"]).groupby("tn").pax.sum().sort_values(ascending=False)
                if len(tn): re_name = label(tn.index[0]); end_cands = [pm(*p) for p in cand_points(tn.index[0])]
            if re_name is None:
                te = gp.trip_dest.dropna().mode(); re_name = str(te.iloc[0]).title() if len(te) else None
            refs = [pm(*p) for p in [geo(x) for x in sub[~sub.dn.isin(own)].groupby("dn").pax.sum().sort_values(ascending=False).index[:3]] if p]
            # busiest stop first; fall back to one that sits on the route line
            order = list(gp.groupby("stop_name").echo_s.sum().sort_values(ascending=False).index[:12])
            bst = order[0]; gb = gp[gp.stop_name == bst].iloc[0]; shp = None; source = "none"
            for bn_ in order:
                gb2 = gp[gp.stop_name == bn_].iloc[0]
                r_, source = make_path(rk, pm(float(gb2.stop_lat), float(gb2.stop_lon)), end_cands, refs)
                if r_ is not None: shp, bst, gb = r_, bn_, gb2; break
            full = bi = ahead = None; quality = None; ahead_m = None
            re_ = dict(name=re_name, lat=None, lon=None)
            if shp is not None:
                full, bi, ahead = shp["full"], shp["bi"], shp["ahead"]; stats["path_ok"] += 1; stats["path_" + source] = stats.get("path_" + source, 0) + 1
                ahead_m = transform(to_m, LineString(ahead))
                quality = "full" if (shp["end_verified"] or shp["loop"]) else "partial"
                if shp["loop"]: stats["loops"] += 1
                stats["full" if quality == "full" else "partial"] += 1
                # route-end position: validated geocode if the path reaches it, else the path's own end
                ex, ey = ahead[-1]; re_["lat"], re_["lon"] = round(ey, 6), round(ex, 6)
            else:
                gg = geo(tn.index[0]) if len(sub) and len(tn) else None
                if gg: re_["lat"], re_["lon"] = round(gg[0], 6), round(gg[1], 6)
            chk = make_checker(ahead_m); ctx[(rt, dr)] = chk
            do = dropoffs(sub, own, chk)
            bpt = pm(float(gb.stop_lat), float(gb.stop_lon))
            res["routes"].append(dict(
                route=str(rt), dir=str(dr), board_stop=label(bst), board_stop_raw=str(bst), board_lat=round(float(gb.stop_lat), 6), board_lon=round(float(gb.stop_lon), 6),
                share_pct=round(float(t / tot * 100), 1), transfers_per_day=round(float(t), 1),
                avg_wait_min=round(float((gp.echo_s * gp.wait_arr.fillna(0)).sum() / gp.echo_s.sum()), 1),
                hourly=hourly, route_end=re_, is_loop=bool(shp and shp["loop"]), dropoffs=do,
                shape_source=source if shp is not None else "none",
                shape_quality=quality, has_shape=shp is not None, end_verified=bool(shp and shp["end_verified"]),
                full_path=full, board_index=bi, ahead_path=ahead, path=ahead))
            if shp is not None:
                stats["dropoffs_kept"] += len(do["all_day"])
        rest = pr.iloc[5:]
        oh = [dict(hour=h, share_pct=round(max(0.0, 100 - top5_hourly.get(h, 0.0) / hr_tot[h] * 100), 1)) for h in HOURS if hr_tot.get(h, 0) > 0]
        res["others"] = dict(share_pct=round(float(rest.sum() / tot * 100), 1), route_count=int(len(rest)), hourly=oh)

        # ---- most likely per hour: rank route+direction+board stop by that hour's share of all bus-takers
        grp = g.assign(w=g.echo_s * g.wait_arr.fillna(0)).groupby(["route", "dir", "stop_name", "hour"]).agg(x=("echo_s", "sum"), w=("w", "sum"), lat=("stop_lat", "first"), lon=("stop_lon", "first")).reset_index()
        grp["x"] /= 4; grp["w"] /= 4
        dgrp = g.assign(w=g.echo_s * g.wait_arr.fillna(0)).groupby(["route", "dir", "stop_name"]).agg(x=("echo_s", "sum"), w=("w", "sum"), lat=("stop_lat", "first"), lon=("stop_lon", "first")).reset_index()
        dgrp["x"] /= 4; dgrp["w"] /= 4
        exits = {h["hour"]: h.get("exits", 0) for h in hs.get("hourly", [])}

        def entry(r, denom, hour):
            rt, dr = r.route, r.dir
            sub = TK[(TK.sn.isin(own)) & (TK.route == rt) & (TK.dir == dr)]
            chk = ctx.get((rt, dr)) or make_checker(None)
            lst, _ = dropoff_series(sub[sub.hour == hour] if hour is not None else sub, own, chk, 0, 24, maxn=1, minpct=0.0)
            if not lst and hour is not None: lst, _ = dropoff_series(sub, own, chk, 0, 24, maxn=1, minpct=0.0)
            ex = exits.get(hour) if hour is not None else None
            return dict(route=str(rt), dir=str(dr), board_stop=label(r.stop_name), board_stop_raw=str(r.stop_name), board_lat=round(float(r.lat), 6), board_lon=round(float(r.lon), 6),
                        share_pct_of_bus_takers=round(float(r.x / denom * 100), 1) if denom > 0 else 0.0,
                        share_pct_of_exits=round(float(r.x / ex * 100), 1) if ex else None,
                        avg_wait_min=round(float(r.w / r.x), 1) if r.x > 0 else None,
                        top_dropoff_name=lst[0]["name"] if lst else None, top_dropoff_pct=lst[0]["pct"] if lst else None)

        # raw stop_name is kept for the treatment-stop check, label() is for display
        daily_top = dgrp.sort_values("x", ascending=False).head(3)
        for h in HOURS:
            hh = grp[grp.hour == h].sort_values("x", ascending=False).head(3); fb = hh.empty or hr_tot.get(h, 0) <= 0
            rows = daily_top if fb else hh; denom = float(tot) if fb else float(hr_tot[h])
            ents = [entry(r, denom, None if fb else h) for r in rows.itertuples()]
            if not ents: continue
            top = ents[0]; top["runners_up"] = ents[1:]; top["fallback"] = bool(fb)
            res["most_likely"][str(h)] = top
    json.dump(res, open(RF / f"{sid}.json", "w")); index.append(sid)
json.dump({"stations": index}, open(RF / "index.json", "w"))
n = max(1, stats["top5"])
stats["rate_exact_key_only"] = round(stats["key_exact"] / n, 3); stats["rate_with_base_fallback"] = round((stats["key_exact"] + stats["key_base"]) / n, 3)
stats["rate_usable_path"] = round(stats["path_ok"] / n, 3); stats["rate_before_rewrite"] = 0.53
json.dump(stats, open(OUT / "debug" / "route_match_stats.json", "w"), indent=1)
print(len(index), "station files", stats)
