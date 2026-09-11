"""Provider formulary bioXip.

Membaca sumber obat (JSON bawaan atau berkas CSV/JSON penuh yang diberikan
operator) lalu menormalkannya menjadi payload siap-staging untuk tabel
`drug_products` / `drug_interactions` / `drug_monitoring`.

Tidak melakukan I/O jaringan. Keputusan tulis ada di runner.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
FUNCTIONS = ROOT / "functions"

FORNAS_SOURCE_ID = "fornas-kmk-1199-2025"
KURASI_SOURCE_ID = "kurasi-bioxip"

KINDS = ("drugs", "interactions", "monitoring")

# Pemetaan severitas bebas -> nilai CHECK tabel (tinggi|sedang|rendah).
SEVERITY_MAP = {
    "tinggi": "tinggi",
    "high": "tinggi",
    "major": "tinggi",
    "mayor": "tinggi",
    "sedang": "sedang",
    "medium": "sedang",
    "moderate": "sedang",
    "moderat": "sedang",
    "rendah": "rendah",
    "low": "rendah",
    "minor": "rendah",
    "minimal": "rendah",
}


def slugify(value: str) -> str:
    """Slug stabil: huruf kecil, non-alfanumerik -> '-', rapatkan."""
    text = (value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return re.sub(r"-{2,}", "-", text).strip("-")


def checksum(payload: dict) -> str:
    """SHA-256 kanonik (kunci terurut) untuk deteksi perubahan."""
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        parts = re.split(r"[;|,]\s*", value)
        return [p.strip() for p in parts if p.strip()]
    return [str(value).strip()]


def _search_text(*parts: Any) -> str:
    tokens: list[str] = []
    for part in parts:
        if isinstance(part, (list, tuple, set)):
            tokens.extend(str(p).strip() for p in part if str(p).strip())
        elif part:
            tokens.append(str(part).strip())
    # buang duplikat, pertahankan urutan
    seen: set[str] = set()
    out: list[str] = []
    for token in tokens:
        key = token.lower()
        if key not in seen:
            seen.add(key)
            out.append(token)
    return " ".join(out)


def normalize_drug(raw: dict, source_id: str = FORNAS_SOURCE_ID, reviewed: bool = True) -> dict:
    nama = str(raw.get("nama") or raw.get("name") or "").strip()
    inn = str(raw.get("inn") or "").strip() or None
    us_name = str(raw.get("us_name") or "").strip() or None
    slug = slugify(str(raw.get("slug") or nama or inn))
    aliases = _as_list(raw.get("aliases"))
    atc = str(raw.get("atc") or "").strip() or None
    kelas = str(raw.get("kelas") or "").strip() or None
    search_text = _search_text(nama, inn, us_name, aliases, kelas, atc)
    return {
        "slug": slug,
        "nama": nama,
        "inn": inn,
        "us_name": us_name,
        "atc": atc,
        "kelas": kelas,
        "rute": str(raw.get("rute") or "").strip() or None,
        "bentuk_sediaan": str(raw.get("bentuk_sediaan") or "").strip() or None,
        "kekuatan": str(raw.get("kekuatan") or "").strip() or None,
        "status_fornas": bool(raw.get("status_fornas", True)),
        "nie": str(raw.get("nie") or "").strip() or None,
        "aliases": aliases,
        "search_text": search_text,
        "source_id": source_id,
        "reviewed": bool(raw.get("reviewed", reviewed)),
    }


def normalize_interaction(raw: dict, source_id: str = KURASI_SOURCE_ID) -> dict:
    severity_raw = str(raw.get("severity") or raw.get("severitas") or "").strip().lower()
    severity = SEVERITY_MAP.get(severity_raw, "sedang")
    return {
        "a_slug": slugify(str(raw.get("a") or raw.get("a_slug") or "")),
        "b_slug": slugify(str(raw.get("b") or raw.get("b_slug") or "")),
        "severity": severity,
        "mekanisme": str(raw.get("mechanism") or raw.get("mekanisme") or "").strip() or None,
        "saran": str(raw.get("advice") or raw.get("saran") or "").strip() or None,
        "source_id": source_id,
        "reviewed": bool(raw.get("reviewed", False)),
    }


def normalize_monitoring(slug: str, raw: dict, source_id: str = KURASI_SOURCE_ID) -> list[dict]:
    rows: list[dict] = []
    reviewed = bool(raw.get("reviewed", False))
    for item in _as_list(raw.get("monitoring")):
        rows.append(_monitoring_row(slug, item, "umum", None, source_id, reviewed))
    mapping = [
        ("renal", "ginjal", "Penyesuaian ginjal"),
        ("hepatic", "hati", "Penyesuaian hati"),
        ("geriatric", "geriatri", "Pertimbangan geriatri"),
    ]
    for field, kategori, parameter in mapping:
        note = str(raw.get(field) or "").strip()
        if note:
            rows.append(_monitoring_row(slug, parameter, kategori, note, source_id, reviewed))
    for item in _as_list(raw.get("deprescribing")):
        rows.append(_monitoring_row(slug, item, "deprescribing", None, source_id, reviewed))
    return rows


def _monitoring_row(slug: str, parameter: str, kategori: str, catatan, source_id: str, reviewed: bool) -> dict:
    return {
        "drug_slug": slugify(slug),
        "parameter": str(parameter).strip(),
        "kategori": kategori,
        "catatan": catatan,
        "source_id": source_id,
        "reviewed": reviewed,
    }


def key_of(kind: str, record: dict) -> str:
    if kind == "drugs":
        return record["slug"]
    if kind == "interactions":
        return f"{record['a_slug']}+{record['b_slug']}"
    if kind == "monitoring":
        return f"{record['drug_slug']}|{record['kategori']}|{record['parameter']}"
    raise ValueError(f"kind tidak dikenal: {kind}")


def diff(existing: dict[str, str], records: Iterable[dict], kind: str) -> dict[str, list]:
    """Bandingkan checksum record vs yang sudah ada → new/changed/unchanged."""
    new: list[dict] = []
    changed: list[dict] = []
    unchanged: list[dict] = []
    for record in records:
        key = key_of(kind, record)
        stamp = checksum(record)
        current = existing.get(key)
        if current is None:
            new.append(record)
        elif current != stamp:
            changed.append(record)
        else:
            unchanged.append(record)
    return {"new": new, "changed": changed, "unchanged": unchanged}


# ---------------------------------------------------------------------------
# Pembacaan sumber
# ---------------------------------------------------------------------------
def _drug_source(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"edition": data.get("edition", ""), "url": data.get("source_url", ""), "items": data.get("drugs", [])}


def bundled_records(kind: str, functions_dir: Path = FUNCTIONS) -> list[dict]:
    """Seed dari berkas kurasi bawaan (`functions/_*.json`)."""
    if kind == "drugs":
        payload = _drug_source(functions_dir / "_drugs.json")
        return [normalize_drug(item, FORNAS_SOURCE_ID) for item in payload["items"]]
    if kind == "interactions":
        data = json.loads((functions_dir / "_interactions.json").read_text(encoding="utf-8"))
        return [normalize_interaction(item) for item in data.get("pairs", [])]
    if kind == "monitoring":
        data = json.loads((functions_dir / "_monitoring.json").read_text(encoding="utf-8"))
        rows: list[dict] = []
        for slug, entry in (data.get("drugs") or {}).items():
            rows.extend(normalize_monitoring(slug, entry))
        return rows
    raise ValueError(f"kind tidak dikenal: {kind}")


def records_from_json(path: Path, kind: str) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data.get("items") or data.get(kind) or data.get("pairs") or data.get("drugs") or []
    if isinstance(items, dict):  # monitoring berbentuk {slug: {...}}
        rows: list[dict] = []
        for slug, entry in items.items():
            rows.extend(normalize_monitoring(slug, entry))
        return rows
    if kind == "drugs":
        return [normalize_drug(item) for item in items]
    if kind == "interactions":
        return [normalize_interaction(item) for item in items]
    raise ValueError("monitoring JSON harus berbentuk objek {slug: {...}}")


def records_from_csv(path: Path, kind: str) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if kind == "monitoring":
        out: list[dict] = []
        for row in rows:
            slug = row.get("slug") or row.get("drug_slug") or ""
            out.extend(normalize_monitoring(slug, row))
        return out
    if kind == "interactions":
        return [normalize_interaction(row) for row in rows]
    return [normalize_drug(row) for row in rows]


def load_records(path: Path, kind: str) -> list[dict]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return records_from_csv(path, kind)
    if suffix in (".json", ".jsonl"):
        return records_from_json(path, kind)
    raise ValueError(f"format tidak didukung: {path.suffix}")


def fact_source_payloads(functions_dir: Path = FUNCTIONS) -> list[dict]:
    data = _drug_source(functions_dir / "_drugs.json")
    edition = data.get("edition") or ""
    berlaku = None
    match = re.search(r"berlaku\s+(\d{1,2})\s+(\w+)\s+(\d{4})", edition, re.IGNORECASE)
    if match:
        try:
            import calendar

            bulan = list(calendar.month_name).index(match.group(2).capitalize())
            berlaku = f"{match.group(3)}-{bulan:02d}-{int(match.group(1)):02d}"
        except ValueError:
            berlaku = None
    return [
        {
            "id": FORNAS_SOURCE_ID,
            "nama": "Formularium Nasional (Fornas)",
            "pengelola": "Kemenkes RI",
            "edisi": edition,
            "berlaku_dari": berlaku,
            "url": data.get("url") or None,
            "lisensi": "Data pemerintah",
        },
        {
            "id": KURASI_SOURCE_ID,
            "nama": "Kurasi internal bioXip",
            "pengelola": "bioXip",
            "edisi": "1",
            "url": None,
            "lisensi": "Internal",
        },
    ]
