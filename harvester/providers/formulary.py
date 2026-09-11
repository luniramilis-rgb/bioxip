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
FORNAS_API_SOURCE_ID = "fornas-api"
KURASI_SOURCE_ID = "kurasi-bioxip"
# Katalog 30 obat adalah SAMPEL kurasi manual, bukan hasil ekstraksi Fornas terverifikasi.
SAMPLE_SOURCE_ID = "kurasi-bioxip-sampel"
FORNAS_API_URL = "https://e-fornas.kemkes.go.id/api/daftar-obat"

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


def _as_items(value: Any) -> list[str]:
    """Pecah daftar frasa bebas (monitoring/deprescribing) TANPA memecah koma.

    Parameter pemantauan sering memuat koma (mis. "Elektrolit (K, Na, Mg)").
    """
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [p.strip() for p in re.split(r"[;|]", value) if p.strip()]
    return [str(value).strip()]


def _as_bool(value: Any, default: bool) -> bool:
    """Boolean eksplisit: `bool("false")` bernilai True — jangan dipakai."""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "ya", "benar"}


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


def normalize_drug(raw: dict, source_id: str = FORNAS_SOURCE_ID, reviewed: bool = True, source_tier: str = "official") -> dict:
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
        "status_fornas": _as_bool(raw.get("status_fornas"), True),
        "nie": str(raw.get("nie") or "").strip() or None,
        "aliases": aliases,
        "search_text": search_text,
        "source_id": source_id,
        "source_tier": source_tier,
        "reviewed": _as_bool(raw.get("reviewed"), reviewed),
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
        "source_tier": "curated",
        "reviewed": _as_bool(raw.get("reviewed"), False),
    }


def normalize_monitoring(slug: str, raw: dict, source_id: str = KURASI_SOURCE_ID) -> list[dict]:
    rows: list[dict] = []
    reviewed = _as_bool(raw.get("reviewed"), False)
    for item in _as_items(raw.get("monitoring")):
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
    for item in _as_items(raw.get("deprescribing")):
        rows.append(_monitoring_row(slug, item, "deprescribing", None, source_id, reviewed))
    return rows


