from harvester.providers import atc


def test_pick_atc_chooses_most_specific():
    items = [
        {"rxclassMinConceptItem": {"classId": "N02B", "classType": "ATC1-4"}},
        {"rxclassMinConceptItem": {"classId": "N02BE", "classType": "ATC1-4"}},
        {"rxclassMinConceptItem": {"classId": "N02BE01", "classType": "ATC1-4"}},
    ]
    assert atc.pick_atc(items) == "N02BE01"


def test_pick_atc_ignores_non_atc_and_empty():
    assert atc.pick_atc([{"rxclassMinConceptItem": {"classId": "X", "classType": "VA"}}]) is None
    assert atc.pick_atc([]) is None
    assert atc.pick_atc(None) is None


def test_pick_atc_deterministic_tie_break():
    items = [
        {"rxclassMinConceptItem": {"classId": "A10BB", "classType": "ATC1-4"}},
        {"rxclassMinConceptItem": {"classId": "A10BA", "classType": "ATC1-4"}},
    ]
    assert atc.pick_atc(items) == "A10BA"


def test_atc_candidates_order_and_dedup():
    row = {"us_name": "acetaminophen", "inn": "paracetamol", "nama": "Parasetamol", "aliases": ["Parasetamol", "para"]}
    assert atc.atc_candidates(row) == ["acetaminophen", "paracetamol", "Parasetamol", "para"]


def test_atc_candidates_handles_slash_inn_and_string_alias():
    row = {"inn": "sulfamethoxazole/trimethoprim", "aliases": "cotrimoxazole"}
    assert atc.atc_candidates(row) == ["sulfamethoxazole", "cotrimoxazole"]


def test_atc_candidates_empty():
    assert atc.atc_candidates({}) == []
