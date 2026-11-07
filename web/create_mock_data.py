import json
import math
import random
import os
import geopandas as gpd

random.seed(42)

OUT_DIR = "web/public/mock"
STATION_DIR = os.path.join(OUT_DIR, "station")
os.makedirs(STATION_DIR, exist_ok=True)

# 1. Metro stations list
# Airport, Meenambakkam, Alandur, Guindy, Saidapet, Teynampet, Thousand Lights, LIC, Government Estate, Central, Egmore, Kilpauk, Anna Nagar Tower, Koyambedu, Vadapalani, Ashok Nagar, Thirumangalam, Washermanpet
STATIONS_RAW = [
    {"id": "airport", "name": "AIRPORT", "line": "Blue", "lat": 12.9806, "lon": 80.1638, "exits": 14200, "transfers": 4600, "wait": 6.8},
    {"id": "meenambakkam", "name": "MEENAMBAKKAM", "line": "Blue", "lat": 12.9881, "lon": 80.1772, "exits": 6800, "transfers": 1700, "wait": 8.4},
    {"id": "alandur", "name": "ALANDUR", "line": "Both", "lat": 13.0039, "lon": 80.2014, "exits": 21500, "transfers": 7800, "wait": 7.2},
    {"id": "guindy", "name": "GUINDY", "line": "Blue", "lat": 13.0094, "lon": 80.2133, "exits": 26400, "transfers": 10200, "wait": 11.4},
    {"id": "saidapet", "name": "SAIDAPET", "line": "Blue", "lat": 13.0242, "lon": 80.2227, "exits": 15800, "transfers": 5200, "wait": 9.1},
    {"id": "teynampet", "name": "TEYNAMPET", "line": "Blue", "lat": 13.0407, "lon": 80.2458, "exits": 11200, "transfers": 3100, "wait": 6.2},
    {"id": "thousand-lights", "name": "THOUSAND LIGHTS", "line": "Blue", "lat": 13.0583, "lon": 80.2547, "exits": 16400, "transfers": 4900, "wait": 8.5},
    {"id": "lic", "name": "LIC", "line": "Blue", "lat": 13.0667, "lon": 80.2642, "exits": 12800, "transfers": 3800, "wait": 5.8},
    {"id": "government-estate", "name": "GOVERNMENT ESTATE", "line": "Blue", "lat": 13.0706, "lon": 80.2736, "exits": 9400, "transfers": 2400, "wait": 4.8},
    {"id": "central", "name": "CENTRAL", "line": "Both", "lat": 13.0827, "lon": 80.2764, "exits": 34500, "transfers": 12800, "wait": 12.8},
    {"id": "egmore", "name": "EGMORE", "line": "Green", "lat": 13.0792, "lon": 80.2611, "exits": 18200, "transfers": 6100, "wait": 7.9},
    {"id": "kilpauk", "name": "KILPAUK", "line": "Green", "lat": 13.0783, "lon": 80.2439, "exits": 10500, "transfers": 2900, "wait": 6.5},
    {"id": "anna-nagar-tower", "name": "ANNA NAGAR TOWER", "line": "Green", "lat": 13.0853, "lon": 80.2133, "exits": 13400, "transfers": 3900, "wait": 7.4},
    {"id": "thirumangalam", "name": "THIRUMANGALAM", "line": "Green", "lat": 13.0850, "lon": 80.1939, "exits": 19800, "transfers": 7200, "wait": 10.6},
    {"id": "koyambedu", "name": "KOYAMBEDU", "line": "Green", "lat": 13.0733, "lon": 80.1956, "exits": 28900, "transfers": 11500, "wait": 13.5},
    {"id": "vadapalani", "name": "VADAPALANI", "line": "Green", "lat": 13.0514, "lon": 80.2128, "exits": 23100, "transfers": 8600, "wait": 10.2},
    {"id": "ashok-nagar", "name": "ASHOK NAGAR", "line": "Green", "lat": 13.0361, "lon": 80.2114, "exits": 12100, "transfers": 3400, "wait": 6.1},
    {"id": "washermanpet", "name": "WASHERMANPET", "line": "Blue", "lat": 13.1097, "lon": 80.2844, "exits": 14900, "transfers": 4800, "wait": 8.1}
]

