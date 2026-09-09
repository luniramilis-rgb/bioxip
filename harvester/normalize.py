import re
from datetime import date, datetime
from typing import Any, Optional

from harvester.models import EpmcHit, TrialRecord, parse_date, parse_epmc_date

INDONESIA_RE = re.compile(
    r"\b(indonesia|indonesian)\b",
    re.IGNORECASE,
)


def _get(data: Any, path: str, default: Any = None) -> Any:
    cur = data
    for key in path.split("."):
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
        if cur is None:
            return default
    return cur


def _authors_epmc(hit: EpmcHit) -> list[dict]:
    out: list[dict] = []
    for author in _get(hit.authorList, "author", []) or []:
        full = author.get("fullName")
        if not full:
            continue
        parts = full.rsplit(" ", 1)
        out.append({"given": parts[0], "family": parts[-1] if len(parts) > 1 else ""})
    return out


def _oa_epmc(hit: EpmcHit) -> dict:
    is_oa = (hit.isOpenAccess or "").upper() == "Y"
    pdf_url = None
    for u in _get(hit.fullTextUrlList, "urls", []) or []:
        if str(u.get("documentStyle", "")).lower() in ("pdf", "oa"):
            pdf_url = u.get("url")
            break
    return {"is_oa": is_oa, "pdf_url": pdf_url, "license": None, "provider": "europepmc"}


def _text_has_indonesia(hit: EpmcHit) -> bool:
    text = " ".join(
        x for x in [hit.title, hit.abstractText, hit.authorString] if x
    )
    return bool(INDONESIA_RE.search(text))


def epmc_to_row(hit: EpmcHit) -> dict:
    doi = (hit.doi or "").lower()
    external = {
        "pmid": hit.pmid,
        "pmcid": hit.pmcid,
        "doi": hit.doi,
    }
    if doi:
        identity = f"doi:{doi}"
    elif hit.pmid:
        identity = f"pmid:{hit.pmid}"
    else:
        identity = f"epmc:{hit.source}:{hit.id}"

    first_pub = parse_epmc_date(hit.firstPublicationDate)
    year = first_pub.year if first_pub else _int(hit.pubYear)

    keywords = [k.lower() for k in (_get(hit.keywordList, "keyword", []) or [])]

    landing = (
        f"https://europepmc.org/article/{hit.source}/{hit.id}"
        if hit.source and hit.id
        else (f"https://doi.org/{hit.doi}" if hit.doi else None)
    )

    meta = {
        "epmc_source": hit.source,
        "pub_types": _get(hit.pubTypeList, "pubType", []) or [],
        "indonesia": _text_has_indonesia(hit),
    }

    return {
        "doc_type": "preprint" if hit.is_preprint else "paper",
        "identity_key": identity,
        "title": (hit.title or "").strip(),
        "abstract": hit.abstractText,
        "authors": _authors_epmc(hit),
        "journal": _get(hit.journalInfo, "journal.title"),
        "issn": _get(hit.journalInfo, "issn"),
        "year": year,
        "published_on": first_pub.isoformat() if first_pub else None,
        "doi": hit.doi,
        "url": landing,
        "external_ids": external,
        "keywords": keywords,
        "tags_text": " ".join(keywords),
        "lang": "en",
        "oa": _oa_epmc(hit),
        "citation_count": int(hit.citedByCount or 0),
        "meta": meta,
        "source": "europepmc",
    }


def trial_to_row(rec: TrialRecord) -> dict:
    nct = rec.nct_id
    proto = rec.protocolSection or {}
    ident = proto.get("identificationModule", {})
    status = proto.get("statusModule", {})
    design = proto.get("designModule", {})
    cond = proto.get("conditionsModule", {})
    desc = proto.get("descriptionModule", {})
    sponsor = proto.get("sponsorCollaboratorsModule", {})

    phase = _get(design, "phases", []) or []
    conditions = cond.get("conditions", []) or []
    keywords = cond.get("keywords", []) or []
    enrollment = _get(design, "enrollmentInfo.count", 0)
    posted = parse_date(_get(status, "studyFirstPostDateStruct.date"))
    year = posted.year if posted else None
    keyword_list = [k.lower() for k in conditions + keywords]

    meta = {
        "nct_id": nct,
        "phase": phase,
        "status": status.get("overallStatus"),
        "conditions": conditions,
        "enrollment": enrollment,
        "sponsor": _get(sponsor, "leadSponsor.name"),
        "indonesia": _trial_has_indonesia(proto),
    }

    return {
        "doc_type": "trial",
        "identity_key": f"nct:{nct}",
        "title": (ident.get("briefTitle") or "").strip(),
        "abstract": _get(desc, "briefSummary", ""),
        "authors": [],
        "journal": None,
        "issn": None,
        "year": year,
        "published_on": posted.isoformat() if posted else None,
        "doi": None,
        "url": f"https://clinicaltrials.gov/study/{nct}",
        "external_ids": {"nctid": nct},
        "keywords": keyword_list,
        "tags_text": " ".join(keyword_list),
        "lang": "en",
        "oa": {},
        "citation_count": 0,
        "meta": meta,
        "source": "clinicaltrials",
    }


def _trial_has_indonesia(proto: dict) -> bool:
    text = " ".join(
        str(x)
        for x in [
            _get(proto, "conditionsModule.conditions", []),
            _get(proto, "descriptionModule.briefSummary", ""),
            _get(proto, "identificationModule.briefTitle", ""),
        ]
    )
    return bool(INDONESIA_RE.search(text))


def _int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
