import json, polars as pl
from common import *
W0, W1 = CFG["window"]; days = CFG["ingest_days"]
q = {"cmrl_entry": {}, "cmrl_exit": {}, "etm": {}}
def cnt(s, k, v): s[k] = int(v)

# ---- CMRL ----
ent = pl.read_parquet(INTERIM / "cmrl_entry_raw.parquet"); ext = pl.read_parquet(INTERIM / "cmrl_exit_raw.parquet")
good_names = set(ent["Station Name"].unique().to_list()) - {"0426"}
for kind, df in (("entry", ent), ("exit", ext)):
    k = f"cmrl_{kind}"; s = q[k]
    d = df.rename({"Record Date & Time": "ts", "Station Name": "station", "Line Name": "line", "Card Token": "card",
                   "Transaction Type": "ttype", "Origin Station": "origin", "Transaction Id": "txn", "Fare Media Type": "media"})
    d = d.with_columns(pl.col("ts").str.to_datetime("%Y-%m-%d %H:%M:%S", strict=False))
    d = d.with_columns(
        f_blank_row=pl.col("ts").is_null() | pl.col("station").is_null() | pl.col("card").is_null(),
        f_bad_station=pl.col("station").is_not_null() & ~pl.col("station").is_in(list(good_names)),
        f_bad_origin=pl.col("origin").is_not_null() & ~pl.col("origin").is_in(list(good_names)),
        f_pre_service=pl.col("ts").dt.time() < pl.time(4, 30),
        f_outside_window=(pl.col("ts").dt.date() < pl.lit(W0).str.to_date()) | (pl.col("ts").dt.date() > pl.lit(W1).str.to_date()),
        f_wrong_ttype=pl.col("ttype").is_not_null() & (pl.col("ttype") != kind.capitalize()),
        f_dup_txn=pl.col("txn").is_duplicated(),
    ).with_columns(date=pl.col("ts").dt.date(), hour=pl.col("ts").dt.hour())
    fl = [c for c in d.columns if c.startswith("f_")]
    d = d.with_columns(valid=~pl.any_horizontal(*[pl.col(c).fill_null(False) for c in fl if c not in ("f_dup_txn","f_bad_origin")]))
    cnt(s, "rows_total", d.height)
    for c in fl: cnt(s, c, d[c].fill_null(False).sum())
    cnt(s, "rows_valid_in_window", d.filter(pl.col("valid")).height)
    s["rows_per_date"] = {str(a): b for a, b in d.group_by("date").len().sort("date").iter_rows()}
    d.write_parquet(INTERIM / f"cmrl_{kind}_clean.parquet")
# exit-date checks
exd = ext.with_columns(dd=pl.col("Record Date & Time").str.slice(0, 10))
q["cmrl_exit"]["missing_dates_in_1_7_mar"] = [x for x in [f"2026-03-0{i}" for i in range(1, 8)] if x not in set(exd["dd"].drop_nulls())]
x7 = ext.filter(pl.col("Record Date & Time").str.starts_with("2026-03-07")); e7 = ent.filter(pl.col("Record Date & Time").str.starts_with("2026-03-07"))
q["cmrl_exit"]["mar7_rows"] = x7.height; q["cmrl_exit"]["mar7_rows_equal_entry_mar7"] = e7.height
q["cmrl_exit"]["mar7_txn_type_entry"] = x7.filter(pl.col("Transaction Type") == "Entry").height
q["cmrl_exit"]["mar7_identical_txn_ids_with_entry"] = x7.join(e7, on="Transaction Id", how="inner").height
q["cmrl_exit"]["note"] = "2 Mar absent; 7 Mar is a copy of Entry (Transaction Type=Entry) -> main window 3-6 Mar"

# ---- ETM ----
for day in days:
    s = {}
    d = pl.read_parquet(INTERIM / f"etm_{day}_raw.parquet")
    d = d.with_columns(
        pl.col("date").str.to_date("%d-%m-%Y", strict=False).alias("date_p"),
        pl.col("duty_date").str.to_date("%Y-%m-%d", strict=False).alias("duty_p"),
        pl.col("passenger_count").cast(pl.Int32, strict=False).alias("pax"),
        pl.col("KM").cast(pl.Float32, strict=False),
        pl.col("trip_no").cast(pl.Int32, strict=False),
    )
    d = d.with_columns(
        ts=(pl.col("date_p").cast(pl.Datetime) + (pl.col("time").str.to_time("%H:%M:%S", strict=False).cast(pl.Duration))),
        route=pl.col("direction").str.extract(r"^(.*?)\s*-\s*(UP|DOWN|[A-Z]+)\s*$", 1),
        dir=pl.col("direction").str.extract(r"^(.*?)\s*-\s*(UP|DOWN|[A-Z]+)\s*$", 2),
    )
    d = d.with_columns(
        f_epoch_1970=(pl.col("date_p").dt.year() == 1970) | (pl.col("duty_p").dt.year() == 1970),
        f_after_midnight=(pl.col("duty_p") != pl.col("date_p")) & (pl.col("duty_p").dt.year() > 1970),
        f_free_no_destination=pl.col("destination").is_null() | (pl.col("destination") == "Zero Value Ticket"),
        f_no_pax=pl.col("pax").is_null() | (pl.col("pax") <= 0),
        f_bad_time=pl.col("ts").is_null(),
        f_no_route=pl.col("route").is_null(),
        f_batch_print=pl.len().over(["waybill_no", "date", "time"]) >= 5,
    )
    # duty_date is authoritative service day; after-midnight rows keep their real ts but belong to duty_p
    d = d.with_columns(service_date=pl.when(pl.col("f_epoch_1970")).then(None).otherwise(pl.col("duty_p")))
    fl = [c for c in d.columns if c.startswith("f_")]
    d = d.with_columns(valid=~(pl.col("f_epoch_1970") | pl.col("f_bad_time") | pl.col("f_no_pax") | pl.col("f_no_route")))
    s["rows_total"] = d.height
    for c in fl: s[c] = int(d[c].fill_null(False).sum())
    s["rows_valid"] = int(d["valid"].sum())
    s["columns_present"] = {"trip_no": d["trip_no"].is_not_null().sum() > 0, "passenger_count": d["pax"].is_not_null().sum() > 0}
    q["etm"][day] = s
    d.drop(["date", "duty_date", "passenger_count"]).write_parquet(INTERIM / f"etm_{day}_clean.parquet")
json.dump(q, open(OUT / "quality_report.json", "w"), indent=1, default=str)
print(json.dumps(q, indent=1, default=str)[:6000])
