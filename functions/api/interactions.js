import { findDrug } from "../_drugs.js";
import curated from "../_interactions.json";

const OPENFDA = "https://api.fda.gov/drug/label.json";
const RXNAV = "https://rxnav.nlm.nih.gov/REST";
const CHEMBL = "https://www.ebi.ac.uk/chembl/api/data";
const TIMEOUT_MS = 9000;
const MAX_DRUGS = 5;

const CLASS_SYNONYMS = {
  ibuprofen: ["nsaid", "nonsteroidal", "non-steroidal", "aines", "anti-inflammatory"],
  warfarin: ["anticoagulant", "antikoagulan"],
  glibenklamid: ["sulfonylurea", "sulfonilurea", "glyburide"],
  kaptopril: ["ace inhibitor", "acei"],
  simvastatin: ["statin"],
  diazepam: ["benzodiazepine", "benzodiazepin"],
  rifampisin: ["rifampin", "rifampicin"],
  kotrimoksazol: ["trimethoprim", "sulfamethoxazole", "sulfonamide"],
  deksametason: ["corticosteroid", "kortikosteroid", "steroid"],
  prednison: ["corticosteroid", "kortikosteroid", "steroid"],
  clopidogrel: ["antiplatelet"],
  metronidazol: ["nitroimidazole"],
  alopurinol: ["xanthine oxidase"],
};

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const raw = (url.searchParams.get("q") || "").trim();
    if (!raw) return json({ error: "param q wajib (mis. metformin + warfarin)" }, 400);

    const names = [...new Set(raw.split(/[+,;]|\bdan\b/i).map((s) => s.trim()).filter(Boolean))].slice(0, MAX_DRUGS);
    if (names.length < 2) {
      return json({ error: "butuh minimal 2 obat, pisahkan dengan + (mis. metformin + warfarin)" }, 400);
    }

    const resolved = await Promise.all(
      names.map(async (name) => {
        const catalogue = findDrug(name);
        const term = catalogue?.inn ? String(catalogue.inn).split("/")[0].trim() : name;
        const [rxcui, chembl, label] = await Promise.all([
          resolveRxcui(term).catch(() => null),
          fetchChembl(term).catch(() => null),
          fetchInteractionsText(catalogue, name).catch(() => null),
        ]);
        return {
          input: name,
          canonical: canonicalId(catalogue, name),
          display: catalogue?.name || rxcui?.name || name,
          catalogue: catalogue ? catalogue.name : null,
          rxcui,
          chembl,
          label,
        };
      }),
    );

    const pairs = matchCurated(resolved);
    const mentions = await collectMentions(resolved);
    const notes = [];
    if (!pairs.length && !mentions.length) {
      notes.push("Tidak ada interaksi pada tabel terkurasi maupun kutipan label untuk kombinasi ini.");
    }

    return json({
      query: raw,
      drugs: resolved,
      pairs,
      mentions,
      notes,
      rxnav_note:
        "RxNav Interaction API (NLM) sudah tidak tersedia. Interaksi diambil dari tabel terkurasi bioXip (menunggu verifikasi apoteker) dan kutipan bagian interaksi pada label openFDA/DailyMed.",
      disclaimer:
        "Pemeriksaan interaksi ini informatif untuk verifikasi profesional; tidak menggantikan penilaian apoteker/dokter dan tidak memuat seluruh interaksi yang mungkin.",
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

function canonicalId(catalogue, name) {
  if (catalogue?.slug) return catalogue.slug;
  return String(name || "").trim().toLowerCase();
}

function matchCurated(resolved) {
  const out = [];
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i];
      const b = resolved[j];
      const found = (curated.pairs || []).find(
        (pair) =>
          (pair.a === a.canonical && pair.b === b.canonical) ||
          (pair.a === b.canonical && pair.b === a.canonical),
      );
      if (found) {
        out.push({
          a: a.display,
          b: b.display,
          severity: found.severity,
          mechanism: found.mechanism,
          advice: found.advice,
          source: found.source,
          reviewed: Boolean(found.reviewed),
        });
      }
    }
  }
  return out;
}

