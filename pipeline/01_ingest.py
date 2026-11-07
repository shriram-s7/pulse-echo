import bz2, io, polars as pl
from concurrent.futures import ThreadPoolExecutor
from common import *
for k in ("Entry", "Exit"):
    pl.read_csv(RAW / f"CMRL_{k}.csv", infer_schema_length=0).write_parquet(INTERIM / f"cmrl_{k.lower()}_raw.parquet")
COLS = ["depot","fleet_no","route_service_type","trip_no","ticket_no","date","time","ticket_type","source","destination",
        "passenger_count","payment_type","direction","Trip_Origin","Trip_Destination","KM","duty_date","from_stage","to_stage",
        "waybill_no","schedule_no","add_trip"]
def one(day):
    f = RAW / "ETM" / "ETM" / f"Ticket-Data-{day}.csv.bz2"
    df = pl.read_csv(io.BytesIO(bz2.open(f).read()), columns=COLS, infer_schema_length=0)
    df.write_parquet(INTERIM / f"etm_{day}_raw.parquet"); return day, df.height
with ThreadPoolExecutor(4) as ex:
    for d, n in ex.map(one, CFG["ingest_days"]): print(d, n)
