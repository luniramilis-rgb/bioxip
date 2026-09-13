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
    # Sampel manual: menunggu review apoteker, sumber internal (bukan klaim Fornas).
    assert parasetamol["reviewed"] is False
    assert parasetamol["source_id"] == formulary.SAMPLE_SOURCE_ID
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
    sample = sources[formulary.SAMPLE_SOURCE_ID]
    assert "Sampel" in sample["nama"]
    assert "BELUM diverifikasi" in sample["catatan"]
    fornas = sources[formulary.FORNAS_API_SOURCE_ID]
    assert fornas["url"] == formulary.FORNAS_API_URL
    assert fornas["pengelola"] == "Kemenkes RI"


def test_map_fornas_catalog_single_sku():
    row = {
        "id_obat": 556,
        "nama_obat": "bisakodil",
        "nama_obat_internasional": "bisacodyl",
        "nama_kelas_terapi": "OBAT untuk SALURAN CERNA",
        "nama_kelas_terapi_sub1": "KATARTIK",
        "sediaan": "SUPOSITORIA",
        "kekuatan": "10",
        "satuan": "MILIGRAM",
        "nama_rute1": None,
    }
    record = formulary.map_fornas_catalog([row])[0]
    assert record["slug"] == "bisakodil"
    assert record["inn"] == "bisacodyl"
    assert record["kelas"].startswith("OBAT untuk SALURAN CERNA")
    assert record["bentuk_sediaan"] == "SUPOSITORIA"
    assert record["kekuatan"] == "10 MILIGRAM"
    assert record["status_fornas"] is True
    assert record["reviewed"] is False
    assert record["source_id"] == formulary.FORNAS_API_SOURCE_ID
    assert "bisacodyl" in record["search_text"]


def test_map_fornas_catalog_handles_na_satuan():
    record = formulary.map_fornas_catalog(
        [
            {
                "id_obat": 1,
                "nama_obat": "dialisa peritoneal",
                "nama_obat_internasional": "peritoneal dialysis",
                "kekuatan": "",
                "satuan": "N/A",
                "sediaan": "CAIRAN",
            }
        ]
    )[0]
    assert record["kekuatan"] is None
    assert record["slug"] == "dialisa-peritoneal"
    assert record["variants"][0].get("satuan") is None


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


def test_bool_coercion_from_strings():
    # bool("false") bernilai True — harus diparsing eksplisit.
    assert formulary.normalize_drug({"nama": "X", "status_fornas": "false"})["status_fornas"] is False
    assert formulary.normalize_drug({"nama": "Y", "status_fornas": "1"})["status_fornas"] is True
    assert formulary.normalize_interaction({"a": "a", "b": "b", "reviewed": "false"})["reviewed"] is False
    assert formulary.normalize_interaction({"a": "a", "b": "b", "reviewed": "true"})["reviewed"] is True
    rows = formulary.normalize_monitoring("x", {"monitoring": ["gula"], "reviewed": "false"})
    assert all(row["reviewed"] is False for row in rows)


def test_monitoring_keeps_commas():
    rows = formulary.normalize_monitoring("x", {"monitoring": "Elektrolit (K, Na, Mg); Fungsi ginjal"})
    params = [row["parameter"] for row in rows]
    assert "Elektrolit (K, Na, Mg)" in params
    assert "Fungsi ginjal" in params


def test_jsonl_source(tmp_path):
    path = tmp_path / "drugs.jsonl"
    path.write_text(
        '{"nama": "Obat A", "inn": "obatum_a"}\n\n{"nama": "Obat B", "inn": "obatum_b"}\n',
        encoding="utf-8",
    )
    records = formulary.load_records(path, "drugs")
    assert [r["slug"] for r in records] == ["obat-a", "obat-b"]


def test_source_tier():
    drugs = {d["slug"]: d for d in formulary.bundled_records("drugs")}
    assert drugs["parasetamol"]["source_tier"] == "curated"  # sampel manual
    assert formulary.map_fornas_catalog([{"id_obat": 1, "nama_obat": "x", "nama_obat_internasional": "xum"}])[0]["source_tier"] == "official"
    assert formulary.normalize_interaction({"a": "a", "b": "b"})["source_tier"] == "curated"


def test_validate_records():
    assert formulary.validate_records("drugs", [{"slug": "a", "nama": "A"}]) == []
    assert formulary.validate_records("drugs", [{"slug": "", "nama": "A"}])
    assert formulary.validate_records("interactions", [{"a_slug": "a", "b_slug": "b", "severity": "tinggi"}]) == []
    assert formulary.validate_records("interactions", [{"a_slug": "a", "b_slug": "a", "severity": "tinggi"}])
    assert formulary.validate_records("interactions", [{"a_slug": "a", "b_slug": "b", "severity": "x"}])
    assert formulary.validate_records("monitoring", [{"drug_slug": "a", "parameter": "p", "kategori": "umum"}]) == []
    assert formulary.validate_records("monitoring", [{"drug_slug": "", "parameter": ""}])


