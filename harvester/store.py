from datetime import datetime, timezone
from typing import Optional

import httpx

from harvester.config import (
    STORE_ABSTRACTS,
    SUPABASE_SERVICE_ROLE,
    SUPABASE_URL,
    TIMEOUT,
)


class Store:
    def __init__(self, url: str = SUPABASE_URL, key: str = SUPABASE_SERVICE_ROLE):
        if not url or not key:
            raise RuntimeError("SUPABASE_URL dan SUPABASE_SERVICE_ROLE wajib diisi")
        self.base = f"{url}/rest/v1"
        # Kunci API Supabase (secret) BUKAN JWT → hanya header `apikey`.
        self.headers = {
            "apikey": key,
            "Content-Type": "application/json",
        }
        self.client = httpx.Client(timeout=TIMEOUT, headers=self.headers)

    def close(self) -> None:
        self.client.close()

    def upsert_documents(self, rows: list[dict]) -> tuple[int, int]:
        if not rows:
            return 0, 0
        if not STORE_ABSTRACTS:
            rows = [{k: v for k, v in row.items() if k != "abstract"} for row in rows]
        deduped: dict[tuple, dict] = {}
        for row in rows:
            deduped[(row.get("doc_type"), row.get("identity_key"))] = row
        payload = list(deduped.values())
        started = datetime.now(timezone.utc)
        resp = self.client.post(
            f"{self.base}/documents",
            params={"on_conflict": "doc_type,identity_key"},
            headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            json=payload,
        )
        resp.raise_for_status()
        returned = resp.json()
        inserted = 0
        for item in returned:
            created = item.get("created_at")
            if not created:
                continue
            try:
                created_at = datetime.fromisoformat(
                    created.replace("Z", "+00:00")
                )
            except ValueError:
                continue
            if (created_at - started).total_seconds() > -2:
                inserted += 1
        return inserted, len(returned) - inserted

    def start_run(self, provider: str, kind: str, watermark: Optional[str]) -> int:
        resp = self.client.post(
            f"{self.base}/harvest_runs",
            headers={"Prefer": "return=representation"},
            json={
                "provider": provider,
                "kind": kind,
                "watermark": watermark,
                "status": "running",
            },
        )
        resp.raise_for_status()
        return resp.json()[0]["id"]

    def finish_run(
        self,
        run_id: int,
        status: str,
        fetched: int = 0,
        inserted: int = 0,
        updated: int = 0,
        log: Optional[dict] = None,
    ) -> None:
        resp = self.client.patch(
            f"{self.base}/harvest_runs?id=eq.{run_id}",
            json={
                "status": status,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "fetched": fetched,
                "inserted": inserted,
                "updated": updated,
                "log": log or {},
            },
        )
        resp.raise_for_status()

    def get_cursor(self, provider: str) -> dict:
        resp = self.client.get(
            f"{self.base}/provider_cursor",
            params={"provider": f"eq.{provider}"},
        )
        resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else {}

    def set_cursor(self, provider: str, field: str, value: str) -> None:
        data = {"provider": provider, field: value}
        resp = self.client.post(
            f"{self.base}/provider_cursor",
            params={"on_conflict": "provider"},
            headers={"Prefer": "resolution=merge-duplicates"},
            json=data,
        )
        resp.raise_for_status()

    # ------------------------------------------------------------------
    # Formulary (Fase 2): staging dua-fase + publikasi.
    # ------------------------------------------------------------------
    def upsert_rows(
        self,
        table: str,
        rows: list[dict],
        on_conflict: Optional[str] = None,
    ) -> list[dict]:
        if not rows:
            return []
        # PostgREST bulk insert menuntut seluruh objek punya kunci yang sama (PGRST102).
        keys: set[str] = set()
        for row in rows:
            keys.update(row.keys())
        payload = [{key: row.get(key) for key in keys} for row in rows]
        params = {"on_conflict": on_conflict} if on_conflict else None
        resp = self.client.post(
            f"{self.base}/{table}",
            params=params,
            headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()

    def select_rows(self, table: str, params: dict) -> list[dict]:
        resp = self.client.get(f"{self.base}/{table}", params=params)
        resp.raise_for_status()
        return resp.json()

    def patch_rows(self, table: str, params: dict, data: dict) -> list[dict]:
        resp = self.client.patch(
            f"{self.base}/{table}",
            params=params,
            headers={"Prefer": "return=representation"},
            json=data,
        )
        resp.raise_for_status()
        return resp.json()

    def staging_checksums(self, kind: str) -> dict[str, str]:
        """Peta key->checksum dari staging (semua status) untuk diff idempoten.

        Diurutkan `id.desc` dan kunci unik `(kind, slug)` (migrasi 019) menjamin
        satu baris per key; pengurutan membuatnya deterministik bila ada warisan.
        """
        rows = self.select_rows(
            "formulary_staging",
            {"select": "slug,checksum", "kind": f"eq.{kind}", "order": "id.desc"},
        )
        checksums: dict[str, str] = {}
        for row in rows:
            slug = row.get("slug")
            if slug and slug not in checksums:
                checksums[slug] = row.get("checksum")
        return checksums

    def insert_staging(self, rows: list[dict]) -> int:
        """Upsert current-state: `(kind, slug)` unik, status direset ke pending."""
        if not rows:
            return 0
        created = self.upsert_rows("formulary_staging", rows, on_conflict="kind,slug")
        return len(created)

    def approve_staging(self, reviewer: str, only_source_reviewed: bool = True) -> int:
        """Legacy: gate review dihapus 2026-09-11 (lihat migrasi 020). Tidak dipakai runner."""
        params = {"status": "eq.pending"}
        if only_source_reviewed:
            params["payload->>reviewed"] = "eq.true"
        now = datetime.now(timezone.utc).isoformat()
        updated = self.patch_rows(
            "formulary_staging",
            params,
            {"status": "approved", "reviewed_by": reviewer, "reviewed_at": now},
        )
        return len(updated)

    def list_staging(self, status: Optional[str] = None, kind: Optional[str] = None) -> list[dict]:
        params = {"select": "id,kind,slug,payload,checksum", "order": "id.desc"}
        if status:
            params["status"] = f"eq.{status}"
        if kind:
            params["kind"] = f"eq.{kind}"
        return self.select_rows("formulary_staging", params)

    def publish_rows(self, table: str, rows: list[dict], on_conflict: str, reviewer: str) -> int:
        if not rows:
            return 0
        now = datetime.now(timezone.utc).isoformat()
        prepared = []
        for row in rows:
            item = dict(row)
            # Gate review dihapus: publikasi otomatis, provenance yang menyatakan asal.
            item["reviewed"] = True
            item["reviewed_by"] = reviewer or "auto"
            item["reviewed_at"] = now
            item["retrieved_at"] = now
            prepared.append(item)
        created = self.upsert_rows(table, prepared, on_conflict=on_conflict)
        return len(created)

    def get_meta(self, key: str) -> Optional[str]:
        rows = self.select_rows("formulary_meta", {"select": "value", "key": f"eq.{key}"})
        return rows[0]["value"] if rows else None

    def set_meta(self, key: str, value: str) -> None:
        self.upsert_rows(
            "formulary_meta",
            [{"key": key, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()}],
            on_conflict="key",
        )
