"""Pengayaan kode ATC untuk `drug_products` via RxClass (Fase 7).

  python -m harvester.runners.enrich_atc --limit 20     # uji
  python -m harvester.runners.enrich_atc                # semua

Idempoten: hanya mengisi baris yang `atc`-nya masih kosong.
"""

from __future__ import annotations

import time
from typing import Optional

import typer

from harvester.providers import atc
from harvester.store import Store

app = typer.Typer(help="Isi kode ATC dari RxClass (NLM).")


@app.command()
def run(
    limit: int = typer.Option(0, help="Batasi jumlah obat (0 = semua)"),
    sleep: float = typer.Option(0.1, help="Jeda antar permintaan (detik)"),
) -> None:
    store = Store()
    try:
        rows = store.select_rows(
            "drug_products",
            {"select": "slug,nama,inn,us_name,aliases", "atc": "is.null", "order": "slug.asc", "limit": "2000"},
        )
        if limit:
            rows = rows[:limit]
        print(f"obat tanpa ATC: {len(rows)}")
        found = 0
        for index, row in enumerate(rows, 1):
            code: Optional[str] = None
            for candidate in atc.atc_candidates(row):
                try:
                    code = atc.fetch_atc(candidate)
                except Exception as exc:  # jaringan/HTTP → lewati, jangan gagalkan batch
                    print(f"  ! {row['slug']}: {exc}")
                    code = None
                if code:
                    break
                time.sleep(sleep)
            if code:
                store.patch_rows("drug_products", {"slug": f"eq.{row['slug']}"}, {"atc": code})
                found += 1
            if index % 50 == 0:
                print(f"  ... {index}/{len(rows)} (ditemukan {found})")
            time.sleep(sleep)
        print(f"ATC terisi: {found}/{len(rows)}")
    finally:
        store.close()


if __name__ == "__main__":
    app()
