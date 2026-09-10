"""Uji live ledger bioXip (butuh: psycopg, httpx, kredensial Supabase, password DB).

Menjalankan: ensure_account → grant → hold → settle → refund, serta memeriksa
idempotency, penolakan saldo kurang, constraint saldo negatif, dan rekonsiliasi.
Membuat user uji lalu menghapusnya (cascade) di akhir.

Contoh:
  set SUPABASE_SERVICE_ROLE=... & set BIOXIP_DB_PASSWORD=... & python scripts/validate_credits_live.py
"""
import json
import os
import sys
import time
import uuid

import httpx
import psycopg

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://nxlcosnksgbuvtiggjpw.supabase.co")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE", "")
DB_PASSWORD = os.getenv("BIOXIP_DB_PASSWORD", "")
PROJECT_REF = os.getenv("BIOXIP_PROJECT_REF", "nxlcosnksgbuvtiggjpw")
MICRO = 1_000_000

if not SERVICE_KEY or not DB_PASSWORD:
    print("Lewati: SUPABASE_SERVICE_ROLE dan BIOXIP_DB_PASSWORD wajib diisi.")
    sys.exit(0)

DB = dict(
    host=f"db.{PROJECT_REF}.supabase.co",
    port=5432,
    dbname="postgres",
    user="postgres",
    password=DB_PASSWORD,
    sslmode="require",
)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, str(detail)))


def create_user():
    email = f"bioxip-test-{int(time.time())}@example.com"
    resp = httpx.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
        json={"email": email, "password": uuid.uuid4().hex + "Aa1!", "email_confirm": True},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["id"], email


def delete_user(user_id):
    httpx.delete(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
        timeout=30,
    )


def set_user(conn, user_id):
    conn.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": user_id}),))
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (user_id,))


def main():
    user_id, email = create_user()
    print("user uji:", email)
    run_key = f"test-topup-{user_id}"
    try:
        with psycopg.connect(**DB, autocommit=True) as conn:
            set_user(conn, user_id)
            check("ensure_account → saldo 0", conn.execute("select fn_credit_ensure_account()").fetchone()[0] == 0)
            granted = conn.execute(
                "select fn_credit_grant(%s, %s, 'topup', %s)", (user_id, 50_000 * MICRO, run_key)
            ).fetchone()[0]
            check("grant topup Rp50.000", granted == 50_000 * MICRO, granted)
            dup = conn.execute(
                "select fn_credit_grant(%s, %s, 'topup', %s)", (user_id, 50_000 * MICRO, run_key)
            ).fetchone()[0]
            check("grant idempotent", dup == granted, dup)

            req = str(uuid.uuid4())
            held = conn.execute("select fn_credit_hold(%s, %s)", (req, 435 * MICRO)).fetchone()[0]
            check("hold Rp435", held == 50_000 * MICRO - 435 * MICRO, held)
            settled = conn.execute("select fn_credit_settle(%s, %s)", (req, 400 * MICRO)).fetchone()[0]
            check("settle Rp400 → refund Rp35", settled == 50_000 * MICRO - 400 * MICRO, settled)
            check(
                "settle idempotent",
                conn.execute("select fn_credit_settle(%s, %s)", (req, 400 * MICRO)).fetchone()[0] == settled,
            )

            req2 = str(uuid.uuid4())
            conn.execute("select fn_credit_hold(%s, %s)", (req2, 600 * MICRO))
            check(
                "refund penuh (gagal provider)",
                conn.execute("select fn_credit_refund(%s)", (req2,)).fetchone()[0] == settled,
            )

            over = None
            try:
                conn.execute("select fn_credit_hold(%s, %s)", (str(uuid.uuid4()), 10 ** 12))
            except Exception as exc:
                over = str(exc)
            check("hold melebihi saldo ditolak", over is not None and "insufficient_balance" in over)

            row = conn.execute(
                "select a.balance_micro_idr, coalesce(sum(l.delta_micro_idr),0) "
                "from credit_accounts a left join credit_ledger l on l.user_id=a.user_id "
                "where a.user_id=%s group by a.balance_micro_idr",
                (user_id,),
            ).fetchone()
            check("rekonsiliasi saldo == ledger", row[0] == row[1], f"cache={row[0]} ledger={row[1]}")
            check(
                "operasi settled+refunded",
                conn.execute(
                    "select count(*) from credit_operations where user_id=%s and state in ('settled','refunded')",
                    (user_id,),
                ).fetchone()[0] == 2,
            )
    finally:
        delete_user(user_id)

    failed = 0
    for name, ok, detail in results:
        if not ok:
            failed += 1
        suffix = f" ({detail})" if detail else ""
        print(f"{'PASS' if ok else 'FAIL'}  {name}{suffix}")
    print("\nALL PASS" if not failed else f"\n{failed} FAILED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
