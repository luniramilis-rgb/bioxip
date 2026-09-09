import asyncio

import httpx

from harvester.config import EPMC_BASE, MAX_RETRIES, RETRY_BACKOFF, TIMEOUT

PUB_TYPES = '(PUB_TYPE:"journal article" OR PUB_TYPE:"preprint")'


async def _get(client: httpx.AsyncClient, params: dict) -> dict:
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = await client.get(f"{EPMC_BASE}/search", params=params)
            if resp.status_code == 200:
                return resp.json()
            last_error = RuntimeError(f"HTTP {resp.status_code}")
        except httpx.HTTPError as exc:
            last_error = exc
        await asyncio.sleep(RETRY_BACKOFF * (attempt + 1))
    raise RuntimeError(f"europepmc request failed: {last_error}")


async def fetch_hits(query: str, page_size: int = 1000, max_pages: int = 100) -> list[dict]:
    hits: list[dict] = []
    cursor = "*"
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        for _ in range(max_pages):
            data = await _get(
                client,
                {
                    "query": query,
                    "format": "json",
                    "resultType": "core",
                    "pageSize": page_size,
                    "cursorMark": cursor,
                },
            )
            page = data.get("resultList", {}).get("result", []) or []
            hits.extend(page)
            next_cursor = data.get("nextCursorMark")
            if not next_cursor or next_cursor == cursor or not page:
                break
            cursor = next_cursor
    return hits


def delta_query(since_date: str, until_date: str) -> str:
    return f"{PUB_TYPES} AND FIRST_PDATE:[{since_date} TO {until_date}]"


def year_query(year: int) -> str:
    return f"{PUB_TYPES} AND FIRST_PDATE:[{year}-01-01 TO {year}-12-31]"
