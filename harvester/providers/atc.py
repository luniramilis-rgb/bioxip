"""Pengayaan ATC via RxClass (NLM RxNav). API publik, tanpa kunci.

Fornas API tidak menyediakan kode ATC; RxClass memberi kelas ATC per nama obat.
Pilih kode paling spesifik (terpanjang, mis. N02BE01 > N02BE > N02B).
"""

from __future__ import annotations

from typing import Iterable

import httpx

RXCLASS = "https://rxnav.nlm.nih.gov/REST/rxclass/class/byDrugName.json"


def pick_atc(items: Iterable[dict] | None) -> str | None:
    codes: set[str] = set()
    for item in items or []:
        concept = item.get("rxclassMinConceptItem") or {}
        code = concept.get("classId")
        kind = str(concept.get("classType") or "").upper()
        if code and "ATC" in kind:
            codes.add(str(code).strip().upper())
    if not codes:
        return None
    # Paling spesifik = terpanjang; tie-break alfabetis agar deterministik.
    return sorted(codes, key=lambda c: (-len(c), c))[0]


def atc_candidates(row: dict) -> list[str]:
    """Urutan nama yang dicoba: us_name → INN → nama → alias."""
    values: list[str] = []
    for key in ("us_name", "inn", "nama", "name"):
        value = row.get(key)
        if value:
            values.append(str(value).split("/")[0].strip())
    aliases = row.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [aliases]
    values.extend(str(a).strip() for a in aliases if str(a).strip())
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            out.append(value)
    return out[:5]


def fetch_atc(name: str, timeout: float = 8.0) -> str | None:
    resp = httpx.get(RXCLASS, params={"drugName": name, "relaSource": "ATC"}, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    return pick_atc((data.get("rxclassDrugInfoList") or {}).get("rxclassDrugInfo"))
