"""Ingest formulary dua-fase: staging -> review -> publish.

Contoh:
  # 1) Lihat rencana (tanpa menyentuh DB)
  python -m harvester.runners.ingest_formulary --kind all

  # 2) Tulis ke staging
  python -m harvester.runners.ingest_formulary --kind all --apply

  # 3) Setujui staging yang sumbernya reviewed=true (mis. katalog obat)
  python -m harvester.runners.ingest_formulary --kind all --approve --reviewer "Apoteker X"

  # 4) Publikasikan ke tabel + naikkan dataset_version
  python -m harvester.runners.ingest_formulary --kind all --publish --reviewer "Apoteker X"

Sumber penuh (mis. Fornas lengkap) dapat diberikan lewat --source:
  python -m harvester.runners.ingest_formulary --kind drugs --source fornas_2025.csv --apply
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

from harvester.providers import formulary
from harvester.store import Store

app = typer.Typer(help="Ingest data formulary bioXip (Fase 2).")

TABLE = {
    "drugs": "drug_products",
    "interactions": "drug_interactions",
    "monitoring": "drug_monitoring",
}
CONFLICT = {
    "drugs": "slug",
    "interactions": "a_slug,b_slug",
    "monitoring": "drug_slug,kategori,parameter",
}


def resolve_kinds(kind: str) -> tuple[str, ...]:
    if kind == "all":
        return formulary.KINDS
    if kind not in formulary.KINDS:
        raise typer.BadParameter(f"kind harus salah satu: all|{ '|'.join(formulary.KINDS) }")
    return (kind,)


def load_records(kind: str, source: Optional[Path]) -> list[dict]:
    if source is None:
        return formulary.bundled_records(kind)
    return formulary.load_records(source, kind)


def build_staging_rows(kind: str, records: list[dict]) -> list[dict]:
    rows = []
    for record in records:
        rows.append(
            {
                "kind": kind,
                "slug": formulary.key_of(kind, record),
                "payload": record,
                "checksum": formulary.checksum(record),
                "status": "pending",
            }
        )
    return rows


@app.command()
def run(
    kind: str = typer.Option("all", help="drugs|interactions|monitoring|all"),
    source: Optional[Path] = typer.Option(None, help="Berkas sumber CSV/JSON (wajib bila kind != all)"),
    apply: bool = typer.Option(False, "--apply", help="Tulis ke formulary_staging"),
    approve: bool = typer.Option(False, "--approve", help="Setujui staging (hanya payload reviewed=true)"),
    publish: bool = typer.Option(False, "--publish", help="Publikasikan staging approved ke tabel"),
    reviewer: str = typer.Option("", help="Nama reviewer (jejak audit)"),
    force: bool = typer.Option(False, "--force", help="Setujui semua pending tanpa memandang reviewed"),
) -> None:
    kinds = resolve_kinds(kind)
    if source is not None and len(kinds) != 1:
        raise typer.BadParameter("--source hanya untuk satu --kind")

    datasets = {k: load_records(k, source) for k in kinds}

    if not (apply or approve or publish):
        for k, records in datasets.items():
            print(f"[dry-run] {k}: {len(records)} record")
            for record in records[:3]:
                stamp = formulary.checksum(record)[:12]
                print(f"    - {formulary.key_of(k, record)} (checksum {stamp})")
        print("Tidak ada perubahan. Tambahkan --apply/--approve/--publish untuk mengeksekusi.")
        return

    store = Store()
    try:
        if apply:
            sources = store.upsert_rows("fact_sources", formulary.fact_source_payloads(), on_conflict="id")
            print(f"fact_sources: {len(sources)} baris")
            for k, records in datasets.items():
                existing = store.staging_checksums(k)
                delta = formulary.diff(existing, records, k)
                rows = build_staging_rows(k, delta["new"] + delta["changed"])
                inserted = store.insert_staging(rows)
                print(
                    f"{k}: baru={len(delta['new'])} berubah={len(delta['changed'])} "
                    f"tetap={len(delta['unchanged'])} -> staging +{inserted}"
                )

        if approve:
            count = store.approve_staging(reviewer or "reviewer", only_source_reviewed=not force)
            print(f"approved: {count} baris staging")

        if publish:
            total = 0
            for k in kinds:
                staged = store.list_staging("approved", k)
                rows = []
                for item in staged:
                    payload = dict(item.get("payload") or {})
                    payload["checksum"] = item.get("checksum")
                    rows.append(payload)
                written = store.publish_rows(TABLE[k], rows, CONFLICT[k], reviewer or "reviewer")
                total += written
                print(f"publish {k} -> {TABLE[k]}: {written} baris")
            current = store.get_meta("dataset_version") or "0"
            try:
                nxt = str(int(current) + 1)
            except ValueError:
                nxt = "1"
            store.set_meta("dataset_version", nxt)
            print(f"dataset_version: {current} -> {nxt} (total publish {total})")
    finally:
        store.close()


if __name__ == "__main__":
    app()
