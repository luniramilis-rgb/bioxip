import json

import pytest

from harvester.providers import formulary


def test_bundled_counts():
    drugs = formulary.bundled_records("drugs")
    interactions = formulary.bundled_records("interactions")
    monitoring = formulary.bundled_records("monitoring")
    assert len(drugs) == 30
    assert len(interactions) == 15
    assert len(monitoring) >= 90  # tiap obat punya beberapa parameter


def test_drug_normalization_fields():
    drugs = {d["slug"]: d for d in formulary.bundled_records("drugs")}
    parasetamol = drugs["parasetamol"]
    assert parasetamol["nama"] == "Parasetamol"
    assert parasetamol["inn"] == "paracetamol"
    assert parasetamol["atc"] == "N02BE01"
    assert parasetamol["status_fornas"] is True
    assert parasetamol["reviewed"] is True
    assert "acetaminophen" in parasetamol["search_text"]
    assert "N02BE01" in parasetamol["search_text"]
    assert parasetamol["aliases"]


def test_slug_unique():
    slugs = [d["slug"] for d in formulary.bundled_records("drugs")]
    assert len(slugs) == len(set(slugs))


def test_checksum_stable_and_sensitive():
    record = formulary.bundled_records("drugs")[0]
    assert formulary.checksum(record) == formulary.checksum(dict(record))
    changed = dict(record)
    changed["kelas"] = (changed.get("kelas") or "") + " (uji)"
    assert formulary.checksum(changed) != formulary.checksum(record)


def test_diff_new_changed_unchanged():
    records = formulary.bundled_records("drugs")
    existing = {formulary.key_of("drugs", r): formulary.checksum(r) for r in records}
    assert formulary.diff(existing, records, "drugs") == {"new": [], "changed": [], "unchanged": records}

    first = records[0]
    modified = dict(first)
    modified["status_fornas"] = not first["status_fornas"]
    result = formulary.diff(existing, [modified], "drugs")
    assert len(result["changed"]) == 1 and not result["new"] and not result["unchanged"]

    result_new = formulary.diff(existing, [{"slug": "obat-baru", "nama": "Obat Baru", "search_text": "obat baru", "status_fornas": True}], "drugs")
    assert len(result_new["new"]) == 1


def test_severity_mapping():
    assert formulary.normalize_interaction({"a": "a", "b": "b", "severity": "major"})["severity"] == "tinggi"
    assert formulary.normalize_interaction({"a": "a", "b": "b", "severity": "MODERATE"})["severity"] == "sedang"
    assert formulary.normalize_interaction({"a": "a", "b": "b", "severity": "low"})["severity"] == "rendah"
    assert formulary.normalize_interaction({"a": "a", "b": "b", "severity": ""})["severity"] == "sedang"


def test_interaction_pairs_and_reviewed_flag():
    pairs = formulary.bundled_records("interactions")
    sample = pairs[0]
    assert sample["a_slug"] and sample["b_slug"] and sample["severity"] in ("tinggi", "sedang", "rendah")
    assert sample["reviewed"] is False  # menunggu review apoteker (two-phase)


def test_monitoring_kategori():
    rows = formulary.bundled_records("monitoring")
    kategori = {row["kategori"] for row in rows}
    assert "umum" in kategori
    assert kategori <= {"umum", "ginjal", "hati", "geriatri", "deprescribing"}
    for row in rows:
        assert row["drug_slug"] and row["parameter"]
        assert row["reviewed"] is False


def test_key_of_monitoring():
    row = {"drug_slug": "metformin", "kategori": "umum", "parameter": "eGFR"}
    assert formulary.key_of("monitoring", row) == "metformin|umum|eGFR"


def test_fact_source_payloads():
    sources = {s["id"]: s for s in formulary.fact_source_payloads()}
    fornas = sources[formulary.FORNAS_SOURCE_ID]
    assert "Fornas" in fornas["nama"]
    assert fornas["edisi"].startswith("KMK")
    assert fornas["berlaku_dari"] == "2026-04-01"


def test_csv_source(tmp_path):
    csv_path = tmp_path / "drugs.csv"
    csv_path.write_text(
        "slug,nama,inn,atc,kelas,aliases\n"
        'uji-obat,Uji Obat,ujiobatum,J01XX99,Antibiotik uji,"ujiobatum;obat uji"\n',
        encoding="utf-8",
    )
    records = formulary.load_records(csv_path, "drugs")
    assert len(records) == 1
    record = records[0]
    assert record["slug"] == "uji-obat"
    assert record["inn"] == "ujiobatum"
    assert "obat uji" in record["search_text"]


def test_json_source(tmp_path):
    data = {"items": [{"nama": "Obat JSON", "inn": "jsonum", "atc": "X01AA01", "aliases": ["jsonum"]}]}
    path = tmp_path / "drugs.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    records = formulary.load_records(path, "drugs")
    assert records[0]["slug"] == "obat-json"
    assert records[0]["status_fornas"] is True


def test_unsupported_format(tmp_path):
    path = tmp_path / "drugs.txt"
    path.write_text("x", encoding="utf-8")
    with pytest.raises(ValueError):
        formulary.load_records(path, "drugs")