def _fornas_sku(**overrides):
    row = {
        "id": 1074,
        "id_obat": 556,
        "nama_obat": "bisakodil",
        "nama_obat_internasional": "bisacodyl",
        "kode_sediaan": "SU01",
        "sediaan": "SUPOSITORIA",
        "kekuatan": "10",
        "kode_satuan": "U028",
        "satuan": "MILIGRAM",
        "komposisi": "",
        "fpktp": True,
        "fpktl": True,
        "prb": False,
        "pp": False,
        "oen": True,
        "program": False,
        "kanker": False,
        "rkt0": None,
        "rkt1": None,
        "rkt2": None,
        "rkt3": None,
        "restriksi_obat": None,
        "restriksi_sediaan": None,
        "peresepan_maksimal": "3 sup/kasus.",
        "nama_kelas_terapi": "OBAT untuk SALURAN CERNA",
        "nama_kelas_terapi_sub1": "KATARTIK",
        "nama_kelas_terapi_sub2": None,
        "nama_kelas_terapi_sub3": None,
        "nama_rute1": "ORAL",
        "nama_rute2": None,
        "nama_rute3": None,
    }
    row.update(overrides)
    return row


def test_map_fornas_catalog_groups_variants():
    rows = [
        _fornas_sku(),
        _fornas_sku(id=1075, kode_sediaan="SU01", kekuatan="5"),
        _fornas_sku(id=1076, kode_sediaan="TA06", sediaan="TABLET SALUT", kekuatan="5"),
    ]
    records = formulary.map_fornas_catalog(rows)
    assert len(records) == 1
    record = records[0]
    assert record["slug"] == "bisakodil"
    assert record["fornas_id_obat"] == "556"
    assert record["source_id"] == formulary.FORNAS_API_SOURCE_ID
    assert record["source_tier"] == "official"
    assert record["reviewed"] is False
    assert len(record["variants"]) == 3
    assert {v["sediaan"] for v in record["variants"]} == {"SUPOSITORIA", "TABLET SALUT"}
    assert record["status_fpktp"] is True and record["status_oen"] is True
    assert record["status_prb"] is False and record["status_program"] is False
    assert "KATARTIK" in record["kelas"]
    assert record["peresepan_maksimal"] == "3 sup/kasus."
    assert record["bentuk_sediaan"] and "SUPOSITORIA" in record["bentuk_sediaan"]
    assert record["satuan"] == "MILIGRAM"


def test_map_fornas_catalog_dedupes_identical_skus():
    rows = [_fornas_sku(), _fornas_sku(id=1075)]
    assert len(formulary.map_fornas_catalog(rows)[0]["variants"]) == 1


def test_map_fornas_catalog_restrictions():
    rows = [
        _fornas_sku(
            id_obat=1841,
            nama_obat="isoniazid",
            nama_obat_internasional="isoniazid",
            sediaan="TABLET",
            kode_sediaan="TA01",
            restriksi_sediaan="Dapat digunakan untuk profilaksis TB pada anak.",
            rkt2="Catatan: Disediakan oleh Program Kemenkes.",
            program=True,
        )
    ]
    record = formulary.map_fornas_catalog(rows)[0]
    assert record["status_program"] is True
    assert record["restriksi_sediaan"].startswith("Dapat digunakan")
    assert record["restriksi_kelas"] == ["Catatan: Disediakan oleh Program Kemenkes."]
    variant = record["variants"][0]
    assert variant["restriksi_sediaan"].startswith("Dapat digunakan")
    assert variant["restriksi_kelas"] == ["Catatan: Disediakan oleh Program Kemenkes."]


def test_normalize_drug_catalog_defaults():
    record = formulary.normalize_drug({"nama": "Obat Uji"})
    assert record["variants"] == []
    assert record["restriksi_kelas"] == []
    assert record["status_fpktp"] is False and record["status_kanker"] is False
    assert record["fornas_id_obat"] is None
    assert formulary.validate_records("drugs", [record]) == []


def test_validate_records_rejects_bad_variants():
    assert formulary.validate_records("drugs", [{"slug": "a", "nama": "A", "variants": {"x": 1}}])


def test_preserve_existing_drug_fields_publish_safety():
    from harvester.runners.ingest_formulary import preserve_existing_drug_fields

    class DummyStore:
        def select_rows(self, table, params):
            return [
                {"slug": "metformin", "atc": "A10BA02", "source_id": "kurasi-bioxip-sampel", "source_tier": "curated"},
                {"slug": "obat-baru", "atc": None, "source_id": "fornas-api", "source_tier": "official"},
            ]

    rows = [
        {"slug": "metformin", "atc": None, "source_id": "fornas-api", "source_tier": "official"},
        {"slug": "obat-baru", "atc": None, "source_id": "fornas-api", "source_tier": "official"},
    ]
    kept = preserve_existing_drug_fields(DummyStore(), rows)
    assert kept == 1
    assert rows[0]["atc"] == "A10BA02"
    assert rows[0]["source_id"] == "kurasi-bioxip-sampel"
    assert rows[0]["source_tier"] == "curated"
    assert rows[1]["atc"] is None
    assert rows[1]["source_tier"] == "official"


def test_preserve_existing_drug_fields_survives_select_error():
    from harvester.runners.ingest_formulary import preserve_existing_drug_fields

    class BrokenStore:
        def select_rows(self, table, params):
            raise RuntimeError("db down")

    rows = [{"slug": "x", "atc": None}]
    assert preserve_existing_drug_fields(BrokenStore(), rows) == 0
    assert rows[0]["atc"] is None
