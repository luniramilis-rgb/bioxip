"""Adapter Farmalkes Kemenkes (WordPress REST) — metadata posting/berita resmi."""

from __future__ import annotations

import httpx

from harvester.providers import guideline

ENDPOINT = "https://farmalkes.kemkes.go.id/wp-json/wp/v2/posts"


def fetch_posts(term: str, per_page: int = 10, timeout: float = 12.0) -> list[dict]:
    resp = httpx.get(
        ENDPOINT,
        params={"search": term, "per_page": per_page, "_fields": "id,date,link,title,content"},
        headers={"user-agent": "bioXip/0.1"},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


def records(term: str, topik: str, per_page: int = 10) -> list[dict]:
    out: list[dict] = []
    for post in fetch_posts(term, per_page):
        title = (post.get("title") or {}).get("rendered") or ""
        content = (post.get("content") or {}).get("rendered") or ""
        url = str(post.get("link") or "")
        if not url.startswith("https://"):
            continue
        if topik not in guideline.topics_for(f"{title} {content}"):
            continue  # hanya yang relevan topik prioritas
        out.append(
            guideline.normalize_rec(
                source_id="farmalkes",
                tier="regulator",
                topik=topik,
                ringkasan=guideline.clean_text(content or title),
                locator=f"posting {str(post.get('date') or '')[:10]}",
                url=url,
                keywords=guideline.clean_text(title, 120),
            )
        )
    return out