# Extract GeoJSON lines from Operational_Metro.shp
shp_path = r'E:\CUMTA HACKATHON\Theme 3\Public Transport\Metro Rail\Operational_Metro.shp'
gdf = gpd.read_file(shp_path)
line_features = []
for idx, row in gdf.iterrows():
    corr = str(row.get('Corridors', ''))
    color = '#2F6BFF' if 'Blue' in corr else ('#2BA84A' if 'Green' in corr else '#3B6FE0')
    line_name = 'Blue' if 'Blue' in corr else ('Green' if 'Green' in corr else 'Metro')
    geom = json.loads(gpd.GeoSeries([row.geometry]).to_json())['features'][0]['geometry']
    line_features.append({
        'type': 'Feature',
        'properties': {
            'id': str(row.get('id', idx)),
            'name': corr,
            'color': color,
            'line': line_name
        },
        'geometry': geom
    })

stations_json = {
    "stations": [
        {"id": s["id"], "name": s["name"], "line": s["line"], "lat": s["lat"], "lon": s["lon"]}
        for s in STATIONS_RAW
    ],
    "lines": {
        "type": "FeatureCollection",
        "features": line_features
    }
}
with open(f"{OUT_DIR}/stations.json", "w") as f:
    json.dump(stations_json, f, indent=2)

# 2. hotspots.json
# Tertile cuts for level: high, medium, low
# Wait cuts: bad > 10, ok 5-10, good < 5
hotspot_stations = []
total_transfers = 0
top_station_id = "central"
max_transfers = 0
worst_wait_id = "koyambedu"
max_wait = 0

# Hours 5 to 23
HOURS = list(range(5, 24))

for s in STATIONS_RAW:
    total_transfers += s["transfers"]
    if s["transfers"] > max_transfers:
        max_transfers = s["transfers"]
        top_station_id = s["id"]
    if s["wait"] > max_wait:
        max_wait = s["wait"]
        worst_wait_id = s["id"]

    transfer_pct = round((s["transfers"] / s["exits"]) * 100, 1)
    # determine level by transfer counts
    if s["transfers"] >= 7500:
        level = "high"
    elif s["transfers"] >= 4000:
        level = "medium"
    else:
        level = "low"

    if s["wait"] > 10.0:
        wait_level = "bad"
    elif s["wait"] >= 5.0:
        wait_level = "ok"
    else:
        wait_level = "good"

    # Hourly distribution: morning peak at 8-9, evening peak at 17-18
    hourly = []
    for h in HOURS:
        if 8 <= h <= 9:
            mult = 2.4
        elif 17 <= h <= 19:
            mult = 2.1
        elif 10 <= h <= 16:
            mult = 1.0
        elif 7 <= h < 8 or 20 <= h <= 21:
            mult = 1.3
        else:
            mult = 0.4
        
        base_h_exits = s["exits"] / 19.0
        h_exits = int(base_h_exits * mult)
        h_transfers = int(h_exits * (transfer_pct / 100.0) * (1.1 if (8 <= h <= 9 or 17 <= h <= 19) else 0.95))
        # wait is higher in peak hours
        h_wait = round(s["wait"] * (1.2 if (8 <= h <= 9 or 17 <= h <= 19) else 0.85), 1)
        hourly.append({
            "hour": h,
            "exits": h_exits,
            "transfers": h_transfers,
            "avg_wait_min": h_wait
        })

    hotspot_stations.append({
        "id": s["id"],
        "exits_per_day": s["exits"],
        "transfers_per_day": s["transfers"],
        "transfer_pct": transfer_pct,
        "avg_wait_min": s["wait"],
        "level": level,
        "wait_level": wait_level,
        "hourly": hourly
    })

hotspots_json = {
    "window": "2026-03-03..2026-03-06",
    "stations": hotspot_stations,
    "totals": {
        "transfers_per_day": total_transfers,
        "top_station": top_station_id,
        "worst_wait_station": worst_wait_id
    }
}
with open(f"{OUT_DIR}/hotspots.json", "w") as f:
    json.dump(hotspots_json, f, indent=2)