def _monitoring_row(slug: str, parameter: str, kategori: str, catatan, source_id: str, reviewed: bool) -> dict:
    return {
        "drug_slug": slugify(slug),
        "parameter": str(parameter).strip(),
        "kategori": kategori,
        "catatan": catatan,
        "source_id": source_id,
        "source_tier": "curated",
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


def validate_records(kind: str, records: Iterable[dict]) -> list[str]:
    """Validasi otomatis (pengganti review manusia). Kembalikan daftar masalah."""
    errors: list[str] = []
    for record in records:
        if kind == "drugs":
            if not record.get("slug"):
                errors.append("drug tanpa slug")
            elif not record.get("nama"):
                errors.append(f"drug tanpa nama: {record['slug']}")
        elif kind == "interactions":
            a, b = record.get("a_slug"), record.get("b_slug")
            if not a or not b:
                errors.append(f"interaksi tanpa pasangan: {a}+{b}")
            elif a == b:
                errors.append(f"interaksi diri sendiri: {a}")
            if record.get("severity") not in ("tinggi", "sedang", "rendah"):
                errors.append(f"severitas tidak valid: {record.get('severity')}")
        elif kind == "monitoring":
            if not record.get("drug_slug") or not record.get("parameter"):
                errors.append(f"monitoring tidak lengkap: {record.get('drug_slug')}")
        else:
            errors.append(f"kind tidak dikenal: {kind}")
    return errors


# ---------------------------------------------------------------------------
# Pembacaan sumber
# ---------------------------------------------------------------------------
def _drug_source(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    return {"edition": data.get("edition", ""), "url": data.get("source_url", ""), "items": data.get("drugs", [])}


def bundled_records(kind: str, functions_dir: Path = FUNCTIONS) -> list[dict]:
    """Seed dari berkas kurasi bawaan (`functions/_*.json`).

    Catatan provenance: katalog obat bawaan adalah **sampel kurasi manual** yang
    diatribusikan ke Fornas, belum diekstraksi/diverifikasi terhadap edisi resmi.
    Karena itu `reviewed=False` (menunggu apoteker) dan sumbernya `SAMPLE_SOURCE_ID`.
    """
    if kind == "drugs":
        payload = _drug_source(functions_dir / "_drugs.json")
        return [normalize_drug(item, SAMPLE_SOURCE_ID, reviewed=False, source_tier="curated") for item in payload["items"]]
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


# ---------------------------------------------------------------------------
# Sumber resmi: API e-Fornas (dipakai frontend Kemenkes).
# ---------------------------------------------------------------------------
def map_fornas_row(row: dict) -> dict:
    """Peta satu baris API e-Fornas → payload `drug_products` (reviewed=False)."""
    kelas_parts = [row.get("nama_kelas_terapi"), row.get("nama_kelas_terapi_sub1")]
    kelas = " / ".join(part.strip() for part in kelas_parts if part and part.strip()) or None
    rute_parts = [row.get("nama_rute1"), row.get("nama_rute2"), row.get("nama_rute3")]
    rute = ", ".join(part.strip() for part in rute_parts if part and part.strip()) or None
    satuan = str(row.get("satuan") or "").strip()
    kekuatan = str(row.get("kekuatan") or "").strip()
    ukuran = " ".join(p for p in [kekuatan, satuan] if p and p.upper() != "N/A") or None
    inn = str(row.get("nama_obat_internasional") or "").strip() or None
    return normalize_drug(
        {
            "nama": row.get("nama_obat") or "",
            "inn": inn,
            "kelas": kelas,
            "rute": rute,
            "bentuk_sediaan": str(row.get("sediaan") or "").strip() or None,
            "kekuatan": ukuran,
            "aliases": [inn] if inn and inn.lower() != str(row.get("nama_obat") or "").strip().lower() else [],
            "status_fornas": True,
            "reviewed": False,
        },
        source_id=FORNAS_API_SOURCE_ID,
        source_tier="official",
    )


def fetch_fornas_api(url: str = FORNAS_API_URL, timeout: float = 60.0) -> list[dict]:
    """Ambil daftar obat dari API e-Fornas (I/O jaringan)."""
    import httpx

    resp = httpx.get(
        url,
        headers={"user-agent": "bioXip/0.1 (+https://bioxip.pages.dev)"},
        timeout=timeout,
    )
    resp.raise_for_status()
    body = resp.json()
    return body.get("data") or []


def fornas_api_records(url: str = FORNAS_API_URL) -> list[dict]:
    records = [map_fornas_row(row) for row in fetch_fornas_api(url)]
    # buang slug kosong, jaga unik (satu obat bisa punya beberapa sediaan)
    seen: set[str] = set()
    unique: list[dict] = []
    for record in records:
        slug = record["slug"]
        if not slug or slug in seen:
            continue
        seen.add(slug)
        unique.append(record)
    return unique


def _normalize_row(kind: str, row: dict) -> list[dict]:
    """Satu baris (CSV/JSONL) → daftar record ternormalisasi."""
    if kind == "monitoring":
        slug = row.get("slug") or row.get("drug_slug") or ""
        return normalize_monitoring(slug, row)
    if kind == "interactions":
        return [normalize_interaction(row)]
    return [normalize_drug(row)]


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


def records_from_jsonl(path: Path, kind: str) -> list[dict]:
    records: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        records.extend(_normalize_row(kind, json.loads(stripped)))
    return records


def records_from_csv(path: Path, kind: str) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    records: list[dict] = []
    for row in rows:
        records.extend(_normalize_row(kind, row))
    return records


def load_records(path: Path, kind: str) -> list[dict]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return records_from_csv(path, kind)
    if suffix == ".json":
        return records_from_json(path, kind)
    if suffix == ".jsonl":
        return records_from_jsonl(path, kind)
    raise ValueError(f"format tidak didukung: {path.suffix}")


def fact_source_payloads(functions_dir: Path = FUNCTIONS) -> list[dict]:
    return [
        {
            "id": SAMPLE_SOURCE_ID,
            "nama": "Sampel kurasi internal (30 obat generik)",
            "pengelola": "bioXip",
            "edisi": "1",
            "berlaku_dari": None,
            "url": None,
            "lisensi": "Internal",
            "catatan": "Sampel manual; atribusi Fornas BELUM diverifikasi terhadap edisi resmi; menunggu review apoteker.",
        },
        {
            "id": FORNAS_API_SOURCE_ID,
            "nama": "Formularium Nasional (Fornas) — API e-Fornas",
            "pengelola": "Kemenkes RI",
            "edisi": "daftar aktif e-Fornas",
            "berlaku_dari": None,
            "url": FORNAS_API_URL,
            "lisensi": "Data pemerintah (atribusi wajib)",
            "catatan": "Diambil dari endpoint JSON publik e-Fornas; simpan fakta ringkas + tautan, bukan dokumen penuh.",
        },
        {
            "id": KURASI_SOURCE_ID,
            "nama": "Kurasi internal bioXip",
            "pengelola": "bioXip",
            "edisi": "1",
            "berlaku_dari": None,
            "url": None,
            "lisensi": "Internal",
        },
    ]