async function collectMentions(resolved) {
  const mentions = [];
  for (const drug of resolved) {
    const text = drug.label?.text || "";
    if (!text) continue;
    for (const other of resolved) {
      if (other === drug) continue;
      const sentences = findSentences(text, searchTerms(other));
      for (const sentence of sentences) {
        mentions.push({
          label_of: drug.display,
          about: other.display,
          quote: sentence,
          source: drug.label.source,
          label_term: drug.label.term,
        });
      }
    }
  }
  return mentions.slice(0, 8);
}

function searchTerms(drug) {
  const catalogue = findDrug(drug.input) || (drug.catalogue ? findDrug(drug.catalogue) : null);
  const base = [
    drug.input,
    catalogue?.name,
    catalogue?.inn,
    ...(catalogue?.aliases || []),
    ...(CLASS_SYNONYMS[drug.canonical] || []),
  ];
  return [...new Set(base.map((t) => String(t || "").toLowerCase()).filter((t) => t.length > 3))];
}

function findSentences(text, terms) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length >= 40 && s.length <= 400);
  const hits = [];
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (terms.some((term) => lower.includes(term))) hits.push(sentence.trim());
    if (hits.length >= 2) break;
  }
  return hits;
}

async function fetchInteractionsText(catalogue, name) {
  const candidates = [
    catalogue?.us_name,
    catalogue?.inn ? String(catalogue.inn).split("/")[0] : null,
    ...(catalogue?.aliases || []),
    name,
  ]
    .map((t) => String(t || "").trim().toLowerCase())
    .filter((t) => /^[a-z][a-z\s-]{2,}$/.test(t));
  for (const candidate of [...new Set(candidates)].slice(0, 3)) {
    for (const field of ["generic_name", "substance_name"]) {
      const search = `openfda.${field}:"${candidate}"`;
      const resp = await fetch(`${OPENFDA}?search=${encodeURIComponent(search)}&limit=5`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const results = data.results || [];
      const texts = [];
      let source = OPENFDA;
      let term = candidate;
      for (const result of results) {
        const value = join(result.drug_interactions);
        if (!value) continue;
        texts.push(value);
        const setid = result.openfda?.spl_set_id?.[0];
        if (setid) source = `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setid}`;
      }
      if (texts.length) return { text: texts.join(" "), source, term, available: true };
    }
  }
  return { text: "", source: OPENFDA, term: null, available: false };
}

async function resolveRxcui(term) {
  const resp = await fetch(
    `${RXNAV}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=3`,
    { signal: AbortSignal.timeout(6000) },
  );
  if (!resp.ok) throw new Error(`rxnav ${resp.status}`);
  const data = await resp.json();
  const best = (data.approximateGroup?.candidate || [])
    .filter((c) => c.rxcui && Number(c.rank || 99) <= 1)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  if (!best) return null;
  return {
    rxcui: String(best.rxcui),
    name: best.name || term,
    score: Number(best.score || 0),
    source: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${best.rxcui}`,
  };
}

async function fetchChembl(term) {
  const resp = await fetch(
    `${CHEMBL}/molecule/search?q=${encodeURIComponent(term)}&format=json&limit=1`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!resp.ok) throw new Error(`chembl ${resp.status}`);
  const data = await resp.json();
  const molecule = data.molecules?.[0];
  if (!molecule) return null;
  const id = molecule.molecule_chembl_id;
  let actions = [];
  try {
    const mechResp = await fetch(
      `${CHEMBL}/mechanism?molecule_chembl_id=${id}&format=json`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (mechResp.ok) {
      const mech = await mechResp.json();
      actions = (mech.mechanisms || []).slice(0, 3).map((m) => ({
        action: m.action_type,
        mechanism: m.mechanism_of_action,
        target: m.target_chembl_id,
      }));
    }
  } catch {
    actions = [];
  }
  return {
    chembl_id: id,
    pref_name: molecule.pref_name,
    actions,
    source: `https://www.ebi.ac.uk/chembl/compound_report_card/${id}/`,
  };
}

function join(value) {
  if (!value) return "";
  const text = Array.isArray(value) ? value.join(" ") : String(value);
  return text.replace(/\s+/g, " ").trim();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
