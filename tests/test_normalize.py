from datetime import date

from harvester.dedupe import to_rows_epmc, to_rows_trials
from harvester.models import EpmcHit, TrialRecord


def epmc_hit(**overrides):
    base = {
        "id": "12345678",
        "source": "MED",
        "pmid": "31234567",
        "doi": "10.1000/XYZ.123",
        "title": "Metformin for diabetes mellitus",
        "authorString": "Zhang L, Kumar A",
        "authorList": {"author": [{"fullName": "Li Zhang"}, {"fullName": "Arun Kumar"}]},
        "journalInfo": {
            "journal": {"title": "Diabetes Care"},
            "issn": "0149-5992",
        },
        "pubYear": "2023",
        "firstPublicationDate": "2023-05-01",
        "abstractText": "Metformin improves glycemic control in diabetes mellitus.",
        "isOpenAccess": "Y",
        "inPMC": "PMC1234567",
        "citedByCount": 42,
        "pubTypeList": {"pubType": ["research-article", "journal article"]},
    }
    base.update(overrides)
    return base


def preprint_hit(**overrides):
    return epmc_hit(
        id="PPR9876",
        source="PPR",
        pmid=None,
        doi="10.1101/2023.05.01.123456",
        title="Metformin for diabetes mellitus (preprint)",
        journalInfo={},
        isOpenAccess="Y",
        pubTypeList={"pubType": ["preprint"]},
        **overrides,
    )


def trial_record(**overrides):
    base = {
        "protocolSection": {
            "identificationModule": {
                "nctId": "NCT04567890",
                "briefTitle": "Metformin in type 2 diabetes",
            },
            "statusModule": {
                "overallStatus": "RECRUITING",
                "studyFirstPostDateStruct": {"date": "2022-01-15"},
                "lastUpdatePostDateStruct": {"date": "2024-02-01"},
            },
            "designModule": {
                "phases": ["PHASE3"],
                "enrollmentInfo": {"count": 800},
            },
            "conditionsModule": {
                "conditions": ["Diabetes Mellitus, Type 2"],
                "keywords": ["metformin"],
            },
            "descriptionModule": {
                "briefSummary": "Randomized trial of metformin in type 2 diabetes.",
            },
            "sponsorCollaboratorsModule": {"leadSponsor": {"name": "BioXip Pharma"}},
        },
        "hasResults": False,
    }
    base["protocolSection"].update(overrides)
    return base


def test_epmc_to_paper_row():
    rows = to_rows_epmc([EpmcHit(**epmc_hit())])
    assert len(rows) == 1
    row = rows[0]
    assert row["doc_type"] == "paper"
    assert row["identity_key"] == "doi:10.1000/xyz.123"
    assert row["year"] == 2023
    assert row["published_on"] == "2023-05-01"
    assert row["source"] == "europepmc"
    assert row["oa"]["is_oa"] is True
    assert row["work_group"]
    assert row["is_preferred"] is True


def test_epmc_preprint_row():
    row = to_rows_epmc([EpmcHit(**preprint_hit())])[0]
    assert row["doc_type"] == "preprint"
    assert row["is_preferred"] is False
    assert row["identity_key"].startswith("doi:")


def test_trial_row():
    rows = to_rows_trials([TrialRecord(**trial_record())])
    row = rows[0]
    assert row["doc_type"] == "trial"
    assert row["identity_key"] == "nct:NCT04567890"
    assert row["published_on"] == "2022-01-15"
    assert row["meta"]["phase"] == ["PHASE3"]
    assert "metformin" in row["keywords"]
    assert row["url"].startswith("https://clinicaltrials.gov/study/")


def test_normalize_title():
    from harvester.dedupe import normalize_title

    assert normalize_title("A Study of the Effects of Metformin in Patients") == "metformin"
    assert normalize_title("Metformin") == "metformin"


def test_published_on_optional():
    row = to_rows_epmc([EpmcHit(**epmc_hit(firstPublicationDate=None))])[0]
    assert row["published_on"] is None
