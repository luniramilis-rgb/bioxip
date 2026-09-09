import re
import uuid

from harvester.models import EpmcHit, TrialRecord
from harvester.normalize import epmc_to_row, trial_to_row


def row_work_group(row: dict) -> uuid.UUID:
    seed = _group_seed(row)
    return uuid.uuid5(uuid.NAMESPACE_URL, f"bioxip:{seed}")


def _group_seed(row: dict) -> str:
    doi = (row.get("doi") or "").lower()
    if doi:
        return f"doi:{doi}"
    title = normalize_title(row.get("title") or "")
    first_author = ""
    authors = row.get("authors") or []
    if authors and authors[0].get("family"):
        first_author = authors[0]["family"].lower()
    return f"t:{title}|a:{first_author}|y:{row.get('year') or ''}"


def normalize_title(title: str) -> str:
    title = re.sub(r"[^a-z0-9 ]+", " ", title.lower())
    title = re.sub(r"\s+", " ", title).strip()
    stop = {
        "the", "a", "an", "of", "and", "in", "on", "for", "with",
        "to", "study", "effect", "effects", "role", "patients", "patient",
    }
    words = [w for w in title.split(" ") if w and w not in stop]
    return " ".join(words)


def finalize(row: dict) -> dict:
    row["work_group"] = str(row_work_group(row))
    row["is_preferred"] = row.get("doc_type") != "preprint"
    return row


def to_rows_epmc(hits: list[EpmcHit]) -> list[dict]:
    return [finalize(epmc_to_row(h)) for h in hits]


def to_rows_trials(records: list[TrialRecord]) -> list[dict]:
    return [finalize(trial_to_row(r)) for r in records]
