export const DICTIONARY = [
  { id_term: "diabetes", en_terms: '"diabetes" OR "diabetes mellitus" OR "type 2 diabetes"', kind: "disease" },
  { id_term: "kanker paru", en_terms: '"lung cancer" OR "lung neoplasms" OR "non-small cell lung cancer"', kind: "disease" },
  { id_term: "kanker payudara", en_terms: '"breast cancer" OR "breast neoplasms"', kind: "disease" },
  { id_term: "tuberkulosis", en_terms: '"tuberculosis" OR "mycobacterium tuberculosis"', kind: "disease" },
  { id_term: "demam berdarah", en_terms: '"dengue" OR "dengue fever" OR "dengue hemorrhagic fever"', kind: "disease" },
  { id_term: "stunting", en_terms: '"stunting" OR "child growth disorders" OR "malnutrition"', kind: "disease" },
  { id_term: "malaria", en_terms: '"malaria" OR "plasmodium"', kind: "disease" },
  { id_term: "hipertensi", en_terms: '"hypertension" OR "high blood pressure" OR "blood pressure"', kind: "disease" },
  { id_term: "stroke", en_terms: '"stroke" OR "cerebrovascular accident" OR "cerebral infarction"', kind: "disease" },
  { id_term: "hiv", en_terms: '"hiv" OR "human immunodeficiency virus"', kind: "disease" },
  { id_term: "imunisasi", en_terms: '"immunization" OR "vaccination" OR "vaccines"', kind: "intervention" },
  { id_term: "obat", en_terms: '"drug" OR "medication" OR "pharmaceutical"', kind: "intervention" },
  { id_term: "vaksin", en_terms: '"vaccine" OR "vaccination"', kind: "intervention" },
  { id_term: "kehamilan", en_terms: '"pregnancy" OR "antenatal" OR "maternal"', kind: "disease" },
  { id_term: "asi", en_terms: '"breastfeeding" OR "breast milk" OR "lactation"', kind: "intervention" },
  { id_term: "anemia", en_terms: '"anemia" OR "anaemia" OR "iron deficiency"', kind: "disease" },
];

export function expandQuery(raw) {
  const groups = [];
  const query = (raw || "").trim();
  if (!query) return query;
  for (const entry of DICTIONARY) {
    if (query.toLowerCase().includes(entry.id_term)) {
      groups.push(`(${entry.en_terms})`);
    }
  }
  return groups.length ? `(${query}) OR ${groups.join(" OR ")}` : query;
}

export function suggest(prefix) {
  const p = (prefix || "").trim().toLowerCase();
  if (!p) return [];
  return DICTIONARY.filter(
    (e) => e.id_term.startsWith(p) || e.en_terms.toLowerCase().includes(p),
  ).slice(0, 6);
}
