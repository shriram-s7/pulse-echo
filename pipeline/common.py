import yaml, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
CFG = yaml.safe_load(open(ROOT / "config.yaml"))
RAW = pathlib.Path(CFG["data_path"])
INTERIM = ROOT / "data" / "interim"; REF = ROOT / "data" / "ref"; OUT = ROOT / "out"
for p in (INTERIM, REF, OUT, OUT / "debug"): p.mkdir(parents=True, exist_ok=True)

import re
def norm(s):
    s = str(s).upper().replace("&", " AND ")
    s = re.sub(r"\b([A-Z])\.([A-Z])\.?", r"\1\2", s)
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\b(BUS STAND|BUSSTAND|BUS STOP|BUS STN|BUS STATION)\b", "BS", s)
    s = re.sub(r"\b(RAILWAY STATION|RLY STATION|RLY STN|RAILWAY STN|RAIL STATION)\b", "RS", s)
    s = re.sub(r"\b(METRO STATION|METRO RAIL|METRO RLY|METRO RAILWAY STATION)\b", "METRO", s)
    s = re.sub(r"\b(JUNCTION|JCN|JUN|JN)\b", "JN", s)
    return re.sub(r"\s+", " ", s).strip()
WIN_DAYS = ["2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]