# 3. flows.json & station/<id>.json
# Station stops dictionary
STATION_STOPS_MAP = {
    "guindy": [
        {"id": "guindy-estate", "name": "GUINDY ESTATE", "dlat": 0.0022, "dlon": -0.0018, "walk": 260, "share": 16.5, "routes": [
            {"route": "21G", "share": 8.5, "wait": 11.4, "headway": 15, "cap": 60, "board": 58},
            {"route": "19B", "share": 4.8, "wait": 8.2, "headway": 12, "cap": 60, "board": 45},
            {"route": "54", "share": 3.2, "wait": 7.5, "headway": 10, "cap": 60, "board": 40}
        ]},
        {"id": "guindy-rs", "name": "GUINDY R.S.", "dlat": -0.0019, "dlon": 0.0012, "walk": 210, "share": 14.2, "routes": [
            {"route": "70", "share": 7.4, "wait": 12.0, "headway": 14, "cap": 60, "board": 55},
            {"route": "88K", "share": 6.8, "wait": 10.5, "headway": 12, "cap": 60, "board": 48}
        ]},
        {"id": "race-course", "name": "GUINDY RACE COURSE", "dlat": 0.0031, "dlon": 0.0024, "walk": 380, "share": 7.9, "routes": [
            {"route": "154", "share": 4.5, "wait": 9.0, "headway": 15, "cap": 60, "board": 42},
            {"route": "51R", "share": 3.4, "wait": 8.5, "headway": 18, "cap": 60, "board": 38}
        ]}
    ],
    "central": [
        {"id": "central-bs", "name": "CENTRAL BUS STAND", "dlat": 0.0015, "dlon": -0.0012, "walk": 180, "share": 15.8, "routes": [
            {"route": "11G", "share": 7.2, "wait": 13.5, "headway": 12, "cap": 60, "board": 59},
            {"route": "17D", "share": 5.1, "wait": 12.0, "headway": 15, "cap": 60, "board": 54},
            {"route": "28", "share": 3.5, "wait": 11.0, "headway": 10, "cap": 60, "board": 48}
        ]},
        {"id": "gh-corner", "name": "GOVT HOSPITAL / PARK", "dlat": -0.0022, "dlon": 0.0010, "walk": 250, "share": 12.4, "routes": [
            {"route": "1A", "share": 6.8, "wait": 14.0, "headway": 16, "cap": 60, "board": 62},
            {"route": "2A", "share": 5.6, "wait": 11.2, "headway": 14, "cap": 60, "board": 50}
        ]},
        {"id": "ripon-bldg", "name": "RIPON BUILDING", "dlat": -0.0008, "dlon": -0.0025, "walk": 290, "share": 8.9, "routes": [
            {"route": "159A", "share": 5.0, "wait": 10.5, "headway": 15, "cap": 60, "board": 46},
            {"route": "60", "share": 3.9, "wait": 9.8, "headway": 18, "cap": 60, "board": 41}
        ]}
    ],
    "koyambedu": [
        {"id": "cmbt-mfs", "name": "CMBT MAFATLAL / MTC TERM", "dlat": 0.0018, "dlon": -0.0015, "walk": 220, "share": 17.5, "routes": [
            {"route": "70A", "share": 8.5, "wait": 14.5, "headway": 14, "cap": 60, "board": 65},
            {"route": "27B", "share": 5.2, "wait": 12.8, "headway": 12, "cap": 60, "board": 58},
            {"route": "101", "share": 3.8, "wait": 11.2, "headway": 15, "cap": 60, "board": 52}
        ]},
        {"id": "koyambedu-market", "name": "KOYAMBEDU WHOLESALE MKT", "dlat": 0.0028, "dlon": 0.0021, "walk": 360, "share": 13.8, "routes": [
            {"route": "15F", "share": 7.4, "wait": 13.0, "headway": 15, "cap": 60, "board": 55},
            {"route": "16J", "share": 6.4, "wait": 12.2, "headway": 16, "cap": 60, "board": 50}
        ]},
        {"id": "rohinic-theatre", "name": "ROHINI COMPLEX", "dlat": -0.0022, "dlon": 0.0018, "walk": 270, "share": 8.5, "routes": [
            {"route": "46", "share": 4.8, "wait": 11.5, "headway": 20, "cap": 60, "board": 47},
            {"route": "591", "share": 3.7, "wait": 10.0, "headway": 18, "cap": 60, "board": 40}
        ]}
    ],
    "vadapalani": [
        {"id": "vadapalani-bs", "name": "VADAPALANI BUS STAND", "dlat": -0.0016, "dlon": -0.0019, "walk": 220, "share": 16.4, "routes": [
            {"route": "17M", "share": 8.2, "wait": 11.5, "headway": 12, "cap": 60, "board": 56},
            {"route": "25G", "share": 5.1, "wait": 9.8, "headway": 14, "cap": 60, "board": 49},
            {"route": "5E", "share": 3.1, "wait": 8.4, "headway": 15, "cap": 60, "board": 42}
        ]},
        {"id": "sims-hospital", "name": "SIMS HOSPITAL / 100FT RD", "dlat": 0.0021, "dlon": 0.0012, "walk": 240, "share": 12.8, "routes": [
            {"route": "70V", "share": 7.2, "wait": 10.8, "headway": 15, "cap": 60, "board": 52},
            {"route": "570", "share": 5.6, "wait": 9.2, "headway": 15, "cap": 60, "board": 46}
        ]},
        {"id": "forum-mall", "name": "FORUM VIJAYA MALL", "dlat": -0.0009, "dlon": 0.0024, "walk": 310, "share": 8.0, "routes": [
            {"route": "12BET", "share": 4.5, "wait": 8.8, "headway": 16, "cap": 60, "board": 41},
            {"route": "88", "share": 3.5, "wait": 8.0, "headway": 20, "cap": 60, "board": 38}
        ]}
    ],
    "alandur": [
        {"id": "alandur-jn", "name": "ASARKHANA / ALANDUR JN", "dlat": 0.0019, "dlon": -0.0014, "walk": 210, "share": 18.2, "routes": [
            {"route": "52", "share": 9.8, "wait": 7.8, "headway": 10, "cap": 60, "board": 52},
            {"route": "70W", "share": 5.4, "wait": 7.0, "headway": 12, "cap": 60, "board": 46},
            {"route": "154A", "share": 3.0, "wait": 6.5, "headway": 15, "cap": 60, "board": 39}
        ]},
        {"id": "st-thomas-mount", "name": "ST. THOMAS MOUNT JN", "dlat": -0.0024, "dlon": 0.0019, "walk": 320, "share": 11.5, "routes": [
            {"route": "18A", "share": 6.8, "wait": 7.5, "headway": 12, "cap": 60, "board": 48},
            {"route": "54V", "share": 4.7, "wait": 6.8, "headway": 15, "cap": 60, "board": 41}
        ]},
        {"id": "kathipara-loop", "name": "KATHIPARA BUS STOP", "dlat": -0.0012, "dlon": -0.0022, "walk": 280, "share": 6.6, "routes": [
            {"route": "119", "share": 4.2, "wait": 7.2, "headway": 14, "cap": 60, "board": 40},
            {"route": "21H", "share": 2.4, "wait": 6.0, "headway": 20, "cap": 60, "board": 32}
        ]}
    ],
    "airport": [
        {"id": "airport-meenam", "name": "AIRPORT PASSENGER GATE", "dlat": 0.0014, "dlon": 0.0012, "walk": 160, "share": 18.5, "routes": [
            {"route": "18D", "share": 9.5, "wait": 7.0, "headway": 12, "cap": 60, "board": 48},
            {"route": "B18", "share": 5.8, "wait": 6.8, "headway": 15, "cap": 60, "board": 40},
            {"route": "70K", "share": 3.2, "wait": 6.2, "headway": 16, "cap": 60, "board": 36}
        ]},
        {"id": "tirusulam-rs", "name": "TIRUSULAM SUBWAY", "dlat": -0.0018, "dlon": 0.0015, "walk": 240, "share": 13.9, "routes": [
            {"route": "G18", "share": 8.1, "wait": 7.2, "headway": 14, "cap": 60, "board": 44},
            {"route": "66", "share": 5.8, "wait": 6.4, "headway": 18, "cap": 60, "board": 38}
        ]}
    ]
}

