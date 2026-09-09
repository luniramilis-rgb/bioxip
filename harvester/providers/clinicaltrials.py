import asyncio
from datetime import date

import httpx

from harvester.config import CT_BASE, CT_PAGE_SIZE, MAX_RETRIES, RETRY_BACKOFF, TIMEOUT


async def _get(client: httpx.AsyncClient, params: dict) -> dict:
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = await client.get(f"{CT_BASE}/studies", params=params)
            if resp.status_code == 200:
                return resp.json()
            last_error = RuntimeError(f"HTTP {resp.status_code}")
        except httpx.HTTPError as exc:
            last_error = exc
        await asyncio.sleep(RETRY_BACKOFF * (attempt + 1))
    raise RuntimeError(f"clinicaltrials request failed: {last_error}")


async def fetch_studies(query_term: str, max_pages: int = 1000) -> list[dict]:
    studies: list[dict] = []
    page_token = None
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for _ in range(max_pages):
            params: dict = {
                "query.term": query_term,
                "pageSize": CT_PAGE_SIZE,
                "countTotal": "false",
            }
            if page_token:
                params["pageToken"] = page_token
            data = await _get(client, params)
            page = data.get("studies", []) or []
            studies.extend(page)
            page_token = data.get("nextPageToken")
            if not page_token or not page:
                break
    return studies


def delta_query(since: date, until: date) -> str:
    return (
        "AREA[LastUpdatePostDate]"
        f"RANGE[{since.isoformat()},{until.isoformat()}]"
    )


def posted_query(min_year: int) -> str:
    return f"AREA[StudyFirstPostDate]RANGE[{min_year}-01-01,MAX]"
