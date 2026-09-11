import catalogue from "./_drugs.json";

export const FORNAS = {
  edition: catalogue.edition,
  source_url: catalogue.source_url,
};

export const DRUGS = catalogue.drugs;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findDrug(query) {
  const q = normalize(query);
  if (!q) return null;
  const exact = DRUGS.find(
    (drug) =>
      normalize(drug.slug) === q ||
      normalize(drug.name) === q ||
      normalize(drug.inn) === q,
  );
  if (exact) return exact;
  const byAlias = DRUGS.find((drug) =>
    (drug.aliases || []).some((alias) => normalize(alias) === q),
  );
  if (byAlias) return byAlias;
  return (
    DRUGS.find(
      (drug) =>
        normalize(drug.name).includes(q) ||
        normalize(drug.inn).includes(q) ||
        normalize(drug.slug).includes(q) ||
        (drug.aliases || []).some((alias) => normalize(alias).includes(q)),
    ) || null
  );
}

/** Temukan obat yang namanya/alias-nya muncul di dalam teks bebas (mis. kalimat pertanyaan). */
export function findDrugsInText(text, limit = 3) {
  const q = normalize(text);
  if (!q) return [];
  const padded = ` ${q} `;
  return DRUGS.filter((drug) => {
    const candidates = [drug.name, drug.inn, drug.slug, ...(drug.aliases || [])]
      .map((value) => normalize(value))
      .filter((value) => value.length > 3);
    return candidates.some((value) => padded.includes(` ${value} `) || padded.includes(` ${value}`));
  }).slice(0, limit);
}

export function suggestDrugs(query, limit = 5) {
  const q = normalize(query);
  if (!q) return [];
  return DRUGS.filter(
    (drug) =>
      normalize(drug.name).includes(q) ||
      normalize(drug.inn).includes(q) ||
      normalize(drug.slug).includes(q) ||
      (drug.aliases || []).some((alias) => normalize(alias).includes(q)),
  )
    .slice(0, limit)
    .map((drug) => ({ slug: drug.slug, name: drug.name, inn: drug.inn, kelas: drug.kelas }));
}
