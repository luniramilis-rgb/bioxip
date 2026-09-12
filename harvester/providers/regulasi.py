"""Adapter regulasi/PNPK dari berkas operator (JSON/CSV).

Kebijakan: **tidak menebak URL**. Dokumen/regulasi disuplai operator sebagai berkas
berisi metadata + tautan resmi; adapter ini hanya menormalkan.

Format JSON: array atau {items:[...]} dengan field:
  judul (wajib), url (wajib, https), topik (wajib, "tb"/"dbd"/"hiv" atau daftar),
  tier (opsional; default "pnk"), nomor/tahun (opsional, untuk keywords),
  ringkasan (opsional; default judul), locator (opsional; default "dokumen").
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from harvester.providers import guideline


def _row_to_records(row: dict) -> list[dict]:
    url = str(row.get("url") or "").strip()
    if not url.startswith("https://"):
        return []
    judul = str(row.get("judul") or row.get("title") or "").strip()
    if not judul:
        return []
    topik_raw = row.get("topik") or row.get("topic") or ""
    if isinstance(topik_raw, str):
        topics = [t.strip().lower() for t in topik_raw.split(",") if t.strip()]
    else:
        topics = [str(t).strip().lower() for t in topik_raw if str(t).strip()]
    topics = [t for t in topics if t in guideline.TOPIC_KEYWORDS]
    if not topics:
        return []
    nomor = str(row.get("nomor") or "").strip()
    tahun = str(row.get("tahun") or "").strip()
    keywords = " ".join(part for part in [judul, nomor, tahun] if part)
    ringkasan = str(row.get("ringkasan") or judul).strip()
    # Locator unik per dokumen (hindari tabrakan unique (source_id, topik, locator)).
    locator = str(row.get("locator") or f"dokumen: {judul}" + (f" ({nomor})" if nomor else "")).strip()
    tier = str(row.get("tier") or "pnk").strip()
    return [
        guideline.normalize_rec(
            source_id="regulasi",
            tier=tier,
            topik=topic,
            ringkasan=ringkasan,
            locator=locator,
            url=url,
            keywords=guideline.clean_text(keywords, 160),
        )
        for topic in topics
    ]


def load_records(path: Path) -> list[dict]:
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
    else:
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data.get("items") if isinstance(data, dict) else data
    out: list[dict] = []
    for row in rows or []:
        out.extend(_row_to_records(row))
    return out