# Generic generator for stations not in STATION_STOPS_MAP
for s in STATIONS_RAW:
    if s["id"] not in STATION_STOPS_MAP:
        tot_share = round((s["transfers"] / s["exits"]) * 100, 1)
        s1 = round(tot_share * 0.48, 1)
        s2 = round(tot_share * 0.34, 1)
        s3 = round(tot_share - s1 - s2, 1)
        routes_base = [f"M{random.randint(10, 99)}", f"{random.randint(11, 79)}B", f"{random.randint(21, 88)}"]
        STATION_STOPS_MAP[s["id"]] = [
            {
                "id": f"{s['id']}-main",
                "name": f"{s['name']} MAIN ROAD",
                "dlat": 0.0015, "dlon": -0.0012, "walk": 190,
                "share": s1,
                "routes": [
                    {"route": routes_base[0], "share": round(s1 * 0.62, 1), "wait": s["wait"], "headway": 12, "cap": 60, "board": 45},
                    {"route": routes_base[1], "share": round(s1 * 0.38, 1), "wait": round(s["wait"] * 0.9, 1), "headway": 15, "cap": 60, "board": 38}
                ]
            },
            {
                "id": f"{s['id']}-jn",
                "name": f"{s['name']} JUNCTION",
                "dlat": -0.0018, "dlon": 0.0016, "walk": 270,
                "share": s2,
                "routes": [
                    {"route": routes_base[2], "share": round(s2, 1), "wait": round(s["wait"] * 1.05, 1), "headway": 14, "cap": 60, "board": 40}
                ]
            }
        ]
        if s3 > 1.5:
            STATION_STOPS_MAP[s["id"]].append({
                "id": f"{s['id']}-cross",
                "name": f"{s['name']} CROSS ROAD",
                "dlat": 0.0022, "dlon": 0.0019, "walk": 340,
                "share": s3,
                "routes": [
                    {"route": f"{random.randint(40, 99)}E", "share": s3, "wait": round(s["wait"] * 0.95, 1), "headway": 18, "cap": 60, "board": 35}
                ]
            })

