import asyncio
from datetime import datetime, timezone
from itertools import islice

import typer

from harvester.config import PAGE_SIZE
from harvester.dedupe import to_rows_epmc, to_rows_trials
from harvester.models import EpmcHit, TrialRecord
from harvester.providers import clinicaltrials, europepmc
from harvester.store import Store

app = typer.Typer(help="bioXip full backfill (berjalan bertahap per tahun).")

CHUNK = 500


def _chunks(items, size: int = CHUNK):
    iterator = iter(items)
    while chunk := list(islice(iterator, size)):
        yield chunk


@app.command()
def epmc(start_year: int = 2000, end_year: int | None = None) -> None:
    end_year = end_year or datetime.now().year
    store = Store()
    run_id = store.start_run("europepmc", "full", f"{start_year}-{end_year}")
    fetched = inserted = updated = 0
    try:
        for year in range(start_year, end_year + 1):
            hits = asyncio.run(europepmc.fetch_hits(europepmc.year_query(year), PAGE_SIZE))
            rows = to_rows_epmc([EpmcHit(**h) for h in hits])
            for batch in _chunks(rows):
                ins, upd = store.upsert_documents(batch)
                inserted += ins
                updated += upd
                fetched += len(batch)
            print(f"{year}: {len(hits)} hit, total fetched={fetched}", flush=True)
            asyncio.run(asyncio.sleep(1))
        store.finish_run(run_id, "success", fetched, inserted, updated)
    except Exception as exc:
        store.finish_run(run_id, "error", fetched, inserted, updated, {"error": str(exc)})
        raise
    finally:
        store.close()


@app.command()
def trials(min_year: int = 2000) -> None:
    store = Store()
    run_id = store.start_run("clinicaltrials", "full", f"{min_year}-now")
    fetched = inserted = updated = 0
    try:
        query = clinicaltrials.posted_query(min_year)
        records = asyncio.run(clinicaltrials.fetch_studies(query))
        rows = to_rows_trials([TrialRecord(**r) for r in records])
        for batch in _chunks(rows):
            ins, upd = store.upsert_documents(batch)
            inserted += ins
            updated += upd
            fetched += len(batch)
        store.finish_run(run_id, "success", fetched, inserted, updated)
    except Exception as exc:
        store.finish_run(run_id, "error", fetched, inserted, updated, {"error": str(exc)})
        raise
    finally:
        store.close()


if __name__ == "__main__":
    app()
