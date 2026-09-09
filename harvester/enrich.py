import asyncio
from typing import Optional

import httpx

from harvester.config import (
    MAX_RETRIES,
    OPENALEX_BASE,
    OPENALEX_MAIL,
    RETRY_BACKOFF,
    TIMEOUT,
    UNPAYWALL_BASE,
)

DEFAULT_SEM = asyncio.Semaphore(8)


async def _get_with_retry(
    client: httpx.AsyncClient,
    url: str,
    sem: asyncio.Semaphore,
    params: Optional[dict] = None,
) -> httpx.Response:
    for attempt in range(MAX_RETRIES):
        async with sem:
            try:
                resp = await client.get(url, params=params)
            except httpx.HTTPError:
                resp = None
        if resp is not None and resp.status_code == 200:
            return resp
        await asyncio.sleep(RETRY_BACKOFF * (attempt + 1))
    raise RuntimeError(f"enrichment failed for {url}")


async def _openalex_work(client: httpx.AsyncClient, doi: str, sem: asyncio.Semaphore) -> Optional[dict]:
    params = {}
    if OPENALEX_MAIL:
        params["mailto"] = OPENALEX_MAIL
    resp = await _get_with_retry(
        client,
        f"{OPENALEX_BASE}/works/{doi}",
        sem,
        params=params,
    )
    return resp.json()


def _parse_work(data: dict) -> dict:
    best = (data.get("best_oa_location") or {}) or {}
    oa = {
        "is_oa": bool(data.get("open_access", {}).get("is_oa")),
        "pdf_url": best.get("pdf_url"),
        "oa_url": best.get("landing_page_url"),
        "license": best.get("license"),
        "provider": "openalex",
    }
    countries = {
        (a.get("institutions") or [{}])[0].get("country_code")
        for a in data.get("authorships", [])
        if a.get("institutions")
    }
    return {
        "oa": oa,
        "citation_count": int(data.get("cited_by_count") or 0),
        "indonesia": "ID" in countries,
    }


async def enrich_dois(dois: list[str]) -> dict[str, dict]:
    sem = asyncio.Semaphore(8)
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        results = await asyncio.gather(
            *(_openalex_work(client, doi, sem) for doi in dois),
            return_exceptions=True,
        )
    out: dict[str, dict] = {}
    for doi, result in zip(dois, results):
        if isinstance(result, Exception):
            continue
        out[doi] = _parse_work(result)
    return out


async def unpaywall_doi(client: httpx.AsyncClient, doi: str, email: str) -> Optional[dict]:
    resp = await _get_with_retry(
        client,
        f"{UNPAYWALL_BASE}/{doi}",
        DEFAULT_SEM,
        params={"email": email},
    )
    return resp.json()


def apply_enrichment(rows: list[dict], enrichment: dict[str, dict]) -> int:
    applied = 0
    for row in rows:
        doi = (row.get("doi") or "").lower()
        if doi not in enrichment:
            continue
        info = enrichment[doi]
        row["oa"] = {**row.get("oa", {}), **info["oa"]}
        if info["citation_count"]:
            row["citation_count"] = info["citation_count"]
        if info["indonesia"]:
            meta = dict(row.get("meta", {}))
            meta["indonesia"] = True
            row["meta"] = meta
        applied += 1
    return applied