all_flows = []
for s in STATIONS_RAW:
    stops_info = STATION_STOPS_MAP[s["id"]]
    sum_bus_share = 0.0
    for stop in stops_info:
        sum_bus_share += stop["share"]
        stop_transfers = int(s["exits"] * (stop["share"] / 100.0))
        # routes
        routes_data = []
        for r in stop["routes"]:
            r_transfers = int(s["exits"] * (r["share"] / 100.0))
            routes_data.append({
                "route": r["route"],
                "transfers_per_day": r_transfers,
                "share_pct": r["share"],
                "avg_wait_min": r["wait"],
                "headway_min": r["headway"]
            })
        
        # hourly for stop
        hourly_stop = []
        for h in HOURS:
            peak_factor = 1.15 if (8 <= h <= 9 or 17 <= h <= 19) else 0.92
            h_share = round(stop["share"] * peak_factor, 1)
            h_trans = int(s["exits"] / 19.0 * (h_share / 100.0))
            hourly_stop.append({
                "hour": h,
                "transfers": h_trans,
                "share_pct": h_share
            })

        all_flows.append({
            "station_id": s["id"],
            "stop_id": stop["id"],
            "stop_name": stop["name"],
            "stop_lat": round(s["lat"] + stop["dlat"], 6),
            "stop_lon": round(s["lon"] + stop["dlon"], 6),
            "walk_m": stop["walk"],
            "direction": "metro_to_bus",
            "transfers_per_day": stop_transfers,
            "share_pct": stop["share"],
            "routes": routes_data,
            "hourly": hourly_stop
        })

    # Remainder "other"
    other_share = round(max(0.0, 100.0 - sum_bus_share), 1)
    other_hourly = []
    for h in HOURS:
        other_hourly.append({
            "hour": h,
            "transfers": 0,
            "share_pct": other_share
        })
    all_flows.append({
        "station_id": s["id"],
        "stop_id": "other",
        "stop_name": "Walk / auto / not a nearby bus",
        "stop_lat": s["lat"],
        "stop_lon": s["lon"],
        "walk_m": 0,
        "direction": "metro_to_bus",
        "transfers_per_day": 0,
        "share_pct": other_share,
        "routes": [],
        "hourly": other_hourly
    })

flows_json = {"flows": all_flows}
with open(f"{OUT_DIR}/flows.json", "w") as f:
    json.dump(flows_json, f, indent=2)

# 4. station/<id>.json files
for s in STATIONS_RAW:
    stops = STATION_STOPS_MAP[s["id"]]
    station_routes = []
    top_route = "21G"
    max_r_share = 0
    for stp in stops:
        for r in stp["routes"]:
            if r["share"] > max_r_share:
                max_r_share = r["share"]
                top_route = r["route"]
            station_routes.append({
                "route": r["route"],
                "stop_id": stp["id"],
                "transfers_per_day": int(s["exits"] * (r["share"] / 100.0)),
                "share_pct": r["share"],
                "avg_wait_min": r["wait"],
                "headway_min_peak": r["headway"],
                "boardings_per_trip_peak": r["board"],
                "capacity": r["cap"]
            })

    # 5-min exit pulses 07:45 - 09:15
    exits_5min = []
    bus_arrivals = []
    for m in range(0, 120, 5):
        h = 7 + (45 + m) // 60
        mins = (45 + m) % 60
        t_str = f"{h:02d}:{mins:02d}"
        # pulses every 10 min
        is_train = (m % 10 == 0)
        v = random.randint(180, 290) if is_train else random.randint(10, 35)
        exits_5min.append({"t": t_str, "v": v})

        # Bus arrival ~3-7 mins after train
        if is_train:
            arr_m = mins + 4
            arr_h = h
            if arr_m >= 60:
                arr_h += 1
                arr_m -= 60
            b_str = f"{arr_h:02d}:{arr_m:02d}"
            target_stop = stops[0]
            target_route = target_stop["routes"][0]["route"]
            boardings = random.randint(42, 60)
            echo = int(boardings * 0.72)
            bus_arrivals.append({
                "t": b_str,
                "stop_id": target_stop["id"],
                "route": target_route,
                "boardings": boardings,
                "echo": echo
            })

    regular_cards = int(s["exits"] * 0.012)
    dest_hints = {
        "guindy": "Tidel Park / OMR IT Corridor",
        "central": "Parrys Corner / Harbour Commercial Zone",
        "koyambedu": "Ambattur Industrial Estate / CMBT Wholesale",
        "vadapalani": "Porur IT Park / DLF SEZ",
        "alandur": "DLF Cybercity / Mount-Poonamallee",
        "airport": "Pallavaram GST Road / MEPZ",
        "thirumangalam": "Mogappair East / Ambattur",
        "saidapet": "Little Mount / Kotturpuram Institutions",
        "thousand-lights": "Greams Road Apollo / Nungambakkam High Rd",
        "egmore": "Poonamallee High Rd / Kilpauk Medical"
    }
    hint = dest_hints.get(s["id"], "Siruseri / SIPCOT IT corridor")

    station_file = {
        "id": s["id"],
        "pulse_echo": {
            "date": "2026-03-04",
            "exits_5min": exits_5min,
            "bus_arrivals": bus_arrivals
        },
        "routes": station_routes,
        "regulars": [
            {
                "window": "08:15-08:30",
                "regular_cards": regular_cards,
                "top_route": top_route,
                "likely_purpose": "work/education",
                "destination_hint": hint
            }
        ],
        "method": "quick_estimate",
        "validation": None
    }
    with open(f"{STATION_DIR}/{s['id']}.json", "w") as f:
        json.dump(station_file, f, indent=2)

