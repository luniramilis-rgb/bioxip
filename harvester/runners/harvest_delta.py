import asyncio
from datetime import date, datetime, timedelta, timezone
from itertools import islice

import typer

from harvester.config import DELTA_LOOKBACK_DAYS, PAGE_SIZE
from harvester.dedupe import to_rows_epmc, to_rows_trials
from harvester.models import EpmcHit, TrialRecord
from harvester.providers import clinicaltrials, europepmc, neliti_oai, openalex
from harvester.store import Store

app = typer.Typer(help="bioXip delta harian per watermark.")

CHUNK = 500


def _chunks(items, size: int = CHUNK):
    iterator = iter(items)
    while chunk := list(islice(iterator, size)):
        yield chunk


def _watermark(store: Store, provider: str, default: date) -> date:
    cursor = store.get_cursor(provider)
    value = cursor.get("last_delta_at")
    if not value:
        return default
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.date() - timedelta(days=1)


@app.command()
def europepmc_delta(provider: str = "europepmc") -> None:
    store = Store()
    now = datetime.now(timezone.utc)
    since = _watermark(store, provider, now.date() - timedelta(days=DELTA_LOOKBACK_DAYS))
    run_id = store.start_run(provider, "delta", since.isoformat())
    fetched = inserted = updated = 0
    try:
        query = europepmc.delta_query(since.isoformat(), now.date().isoformat())
        hits = asyncio.run(europepmc.fetch_hits(query, PAGE_SIZE))
        rows = to_rows_epmc([EpmcHit(**h) for h in hits])
        if rows:
            enrich_batch = [r for r in rows[:150] if r.get("doi")]
            if enrich_batch:
                asyncio.run(openalex.enrich_documents(enrich_batch))
        for batch in _chunks(rows):
            ins, upd = store.upsert_documents(batch)
            inserted += ins
            updated += upd
            fetched += len(batch)
        store.finish_run(run_id, "success", fetched, inserted, updated)
        store.set_cursor(provider, "last_delta_at", now.isoformat())
    except Exception as exc:
        store.finish_run(run_id, "error", fetched, inserted, updated, {"error": str(exc)})
        raise
    finally:
        store.close()


@app.command()
def clinicaltrials_delta(provider: str = "clinicaltrials") -> None:
    now = datetime.now(timezone.utc)
    since = _watermark(store, provider, now.date() - timedelta(days=DELTA_LOOKBACK_DAYS))
    run_id = store.start_run(provider, "delta", since.isoformat())
    fetched = inserted = updated = 0
    try:
        query = clinicaltrials.delta_query(since, now.date())
        records = asyncio.run(clinicaltrials.fetch_studies(query))
        rows = to_rows_trials([TrialRecord(**r) for r in records])
        for batch in _chunks(rows):
            ins, upd = store.upsert_documents(batch)
            inserted += ins
            updated += upd
            fetched += len(batch)
        store.finish_run(run_id, "success", fetched, inserted, updated)
        store.set_cursor(provider, "last_delta_at", now.isoformat())
    except Exception as exc:
        store.finish_run(run_id, "error", fetched, inserted, updated, {"error": str(exc)})
        raise
    finally:
        store.close()


if __name__ == "__main__":
    app()
