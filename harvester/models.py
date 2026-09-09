from datetime import date
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class EpmcHit(BaseModel):
    model_config = {"extra": "ignore"}

    id: Optional[str] = None
    source: Optional[str] = None
    pmid: Optional[str] = None
    pmcid: Optional[str] = None
    doi: Optional[str] = None
    title: Optional[str] = None
    authorString: Optional[str] = None
    authorList: Optional[dict] = None
    journalInfo: Optional[dict] = None
    pubYear: Optional[str] = None
    firstPublicationDate: Optional[str] = None
    abstractText: Optional[str] = None
    isOpenAccess: Optional[str] = None
    inPMC: Optional[str] = None
    fullTextUrlList: Optional[dict] = None
    keywordList: Optional[dict] = None
    citedByCount: Optional[int] = 0
    pubTypeList: Optional[dict] = None
    hasTextMinedTerms: Optional[str] = None

    @property
    def is_preprint(self) -> bool:
        pub_types = (self.pubTypeList or {}).get("pubType", []) or []
        if self.source and self.source.upper() == "PPR":
            return True
        return any("preprint" in (t or "").lower() for t in pub_types)


class TrialRecord(BaseModel):
    model_config = {"extra": "ignore"}

    protocolSection: Optional[dict] = None
    resultsSection: Optional[dict] = None
    derivedSection: Optional[dict] = None
    hasResults: Optional[bool] = False

    @property
    def nct_id(self) -> str:
        ident = (self.protocolSection or {}).get("identificationModule", {})
        return ident.get("nctId", "")

    @property
    def last_update(self) -> Optional[date]:
        status = (self.protocolSection or {}).get("statusModule", {})
        value = status.get("lastUpdatePostDateStruct", {}).get("date")
        return parse_date(value)

    @property
    def study_first_posted(self) -> Optional[date]:
        status = (self.protocolSection or {}).get("statusModule", {})
        value = status.get("studyFirstPostDateStruct", {}).get("date")
        return parse_date(value)


def parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    candidate = value.strip()
    for size in (10, 7, 4):
        try:
            return date.fromisoformat(candidate[:size])
        except ValueError:
            continue
    return None


def parse_epmc_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None
