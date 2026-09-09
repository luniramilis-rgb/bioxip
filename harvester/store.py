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
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
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