# 5. recommendations.json
recommendations_items = [
    {
        "id": "r1",
        "station_id": "guindy",
        "route": "21G",
        "hours": "07:45-09:15",
        "type": "add_buses",
        "action": "Add 2 buses on 21G from Guindy, 07:45–09:15",
        "evidence": { "transfers": 1280, "avg_wait_min": 11.4, "headway_min": 15, "boardings_per_trip": 58, "capacity": 60 },
        "extra_buses": 2,
        "shift_min": 0,
        "before_after": { "wait_before": 11.4, "wait_after": 5.2 },
        "passenger_minutes_saved_per_day": 7936,
        "rank": 1
    },
    {
        "id": "r2",
        "station_id": "koyambedu",
        "route": "70A",
        "hours": "08:00-09:30",
        "type": "bigger_bus",
        "action": "Deploy vestibuled/articulated buses on 70A at Koyambedu",
        "evidence": { "transfers": 1420, "avg_wait_min": 14.5, "headway_min": 14, "boardings_per_trip": 65, "capacity": 60 },
        "extra_buses": 0,
        "shift_min": 0,
        "before_after": { "wait_before": 14.5, "wait_after": 7.8 },
        "passenger_minutes_saved_per_day": 9514,
        "rank": 2
    },
    {
        "id": "r3",
        "station_id": "central",
        "route": "11G",
        "hours": "07:30-09:00",
        "type": "retime",
        "action": "Shift route 11G departure by -2 min to match train pulse arrival",
        "evidence": { "transfers": 1150, "avg_wait_min": 13.5, "headway_min": 12, "boardings_per_trip": 59, "capacity": 60 },
        "extra_buses": 0,
        "shift_min": -2,
        "before_after": { "wait_before": 13.5, "wait_after": 6.1 },
        "passenger_minutes_saved_per_day": 8510,
        "rank": 3
    },
    {
        "id": "r4",
        "station_id": "vadapalani",
        "route": "17M",
        "hours": "08:15-09:45",
        "type": "add_buses",
        "action": "Add 2 short-loop shuttles on 17M towards Porur DLF",
        "evidence": { "transfers": 980, "avg_wait_min": 11.5, "headway_min": 12, "boardings_per_trip": 56, "capacity": 60 },
        "extra_buses": 2,
        "shift_min": 0,
        "before_after": { "wait_before": 11.5, "wait_after": 5.8 },
        "passenger_minutes_saved_per_day": 5586,
        "rank": 4
    },
    {
        "id": "r5",
        "station_id": "thirumangalam",
        "route": "M70",
        "hours": "08:00-09:30",
        "type": "new_feeder",
        "action": "Introduce Mini-Bus Feeder F-70 connecting Thirumangalam Metro to Ambattur OT",
        "evidence": { "transfers": 870, "avg_wait_min": 10.6, "headway_min": 18, "boardings_per_trip": 48, "capacity": 60 },
        "extra_buses": 3,
        "shift_min": 0,
        "before_after": { "wait_before": 10.6, "wait_after": 4.5 },
        "passenger_minutes_saved_per_day": 5307,
        "rank": 5
    },
    {
        "id": "r6",
        "station_id": "alandur",
        "route": "52",
        "hours": "17:30-19:00",
        "type": "retime",
        "action": "Nudge evening 52 departures by +3 min to catch Guindy/Alandur Green line pulse",
        "evidence": { "transfers": 810, "avg_wait_min": 7.8, "headway_min": 10, "boardings_per_trip": 52, "capacity": 60 },
        "extra_buses": 0,
        "shift_min": 3,
        "before_after": { "wait_before": 7.8, "wait_after": 3.9 },
        "passenger_minutes_saved_per_day": 3159,
        "rank": 6
    },
    {
        "id": "r7",
        "station_id": "saidapet",
        "route": "29C",
        "hours": "08:15-09:30",
        "type": "add_buses",
        "action": "Add 1 bus on 29C towards Besant Nagar / Adyar during morning peak",
        "evidence": { "transfers": 640, "avg_wait_min": 9.1, "headway_min": 15, "boardings_per_trip": 53, "capacity": 60 },
        "extra_buses": 1,
        "shift_min": 0,
        "before_after": { "wait_before": 9.1, "wait_after": 4.6 },
        "passenger_minutes_saved_per_day": 2880,
        "rank": 7
    },
    {
        "id": "r8",
        "station_id": "egmore",
        "route": "27B",
        "hours": "07:45-09:00",
        "type": "retime",
        "action": "Retime 27B departures -2 min at Egmore North exit for Anna Salai transfers",
        "evidence": { "transfers": 590, "avg_wait_min": 7.9, "headway_min": 14, "boardings_per_trip": 49, "capacity": 60 },
        "extra_buses": 0,
        "shift_min": -2,
        "before_after": { "wait_before": 7.9, "wait_after": 4.1 },
        "passenger_minutes_saved_per_day": 2242,
        "rank": 8
    }
]

