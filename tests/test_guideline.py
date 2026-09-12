import json

from harvester.providers import farmalkes, guideline, regulasi, whogho


def test_clean_text_strips_html_and_caps():
    out = guideline.clean_text("<p>Halo <b>dunia</b></p>", 300)
    assert out == "Halo dunia"
    long = guideline.clean_text("kata " * 200, 300)
    assert len(long) <= 300 and long.endswith("…")


def test_topics_for():
    assert guideline.topics_for("Terapi tuberkulosis MDR") == ["tb"]
    assert "dbd" in guideline.topics_for("Kasus demam berdarah meningkat")
    assert "hiv" in guideline.topics_for("Pasien HIV mulai ARV")


def test_normalize_rec_fields():
    rec = guideline.normalize_rec("farmalkes", "regulator", "tb", "<p>x</p>", "posting 2026-01-01", "https://x.test/a", keywords="TB")
    assert rec["source_id"] == "farmalkes" and rec["tier"] == "regulator" and rec["topik"] == "tb"
    assert rec["ringkasan"] == "x"
    assert "tb" in rec["search_text"] and "TB" in rec["search_text"]


def test_checksum_and_diff():
    rec = guideline.normalize_rec("farmalkes", "regulator", "tb", "ringkasan", "hal. 1", "https://x.test/a")
    assert guideline.checksum(rec) == guideline.checksum(dict(rec))
    existing = {guideline.key_of(rec): guideline.checksum(rec)}
    assert guideline.diff(existing, [rec]) == {"new": [], "changed": [], "unchanged": [rec]}
    changed = dict(rec)
    changed["ringkasan"] = "ringkasan baru"
    assert len(guideline.diff(existing, [changed])["changed"]) == 1


def test_validate_records():
    ok = guideline.normalize_rec("farmalkes", "regulator", "tb", "ringkasan", "hal. 1", "https://x.test/a")
    assert guideline.validate_records([ok]) == []
    assert guideline.validate_records([dict(ok, tier="xxx")])
    assert guideline.validate_records([dict(ok, locator="")])
    assert guideline.validate_records([dict(ok, url="http://x.test")])
    assert guideline.validate_records([dict(ok, ringkasan="a" * 301)])


def test_farmalkes_records(monkeypatch):
    posts = [
        {"id": 1, "date": "2026-03-10T16:03:00", "link": "https://farmalkes.kemkes.go.id/2026/03/tb/", "title": {"rendered": "Deteksi Tuberkulosis"}, "content": {"rendered": "<p>Berita tuberkulosis nasional.</p>"}},
        {"id": 2, "date": "2026-03-11T00:00:00", "link": "https://farmalkes.kemkes.go.id/2026/03/umum/", "title": {"rendered": "Berita umum"}, "content": {"rendered": "<p>Tidak relevan.</p>"}},
    ]
    monkeypatch.setattr(farmalkes, "fetch_posts", lambda term, per_page=10: posts)
    recs = farmalkes.records("tuberkulosis", "tb", per_page=3)
    assert len(recs) == 1  # hanya yang relevan topik
    assert recs[0]["source_id"] == "farmalkes" and recs[0]["locator"].startswith("posting 2026-03-10")


def test_whogho_records(monkeypatch):
    monkeypatch.setattr(whogho, "fetch_indonesia", lambda code, timeout=20: {"NumericValue": 301, "TimeDim": 2024})
    recs = whogho.records("tb", {"MDG_0000000020": "Incidence of tuberculosis"})
    assert len(recs) >= 1
    assert recs[0]["tier"] == "epidemiologi" and recs[0]["topik"] == "tb"
    assert "301" in recs[0]["ringkasan"] and recs[0]["url"].startswith("https://ghoapi")
    assert recs[0]["locator"] == "indikator MDG_0000000020"


def test_regulasi_load(tmp_path):
    path = tmp_path / "reg.json"
    path.write_text(
        json.dumps(
            [
                {"judul": "PNPK Tuberkulosis", "nomor": "HK.01", "tahun": "2024", "topik": "tb,hiv", "url": "https://kemkes.go.id/pnpk-tb", "tier": "pnk", "locator": "hal. 10"},
                {"judul": "PNPK TB Anak", "nomor": "HK.02", "topik": "tb", "url": "https://kemkes.go.id/pnpk-tb-anak"},
                {"judul": "Tanpa URL", "topik": "tb"},
            ]
        ),
        encoding="utf-8",
    )
    recs = regulasi.load_records(path)
    assert len(recs) == 3  # satu dokumen dua topik + satu dokumen satu topik
    assert {r["topik"] for r in recs} == {"tb", "hiv"}
    assert all(r["source_id"] == "regulasi" and r["tier"] == "pnk" for r in recs)
    # locator unik per dokumen → tidak saling menimpa pada unique (source_id, topik, locator)
    tb_keys = [guideline.key_of(r) for r in recs if r["topik"] == "tb"]
    assert len(tb_keys) == len(set(tb_keys))


def test_fact_source_payloads():
    ids = {s["id"] for s in guideline.fact_source_payloads()}
    assert {"farmalkes", "whogho", "regulasi"} <= ids
