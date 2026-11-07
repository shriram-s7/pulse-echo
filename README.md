# Pulse-Echo

Entry for the **CUMTA Hackathon, Problem Statement 3 - "Discover the Hidden Connections"**. It estimates where Chennai Metro passengers switch to buses (and back), what share goes to each nearby bus stop and route, how long they wait, and what to change (add buses, retime, bigger buses, new feeder routes). It also finds "regulars": anonymous Metro cards that tap at the same time every day, with their likely routine.

**The idea.** Trains release passengers in bursts (pulses). Buses that arrive at nearby stops shortly after a pulse carry extra boardings above the normal local level (the echo). The echo is the transfer volume. Bus tickets carry no passenger ID, so individuals are never joined across modes; everything is estimated statistically.

## What is in the repo

```
pipeline/   numbered Python scripts, run in order (ingest, clean, stations, stops, catchments,
            pulses, bus arrivals, transfer estimate, recommendations, regulars, export,
            contract check, per-station route flows, suburban, consistency check)
api/        small FastAPI app that serves the exported JSON (/data) and a /ws/sensors socket
web/        React + TypeScript + Vite dashboard (Mapbox GL / MapLibre, deck.gl, ECharts)
            with mock data in web/public/mock so the UI runs without the pipeline
out/        exported JSON the dashboard reads (stations, hotspots, flows, recommendations,
            regulars, method, quality report, route_flows/)
data/ref/   small reference tables (bus stops, stations, matched stops, POI zones)
config.yaml analysis settings: study window, radii, walk speed, bus capacities, thresholds
PHASES.md   the original build plan and the data contract between backend and frontend
```

Dashboard screens: station map with transfer hotspots, per-station panel (pulse vs echo chart, routes, waits, regulars), a "Fix it" recommendations screen, and a "How it works" screen.

## Stack

Python (Polars, pandas, GeoPandas, Shapely, PyProj, RapidFuzz, scikit-learn, statsmodels, SciPy), FastAPI + Uvicorn; React 19, TypeScript, Vite, deck.gl, react-map-gl, Mapbox GL / MapLibre, ECharts.

## Run the dashboard (no raw data needed)

```bash
cd web
npm install
npm run dev          # http://localhost:5173 , uses web/public/mock
```

Optional: copy `web/.env.example` to `web/.env` and set `VITE_MAPBOX_TOKEN`. Without it the map falls back to MapLibre with Carto Positron.

To also serve the exported results through the API:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn api.main:app --host 127.0.0.1 --port 8000
```

`start_demo.bat` starts the API and the web app together on Windows.

## Re-run the pipeline (needs the raw data)

The hackathon raw data is **not** in this repo. Put it in a folder and set `data_path` in `config.yaml` (default `E:/CUMTA HACKATHON/Theme 3`). It must contain `CMRL_Entry.csv`, `CMRL_Exit.csv`, the daily `ETM/Ticket-Data-2026-03-DD.csv.bz2` bus-ticket files, the GCC/Avadi/Tambaram bus-stop workbook, and the Metro and MTC route shapefiles. Then run the scripts in `pipeline/` in numeric order (see `PHASES.md` for the full specification). Intermediate results are cached in `data/interim/*.parquet`.

## Not included in the repository

- `data/interim/` (about 426 MB of cached parquet files, regenerable from the raw data), `out/debug/` (debug screenshots), `.venv/`, `node_modules/`, logs and `web/.env`.
- The raw CUMTA datasets.

## Notes

- Bad rows are flagged, not deleted; counts are in `out/quality_report.json`.
- Assumptions (bus capacity, walking speed, radii) are listed in `config.yaml`.
