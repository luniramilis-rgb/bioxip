"""Provider guideline L1: normalisasi, validasi, topic-tagging, checksum.

Menyimpan **ringkasan pendek + pointer** (bukan dokumen). Payload dipetakan
langsung ke kolom `guideline_recs` (migrasi 023).
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Iterable

MAX_RINGKASAN = 300

SOURCE_IDS = {
    "farmalkes": "farmalkes",
    "whogho": "whogho",
    "regulasi": "regulasi",
}

# Kata kunci topik prioritas (L1): TB, DBD, HIV.
TOPIC_KEYWORDS = {
    "tb": ["tuberkulosis", "tuberculosis", "tb", "oat", "rifampisin", "isoniazid"],
    "dbd": ["dengue", "demam berdarah", "dbd", "aedes"],
    "hiv": ["hiv", "aids", "antiretroviral", "arv", "odha"],
}


def clean_text(value: str, limit: int = MAX_RINGKASAN) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    # Sisakan 1 karakter untuk elipsis agar hasil selalu ≤ limit (kontrak ringkasan).
    head = text[: max(1, limit - 1)].rsplit(" ", 1)[0] or text[: max(1, limit - 1)]
    return head + "…"


def topics_for(text: str) -> list[str]:
    low = str(text or "").lower()
    return [topic for topic, words in TOPIC_KEYWORDS.items() if any(w in low for w in words)]


def normalize_rec(source_id: str, tier: str, topik: str, ringkasan: str, locator: str, url: str, kelas: str | None = None, keywords: str = "") -> dict:
    summary = clean_text(ringkasan)
    return {
        "source_id": source_id,
        "tier": tier,
        "topik": topik,
        "ringkasan": summary,
        "kelas": kelas,
        "locator": locator,
        "url": url,
        "keywords": keywords,
        "search_text": " ".join([summary, keywords, topik]).strip(),
    }


def key_of(record: dict) -> str:
    return f"{record['source_id']}|{record['topik']}|{record['locator']}"


def checksum(record: dict) -> str:
    canon = json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def diff(existing: dict[str, str], records: Iterable[dict]) -> dict[str, list]:
    new, changed, unchanged = [], [], []
    for record in records:
        key = key_of(record)
        stamp = checksum(record)
        current = existing.get(key)
        if current is None:
            new.append(record)
        elif current != stamp:
            changed.append(record)
        else:
            unchanged.append(record)
    return {"new": new, "changed": changed, "unchanged": unchanged}


def validate_records(records: Iterable[dict]) -> list[str]:
    errors: list[str] = []
    for record in records:
        key = key_of(record) if record.get("source_id") and record.get("topik") and record.get("locator") else "(tak lengkap)"
        if not record.get("source_id"):
            errors.append("rec tanpa source_id")
        if record.get("tier") not in ("pnk", "permenkes", "profesi", "regulator", "epidemiologi"):
            errors.append(f"{key}: tier tidak valid")
        if not record.get("topik"):
            errors.append(f"{key}: topik kosong")
        if not record.get("ringkasan"):
            errors.append(f"{key}: ringkasan kosong")
        if len(record.get("ringkasan") or "") > MAX_RINGKASAN:
            errors.append(f"{key}: ringkasan > {MAX_RINGKASAN} char")
        if not record.get("locator"):
            errors.append(f"{key}: locator wajib")
        if not str(record.get("url") or "").startswith("https://"):
            errors.append(f"{key}: url harus https")
    return errors


def fact_source_payloads() -> list[dict]:
    return [
        {"id": "farmalkes", "nama": "Farmalkes Kemenkes", "pengelola": "Kemenkes RI", "edisi": "situs", "url": "https://farmalkes.kemkes.go.id/", "lisensi": "Data pemerintah"},
        {"id": "whogho", "nama": "WHO Global Health Observatory", "pengelola": "WHO", "edisi": "GHO", "url": "https://ghoapi.azureedge.net/api/Indicator", "lisensi": "WHO (atribusi)"},
        {"id": "regulasi", "nama": "Regulasi/PNPK (operator)", "pengelola": "Kemenkes RI / lainnya", "edisi": "per-dokumen", "url": None, "lisensi": "Data pemerintah"},
    ]
