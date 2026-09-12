"""Adapter WHO Global Health Observatory (epidemiologi) — JSON API publik."""

from __future__ import annotations

import httpx

from harvester.providers import guideline

ENDPOINT = "https://ghoapi.azureedge.net/api"
# Indikator relevan topik prioritas L1.
INDICATORS = {
    "tb": ["MDG_0000000020", "MDG_0000000023", "MDG_0000000024"],
    "dbd": [],
    "hiv": ["MDG_0000000018"],
}


def fetch_indicator_names(timeout: float = 15.0) -> dict[str, str]:
    resp = httpx.get(f"{ENDPOINT}/Indicator", headers={"user-agent": "bioXip/0.1"}, timeout=timeout)
    resp.raise_for_status()
    return {row.get("IndicatorCode"): row.get("IndicatorName") for row in (resp.json().get("value") or [])}


def fetch_indonesia(code: str, timeout: float = 20.0) -> dict | None:
    resp = httpx.get(
        f"{ENDPOINT}/{code}",
        params={"$filter": "SpatialDim eq 'IDN'"},
        headers={"user-agent": "bioXip/0.1"},
        timeout=timeout,
    )
    resp.raise_for_status()
    rows = [row for row in (resp.json().get("value") or []) if row.get("SpatialDim") == "IDN"]
    if not rows:
        return None
    rows.sort(key=lambda row: row.get("TimeDim") or 0)
    return rows[-1]


def records(topik: str, names: dict[str, str] | None = None, timeout: float = 20.0) -> list[dict]:
    out: list[dict] = []
    names = names or {}
    for code in INDICATORS.get(topik, []):
        try:
            row = fetch_indonesia(code, timeout=timeout)
        except Exception:
            continue
        if not row:
            continue
        name = names.get(code) or code
        value = row.get("NumericValue")
        year = row.get("TimeDim")
        summary = guideline.clean_text(f"{name} — Indonesia {year or ''}: {value if value is not None else 'n/a'}")
        out.append(
            guideline.normalize_rec(
                source_id="whogho",
                tier="epidemiologi",
                topik=topik,
                ringkasan=summary,
                locator="indikator global (WHO GHO)",
                url=f"{ENDPOINT}/{code}",
                keywords=guideline.clean_text(name, 120),
            )
        )
    return out
