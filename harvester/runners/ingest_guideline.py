"""Ingest pedoman lokal L1 (farmalkes + WHO GHO + regulasi operator).

  python -m harvester.runners.ingest_guideline --topik tb,dbd,hiv          # dry-run
  python -m harvester.runners.ingest_guideline --topik tb --apply
  python -m harvester.runners.ingest_guideline --topik tb --publish
  # regulasi (opsional): --regulasi-file dokumen.json

Menyimpan ringkasan pendek + pointer; dua fase: staging -> publish.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

from harvester.providers import farmalkes, guideline, regulasi, whogho
from harvester.store import Store

app = typer.Typer(help="Ingest pedoman lokal (L1).")

TOPIC_SEARCH = {
    "tb": "tuberkulosis",
    "dbd": "dengue demam berdarah",
    "hiv": "HIV antiretroviral",
}
KIND = "guideline_rec"


def build_records(topik_list: list[str], sources: set[str], regulasi_file: Optional[Path], limit: int) -> list[dict]:
    records: list[dict] = []
    if "farmalkes" in sources:
        for topik in topik_list:
            records.extend(farmalkes.records(TOPIC_SEARCH.get(topik, topik), topik, per_page=limit or 10))
    if "whogho" in sources:
        names = whogho.fetch_indicator_names()
        for topik in topik_list:
            records.extend(whogho.records(topik, names))
    if "regulasi" in sources and regulasi_file:
        records.extend(regulasi.load_records(regulasi_file))
    # buang duplikat (source_id|topik|locator)
    unique: dict[str, dict] = {}
    for record in records:
        unique[guideline.key_of(record)] = record
    return list(unique.values())


def staging_rows(records: list[dict]) -> list[dict]:
    rows = []
    for record in records:
        rows.append(
            {
                "kind": KIND,
                "slug": guideline.key_of(record),
                "payload": record,
                "checksum": guideline.checksum(record),
                "status": "pending",
                "reviewed_by": None,
                "reviewed_at": None,
            }
        )
    return rows


@app.command()
def run(
    topik: str = typer.Option("tb,dbd,hiv", help="Daftar topik (tb,dbd,hiv)"),
    sources: str = typer.Option("farmalkes,whogho,regulasi", help="Sumber (farmalkes,whogho,regulasi)"),
    regulasi_file: Optional[Path] = typer.Option(None, help="Berkas regulasi (JSON/CSV) dari operator"),
    limit: int = typer.Option(0, help="Batas posting farmalkes per topik (0 = 10)"),
    apply: bool = typer.Option(False, "--apply", help="Tulis ke formulary_staging"),
    publish: bool = typer.Option(False, "--publish", help="Publikasikan staging ke guideline_recs"),
) -> None:
    topik_list = [t.strip().lower() for t in topik.split(",") if t.strip() in guideline.TOPIC_KEYWORDS]
    source_set = {s.strip().lower() for s in sources.split(",") if s.strip()}
    if not topik_list:
        raise typer.BadParameter("tidak ada topik valid (tb,dbd,hiv)")

    records = build_records(topik_list, source_set, regulasi_file, limit)
    errors = guideline.validate_records(records)

    if not (apply or publish):
        per_source: dict[str, int] = {}
        for record in records:
            per_source[record["source_id"]] = per_source.get(record["source_id"], 0) + 1
        print(f"[dry-run] topik={topik_list} total={len(records)} per_sumber={per_source} masalah={len(errors)}")
        for record in records[:3]:
            print(f"    - [{record['topik']}] {record['sumber'] if 'sumber' in record else record['source_id']}: {record['ringkasan'][:80]}")
        for err in errors[:5]:
            print(f"    ! {err}")
        print("Tidak ada perubahan. Tambahkan --apply / --publish.")
        return

    store = Store()
    try:
        if apply:
            created = store.upsert_rows("fact_sources", guideline.fact_source_payloads(), on_conflict="id")
            print(f"fact_sources: {len(created)} baris")
            if errors:
                print(f"DIBATALKAN — {len(errors)} masalah validasi (contoh: {errors[0]})")
                return
            existing = store.staging_checksums(KIND)
            delta = guideline.diff(existing, records)
            inserted = store.insert_staging(staging_rows(delta["new"] + delta["changed"]))
            print(f"staging: baru={len(delta['new'])} berubah={len(delta['changed'])} tetap={len(delta['unchanged'])} -> +{inserted}")
        if publish:
            staged = store.list_staging(kind=KIND)
            rows = []
            for item in staged:
                payload = dict(item.get("payload") or {})
                payload["checksum"] = item.get("checksum")
                rows.append(payload)
            publish_errors = guideline.validate_records(rows)
            if publish_errors:
                print(f"DIBATALKAN — {len(publish_errors)} masalah validasi (contoh: {publish_errors[0]})")
                return
            written = store.publish_guideline(rows)
            current = store.get_meta("dataset_version") or "0"
            try:
                nxt = str(int(current) + 1)
            except ValueError:
                nxt = "1"
            store.set_meta("dataset_version", nxt)
            print(f"publish guideline_recs: {written} baris · dataset_version {current} -> {nxt}")
    finally:
        store.close()


if __name__ == "__main__":
    app()
