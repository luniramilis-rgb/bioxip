from harvester.enrich import apply_enrichment, enrich_dois


async def enrich_documents(rows: list[dict]) -> int:
    dois = sorted({(r.get("doi") or "").lower() for r in rows if r.get("doi")})
    if not dois:
        return 0
    enrichment = await enrich_dois(dois)
    return apply_enrichment(rows, enrichment)