total_saved = sum(item["passenger_minutes_saved_per_day"] for item in recommendations_items)
total_extra_buses = sum(item["extra_buses"] for item in recommendations_items)
routes_affected = len(set(item["route"] for item in recommendations_items))

recommendations_json = {
    "summary": {
        "extra_buses_total": total_extra_buses,
        "routes_affected": routes_affected,
        "passenger_minutes_saved_per_day": total_saved
    },
    "items": recommendations_items
}
with open(f"{OUT_DIR}/recommendations.json", "w") as f:
    json.dump(recommendations_json, f, indent=2)

# 6. regulars.json: city-wide routine flows
regulars_flows = [
    {
        "station_id": "guindy",
        "window": "08:15-08:30",
        "regular_cards": 142,
        "top_route": "21G",
        "dest_name": "Tidel Park / OMR",
        "dest_lat": 12.9892,
        "dest_lon": 80.2486,
        "likely_purpose": "work/education"
    },
    {
        "station_id": "central",
        "window": "08:00-08:15",
        "regular_cards": 210,
        "top_route": "11G",
        "dest_name": "Parrys / High Court",
        "dest_lat": 13.0886,
        "dest_lon": 80.2882,
        "likely_purpose": "work/education"
    },
    {
        "station_id": "koyambedu",
        "window": "07:45-08:00",
        "regular_cards": 185,
        "top_route": "70A",
        "dest_name": "Ambattur Industrial Estate",
        "dest_lat": 13.1042,
        "dest_lon": 80.1558,
        "likely_purpose": "work/education"
    },
    {
        "station_id": "vadapalani",
        "window": "08:30-08:45",
        "regular_cards": 128,
        "top_route": "17M",
        "dest_name": "DLF Cybercity Porur",
        "dest_lat": 13.0315,
        "dest_lon": 80.1652,
        "likely_purpose": "work/education"
    },
    {
        "station_id": "alandur",
        "window": "08:15-08:30",
        "regular_cards": 115,
        "top_route": "52",
        "dest_name": "Olympia Tech Park / Ekkattuthangal",
        "dest_lat": 13.0189,
        "dest_lon": 80.2052,
        "likely_purpose": "work/education"
    },
    {
        "station_id": "airport",
        "window": "08:45-09:00",
        "regular_cards": 94,
        "top_route": "18D",
        "dest_name": "MEPZ Tambaram",
        "dest_lat": 12.9342,
        "dest_lon": 80.1294,
        "likely_purpose": "work/education"
    },
    {
        "station_id": "thirumangalam",
        "window": "08:00-08:15",
        "regular_cards": 88,
        "top_route": "M70",
        "dest_name": "Padi Lucas TVS / Industrial Corridor",
        "dest_lat": 13.1012,
        "dest_lon": 80.1834,
        "likely_purpose": "work/education"
    }
]
with open(f"{OUT_DIR}/regulars.json", "w") as f:
    json.dump({"flows": regulars_flows}, f, indent=2)

