# Pulse–Echo — Fast Build Plan (Claude Code or Antigravity, interchangeable)

How to use: put this file in `E:\CUMTA HACKATHON\pulse-echo\`. Open that folder in Claude Code or Antigravity (either works for any prompt). Paste the prompts below in order. Every prompt is self-contained and starts by telling the tool to read this file.

Order:
- P1 (data + real locations) and P2 (frontend on mock data) run at the same time, in two different tools or windows.
- P3 (numbers) → P4 (connect + polish) → working demo.
- P5 (real model) and P6 (hardware) come only if there's time. They keep the same JSON files, so the frontend doesn't change.

---

## SHARED CONTEXT (every prompt must follow this)

Goal: CUMTA Hackathon PS3, "Discover the Hidden Connections". Show where Chennai Metro passengers switch to buses (and back), what % go to each nearby bus stop and route, how long they wait, and what to fix (add buses, shift bus timings, bigger buses, new feeder). Plus the "regulars": the same anonymous Metro cards at the same time every day = routine commuters, with their likely destinations.

Core idea ("Pulse–Echo"): trains release passengers in bursts (pulses). Buses arriving at nearby stops shortly after a pulse carry extra boardings above the normal local level (the echo). The echo = transfers. Bus tickets have no passenger ID, so we never join individuals across modes.

Raw data (READ-ONLY, never modify): `E:\CUMTA HACKATHON\Theme 3\`
- `CMRL_Entry.csv`, `CMRL_Exit.csv`. Columns: Record Date & Time, Line Name, Station Name, Fare Media Type, Card Token, Transaction Type, Transaction Id, Origin Station. Card Token is an anonymised hash, stable across days.
- `ETM\ETM\Ticket-Data-2026-03-DD.csv.bz2`: one file per day, bus tickets, ~2M rows/day. Columns include ticket_type, date, time, duty_date, source, destination, from_stage, to_stage, KM, direction (e.g. "48CCT - UP"), Trip_Origin, Trip_Destination, depot, fleet_no, waybill_no, schedule_no, route_service_type, payment_type, maybe trip_no and passenger_count. Check the real headers first. Use only 1–7 March files.
- `Tambaram, Avadi, GCC Bus Stops List 1.xlsx`: 3 sheets (GCC, Avadi, Tambaram) of bus stops with latitude/longitude.
- `Public Transport\Metro Rail\Operational_Metro_Stns.*` (51 points, generic names), `Operational_Metro.*` (line shapes, EPSG:4326), `Public Transport\MTC\routes_merged.*` (bus routes, route_num).

Known data problems:
- Metro Exit has no 2 March, 7 March looks copied from Entry data, 36 blank rows, and a 0426 station value. Main window = 3–6 March. Verify this.
- ETM has 01-01-1970 rows; after-midnight rows belong to the previous duty (use duty_date); free women's tickets have no destination; conductors batch-print tickets.
- Metro taps 00:00–04:30 are not revenue service.

Rules:
- Python + Polars (never load all 31 ETM days). geopandas/pyproj/rapidfuzz for geo; statsmodels for models.
- Flag bad rows, never silently delete them. Count every flag in `out/quality_report.json`.
- Never invent numbers. Everything shown comes from the data. Assumptions (bus capacity, walking speed, radii) live in `config.yaml` and are listed in the report.
- Fast: each script runs in minutes and caches to `data/interim/*.parquet`.
- Finish every prompt with a short report: what was built, key numbers, anything that looks wrong.

Folders:
```
pulse-echo/ PHASES.md config.yaml
 data/interim/ data/ref/ pipeline/ api/ web/ hardware/ out/
```

## DATA CONTRACT (backend writes these to out/; frontend reads them. Never change field names.)

`out/stations.json`: every Metro station with real coordinates
```json
{ "stations": [ { "id": "guindy", "name": "GUINDY", "line": "Blue|Green|Both", "lat": 13.0094, "lon": 80.2133 } ],
 "lines": { "type": "FeatureCollection", "features": [] } }
```

`out/hotspots.json`
```json
{ "window": "2026-03-03..2026-03-06",
 "stations": [ { "id": "guindy", "exits_per_day": 0, "transfers_per_day": 0, "transfer_pct": 0,
 "avg_wait_min": 0, "level": "high|medium|low", "wait_level": "good|ok|bad",
 "hourly": [ { "hour": 8, "exits": 0, "transfers": 0, "avg_wait_min": 0 } ] } ],
 "totals": { "transfers_per_day": 0, "top_station": "id", "worst_wait_station": "id" } }
```

`out/flows.json`: arrows from a station to each stop and route, with percentages
```json
{ "flows": [ { "station_id": "guindy", "stop_id": "guindy-estate", "stop_name": "GUINDY ESTATE",
 "stop_lat": 13.0, "stop_lon": 80.2, "walk_m": 0, "direction": "metro_to_bus",
 "transfers_per_day": 0, "share_pct": 0,
 "routes": [ { "route": "21G", "transfers_per_day": 0, "share_pct": 0, "avg_wait_min": 0, "headway_min": 0 } ],
 "hourly": [ { "hour": 8, "transfers": 0, "share_pct": 0 } ] } ] }
```

`share_pct` = % of that station's exiting Metro passengers who go to this stop (or route). For each station the backend also writes a remainder row with `stop_id: "other"`, "Walk / auto / not a nearby bus", so the shares add to 100.

`out/station/<id>.json`
```json
{ "id": "guindy",
 "pulse_echo": { "date": "2026-03-04", "exits_5min": [ { "t": "08:00", "v": 0 } ],
 "bus_arrivals": [ { "t": "08:07", "stop_id": "x", "route": "21G", "boardings": 0, "echo": 0 } ] },
 "routes": [ { "route": "21G", "stop_id": "x", "transfers_per_day": 0, "share_pct": 0, "avg_wait_min": 0,
 "headway_min_peak": 0, "boardings_per_trip_peak": 0, "capacity": 60 } ],
 "regulars": [ { "window": "08:15-08:30", "regular_cards": 0, "top_route": "21G",
 "likely_purpose": "work/education|other", "destination_hint": "text" } ],
 "method": "quick_estimate|pulse_echo_glm", "validation": null }
```

`out/recommendations.json`
```json
{ "summary": { "extra_buses_total": 0, "routes_affected": 0, "passenger_minutes_saved_per_day": 0 },
 "items": [ { "id": "r1", "station_id": "guindy", "route": "21G", "hours": "07:45-09:15",
 "type": "add_buses|retime|bigger_bus|new_feeder",
 "action": "Add 2 buses on 21G from Guindy, 07:45–09:15",
 "evidence": { "transfers": 0, "avg_wait_min": 0, "headway_min": 0, "boardings_per_trip": 0, "capacity": 60 },
 "extra_buses": 0, "shift_min": 0,
 "before_after": { "wait_before": 0, "wait_after": 0 },
 "passenger_minutes_saved_per_day": 0, "rank": 1 } ] }
```

`out/regulars.json`: city-wide routine flows for the map
```json
{ "flows": [ { "station_id": "guindy", "window": "08:15-08:30", "regular_cards": 0, "top_route": "21G",
 "dest_name": "text", "dest_lat": 13.0, "dest_lon": 80.2, "likely_purpose": "work/education" } ] }
```

`out/nudge.json`: 
```json
{ "curves": [ { "station_id": "guindy", "route": "21G", "hours": "07:45-09:15",
 "points": [ { "shift_min": -5, "avg_wait_min": 0 } ],
 "best_shift_min": 0 } ] }
```

`out/quality_report.json`: counts of flagged rows per reason per file.

---

## P1 — Data + real locations (backend)

Paste this:

```
Read PHASES.md fully, especially SHARED CONTEXT and DATA CONTRACT. Do P1 only.

1. Set up a Python venv, requirements.txt (polars pyarrow pandas geopandas shapely pyproj rapidfuzz scikit-learn statsmodels scipy openpyxl pyyaml fastapi uvicorn paho-mqtt) and config.yaml (data path, window 3–6 Mar, treatment radius 400 m, control ring 600–1500 m, walk factor 1.3, walk speed 1.2 m/s, pulse gap 60 s, max transfer window 25 min, capacity Ordinary 60 / Deluxe 60 / AC 50 / Small Bus 30, target wait 5 min, regulars min days 3, regulars min cards 15).
2. Print the real column names of CMRL Entry/Exit and one ETM day. Note whether trip_no / passenger_count exist. Count rows per date in CMRL_Exit and confirm the clean window.
3. pipeline/01_ingest.py: CMRL CSVs and ETM 1–7 March .bz2 → parquet in data/interim (needed columns only).
4. pipeline/02_clean.py: parse times, add flag columns per SHARED CONTEXT, write out/quality_report.json. Split ETM direction into route + dir.
5. pipeline/03_stations.py: build data/ref/stations.csv for every Metro station name in CMRL (id, name, line, lat, lon, source, confidence). Method: first match bus-stop Excel rows whose name contains the station name and METRO; then nearest Operational_Metro_Stns point along the correct line; then well-known public coordinates. Print the full table. Mark anything not high confidence. Export out/stations.json including the metro lines as GeoJSON from Operational_Metro.
6. pipeline/04_stops.py: normalise ETM source names (uppercase, strip punctuation, standardise R.S, B.S, BUS STAND, METRO, JN). Fuzzy-match them to Excel stops (rapidfuzz token_set_ratio >= 85). Write data/ref/stop_matches.csv. Report the match rate by ticket volume. List unmatched high-volume names within 1.5 km of a station; hand-fix the obvious ones in data/ref/stop_overrides.csv.
7. pipeline/05_catchments.py: per station, treatment stops (<=400 m) and control stops (600–1500 m), with walk metres and walk minutes. Save data/interim/catchments.parquet.
8. Report: the stations table, match rate, and the 10 busiest stations with their nearby stops. Plot out/debug/stations_map.png of stations and matched stops so I can eyeball it.
```

---

## P2 — Frontend (start now, in parallel, on mock data)

Paste this:

```
Read PHASES.md fully, especially SHARED CONTEXT and DATA CONTRACT. Do P2 only, inside web/.

Build the Pulse–Echo dashboard: React + Vite + TypeScript, deck.gl + react-map-gl, ECharts, plain CSS modules. Font: Inter.

MAP PROVIDER: use MapLibre now with a free style, no key (Carto Positron: https://basemaps.cartocdn.com/gl/positron-gl-style/style.json). Put it behind one config file web/src/mapConfig.ts so Mapbox can replace it later by just setting VITE_MAPBOX_TOKEN in web/.env (when the token exists, use mapbox-gl with style mapbox://styles/mapbox/light-v11; otherwise MapLibre). Write both paths now.

DATA: create web/public/mock/ JSON files exactly per the DATA CONTRACT, with clearly fake values for ~15 real Chennai Metro stations at their real approximate coordinates (Airport, Meenambakkam, Alandur, Guindy, Saidapet, Teynampet, Thousand Lights, LIC, Government Estate, Central, Egmore, Kilpauk, Anna Nagar Tower, Koyambedu, Vadapalani, Ashok Nagar, Thirumangalam, Washermanpet). Each station gets 2–4 nearby stops and a remainder "other" share. One data loader reads from /data/ (API at http://localhost:8000) when it's available, else falls back to /mock/. Show a small "Mock data" tag when on mock.

DESIGN (must look premium and calm, for a 1920×1080 projector):
- Light theme, lots of white space, soft shadows, 12–16 px rounded cards.
- Metro blue #3B6FE0, bus orange #E07A1F, greys for everything else.
- Hotspot levels: high #E5484D, medium #F5A524, low #46A758. Wait levels: bad #E5484D, ok #F5A524, good #46A758.
- No pie charts, gauges, 3D, or KPI grids. Estimates shown with "~".

SCREEN 1 — Map (home, full screen):
- Metro lines (from stations.json lines) drawn thin in their real colours (Blue #2F6BFF, Green #2BA84A).
- Hotspot markers: one circle per station, radius by transfers_per_day. ONE colour mode at a time, with a segmented toggle top-right: "Transfers" (default; colour by level) | "Wait time" (colour by wait_level). Legend updates with the toggle. Nothing else on the markers.
- Click a station → it zooms in and draws ARROWS (deck.gl ArcLayer or curved PathLayer with arrowheads) from the station to each nearby stop. Arrow width = share_pct. Each arrow ends at a stop dot with a small label "Stop name · 18%". The other stations' arrows are hidden, so only one station's flows show at a time.
- Bottom time bar 05:00–23:00 with play/pause: markers and arrows update from the hourly arrays (share_pct per hour). The current hour shows big ("08:00").
- Top-left: three numbers only (~transfers/day, top hotspot, worst wait).
- Layer toggle: "Regulars": shows regulars.json as dashed lines from the station to dest_lat/dest_lon with a label "~N regulars · likely <dest_name>".

SIDE PANEL (opens on station click, right side, 440 px):
- Header: station name, line chip, "~N exits/day", "~N% switch to bus".
- "Where people go": the most important element. A clean horizontal 100% stacked bar of the stop shares, plus a list below. Each row: stop name, walk metres, share %, and its routes as small chips with their % and wait. The "other" row is grey. Updates with the time bar.
- Pulse–Echo chart (ECharts): blue bars = Metro exits per 5 min; orange markers/bars at bus arrivals, with a darker top = echo. Caption: "Extra boardings right after each train = transfers."
- Regulars card: "~N regular riders exit 08:15–08:30 every weekday → route X → likely <destination_hint>".
- Recommendations for this station (cards, see Screen 2).

SCREEN 2 — Fix It (top nav tab):
- Summary strip: extra buses total, routes affected, passenger-minutes saved per day.
- Recommendation cards sorted by rank. Each: type chip (Add buses / Shift timing / Bigger bus / New feeder), a one-sentence action, an evidence row (transfers, wait, headway, crowding vs capacity), and a before→after wait mini-bar. Click a card → jump to the map with that station selected.
- Timetable shift tool: pick station + route; a −5…+5 min slider moves along nudge.json; shows the avg wait updating live, and the best shift marked.
- Collapsible "Data quality" panel from quality_report.json.

Top nav: "Pulse–Echo · CUMTA PS3" | Map | Fix It. Smooth transitions. No console errors. Run npm run dev, open it, fix anything that looks off, and report.
```

---

## P3 — Compute all numbers (quick estimate, real data)

Paste this after P1 finishes:

```
Read PHASES.md fully. P1 is done (data/interim and data/ref exist). Do P3 only.
Goal: produce EVERY file in the DATA CONTRACT from real data, using a simple, honest quick estimate. Set method = "quick_estimate".

1. pipeline/06_pulses.py: per station per day, group exit taps into pulses (new pulse when gap > pulse_gap seconds). Fields: t_median, size. Report typical peak inter-pulse gaps.
2. pipeline/07_bus_arrivals.py: group tickets by (duty_date, fleet_no, trip id, source). Trip id = trip_no if present, else waybill_no + direction change. arrival = first ticket time; boardings = passenger count. Per (stop, route, dir): headway_min. Cycle time per route = median gap between consecutive trip starts of the same fleet_no on the same route+dir.
3. pipeline/08_quick_transfers.py, the quick echo estimate, per (station, treatment stop, route), per hour:
 - For each bus arrival, local baseline = the median boardings per minute of gap at that stop+route in the same hour band, using arrivals with NO pulse in the preceding walk..25 min window (or the control stops, if too few).
 - echo = max(0, boardings − baseline × gap_minutes).
 - Count the echo only if a pulse reached the stop (t_median + walk time) within the gap before this bus.
 - transfers = sum of echo. Average over the 4 days → per-day values.
 - share_pct = transfers ÷ station exits in the same hour (and per day). Cap so each station's shares sum ≤ 100; the remainder is the "other" row.
 - Wait per transfer = next arrival of that route after (pulse t_median + walk) minus that time. Weight by transfers.
4. pipeline/09_recommend.py, per station+route+hour band where transfers are meaningful:
 - add_buses: avg wait > target wait OR boardings per trip > 90% of capacity. Target headway = min(2 × target wait, current headway × capacity ÷ boardings per trip). extra_buses = ceil(cycle ÷ target headway) − ceil(cycle ÷ current headway), minimum 1. wait_after = simulate evenly spaced buses at the target headway on the real pulse times.
 - retime: try shifts −5..+5 min of that route's arrivals; if the best shift cuts avg transfer wait ≥ 20% with no new buses, recommend it with shift_min. Write nudge.json curves.
 - bigger_bus: boardings per trip > capacity but wait OK.
 - new_feeder: station in top 25% by exits with transfer_pct < 3% or no stop within 400 m.
 - passenger_minutes_saved_per_day = transfers × (wait_before − wait_after). Rank by it. Plain one-sentence action. Top 20 items. Summary totals.
5. pipeline/10_regulars.py: per station and 15-min exit window, count Card Tokens exiting there in that window on >= regulars_min_days of the 4 days. Keep windows with >= regulars_min_cards. top_route = the route with the highest share at that station in that window. Destination: the end of that route (Trip_Destination name matched to the stop Excel for coordinates). If it's within 1.5 km of a zone in data/ref/poi_zones.csv, add the zone name. Create poi_zones.csv by hand: ~20 well-known Chennai IT parks, industrial estates, colleges, hospitals, CMBT, with lat/lon/type, marked hand-curated. likely_purpose = "work/education" if the window is 07:00–10:30 and the pattern repeats; else "other". Wording always says "likely".
6. Levels: hotspot level by tertiles of transfers_per_day; wait_level good < 5, ok 5–10, bad > 10 min (put in config).
7. pipeline/11_export.py writes all contract JSON into out/, plus out/station/<id>.json with the pulse_echo data for the busiest weekday 06:00–11:00. run_all.py runs 06→11.
8. A contract check script checks every JSON matches the DATA CONTRACT. Run everything and report: top 10 stations by transfers, their stop shares, top 10 recommendations, top routine flows. Flag anything that looks implausible (e.g. shares near 100%, waits > 40 min).
```

---

## P4 — Connect, real data, polish

Paste this:

```
Read PHASES.md fully. P2 (frontend) and P3 (out/ JSON) are done. Do P4 only.

1. api/main.py (FastAPI + uvicorn on port 8000): serve out/ at /data/ with CORS for localhost. Health route /health. Add a WebSocket /ws/sensors (empty for now).
2. Make the frontend load real /data/ and hide the Mock tag. Fix every place where real data breaks the UI: long stop names, stations with no flows, missing hours, routes with no recommendations.
3. Check visually, station by station for the top 10: arrows land on the correct stops, percentages add up to 100 with "other", the time bar changes values, and the Wait time toggle recolours.
4. Polish to near-perfect: consistent spacing, crisp labels that never overlap (hide low-share labels under 3% but keep them in the side panel), smooth zoom to a station on click, keyboard Esc to close the panel, loading states.
5. Write DEMO.md: exact commands to start the API and frontend on Windows.
6. Report anything shown on screen that isn't from out/ data.
```

When the Mapbox token is available, paste this:

```
Read PHASES.md. Put this Mapbox token in web/.env as VITE_MAPBOX_TOKEN=<TOKEN>. Switch mapConfig to Mapbox (mapbox://styles/mapbox/light-v11), keep the MapLibre fallback, make sure deck.gl layers still render on top, and add .env to .gitignore. Test and report.
```

---

## P5 — Upgrade to the real Pulse–Echo model (only if time remains)

```
Read PHASES.md fully. P3 outputs exist. Do P5: replace the quick estimate with the proper model while writing the SAME JSON fields (set method = "pulse_echo_glm").

1. One row per bus arrival at a treatment stop+route: B = boardings, gap = minutes since previous bus, M = total pulse size whose (t_median + w) falls within the gap, hour band.
2. Fit a Poisson GLM, identity link, non-negative coefficients: E[B] = lambda_hourband × gap + alpha × M. Grid-search w over 2–10 min. alpha = share of exits taking that route. Shrink low-data routes toward the station average.
3. Validation: (a) same fit on control stops 600–1500 m, where alpha should be ≈ 0; (b) shuffle pulse times 200× for a p-value; (c) fit 3 days, predict the 4th. Write out/validation.json and the validation block in station files.
4. Recompute transfers, shares, waits, recommendations and regulars with the new alpha (rerun 09–11). Show the "Validated" badge in the side panel when passed.
5. Report quick-estimate vs model numbers for the top 10 stations, side by side.
```

---

## P6 — Hardware software side (optional)

```
Read PHASES.md. Do P6: hardware/listener.py subscribes to MQTT pulse-echo/nodes/+ messages {node:"A"|"B", hash, first_seen, last_seen, state:"seen"|"gone"}.
hardware/matcher.py: hash at A then at B within 20 min → start counter; hash "gone" at B → count +1 transfer with walk and wait. A GNSS check flag (bus within 30 m of the stop at that moment) stays OFF for the demo.
Push events to the API's /ws/sensors. Add hardware/simulate.py for testing without devices.
Frontend: a small "Live sensor" card in the side panel for the demo station showing the counter, last walk, last wait.
Write hardware/FIRMWARE_NOTES.md with the exact message format and the on-device SHA-256(address + daily salt) rule.
```