# 7. nudge.json
nudge_json = {
    "curves": [
        {
            "station_id": "guindy",
            "route": "21G",
            "hours": "07:45-09:15",
            "points": [
                { "shift_min": -5, "avg_wait_min": 12.1 },
                { "shift_min": -4, "avg_wait_min": 10.8 },
                { "shift_min": -3, "avg_wait_min": 9.2 },
                { "shift_min": -2, "avg_wait_min": 7.5 },
                { "shift_min": -1, "avg_wait_min": 5.4 },
                { "shift_min": 0, "avg_wait_min": 11.4 },
                { "shift_min": 1, "avg_wait_min": 12.6 },
                { "shift_min": 2, "avg_wait_min": 8.0 },
                { "shift_min": 3, "avg_wait_min": 6.8 },
                { "shift_min": 4, "avg_wait_min": 8.9 },
                { "shift_min": 5, "avg_wait_min": 11.2 }
            ],
            "best_shift_min": -1
        },
        {
            "station_id": "central",
            "route": "11G",
            "hours": "07:30-09:00",
            "points": [
                { "shift_min": -5, "avg_wait_min": 14.2 },
                { "shift_min": -4, "avg_wait_min": 12.5 },
                { "shift_min": -3, "avg_wait_min": 9.8 },
                { "shift_min": -2, "avg_wait_min": 6.1 },
                { "shift_min": -1, "avg_wait_min": 8.3 },
                { "shift_min": 0, "avg_wait_min": 13.5 },
                { "shift_min": 1, "avg_wait_min": 14.1 },
                { "shift_min": 2, "avg_wait_min": 10.4 },
                { "shift_min": 3, "avg_wait_min": 8.7 },
                { "shift_min": 4, "avg_wait_min": 11.0 },
                { "shift_min": 5, "avg_wait_min": 13.0 }
            ],
            "best_shift_min": -2
        },
        {
            "station_id": "alandur",
            "route": "52",
            "hours": "17:30-19:00",
            "points": [
                { "shift_min": -5, "avg_wait_min": 9.4 },
                { "shift_min": -4, "avg_wait_min": 8.8 },
                { "shift_min": -3, "avg_wait_min": 8.1 },
                { "shift_min": -2, "avg_wait_min": 7.6 },
                { "shift_min": -1, "avg_wait_min": 7.9 },
                { "shift_min": 0, "avg_wait_min": 7.8 },
                { "shift_min": 1, "avg_wait_min": 6.5 },
                { "shift_min": 2, "avg_wait_min": 5.1 },
                { "shift_min": 3, "avg_wait_min": 3.9 },
                { "shift_min": 4, "avg_wait_min": 6.2 },
                { "shift_min": 5, "avg_wait_min": 8.0 }
            ],
            "best_shift_min": 3
        },
        {
            "station_id": "egmore",
            "route": "27B",
            "hours": "07:45-09:00",
            "points": [
                { "shift_min": -5, "avg_wait_min": 9.2 },
                { "shift_min": -4, "avg_wait_min": 8.1 },
                { "shift_min": -3, "avg_wait_min": 6.5 },
                { "shift_min": -2, "avg_wait_min": 4.1 },
                { "shift_min": -1, "avg_wait_min": 5.8 },
                { "shift_min": 0, "avg_wait_min": 7.9 },
                { "shift_min": 1, "avg_wait_min": 8.4 },
                { "shift_min": 2, "avg_wait_min": 7.1 },
                { "shift_min": 3, "avg_wait_min": 6.2 },
                { "shift_min": 4, "avg_wait_min": 7.5 },
                { "shift_min": 5, "avg_wait_min": 8.8 }
            ],
            "best_shift_min": -2
        }
    ]
}
with open(f"{OUT_DIR}/nudge.json", "w") as f:
    json.dump(nudge_json, f, indent=2)

# 8. quality_report.json
quality_json = {
    "generated_at": "2026-03-07T04:00:00Z",
    "files": {
        "CMRL_Exit.csv": {
            "total_rows": 184520,
            "flagged_rows": 482,
            "reasons": {
                "missing_2_march": 0,
                "copied_7_march_flagged": 26110,
                "blank_rows": 36,
                "station_0426_invalid": 12,
                "off_hours_0000_0430": 434
            }
        },
        "CMRL_Entry.csv": {
            "total_rows": 192300,
            "flagged_rows": 390,
            "reasons": {
                "off_hours_0000_0430": 390
            }
        },
        "ETM_Ticket_Data": {
            "total_rows": 7892110,
            "flagged_rows": 184200,
            "reasons": {
                "epoch_1970_timestamp": 412,
                "after_midnight_duty_date_corrected": 89430,
                "free_women_no_destination": 94358
            }
        }
    }
}
with open(f"{OUT_DIR}/quality_report.json", "w") as f:
    json.dump(quality_json, f, indent=2)

print("Mock data generated successfully!")

