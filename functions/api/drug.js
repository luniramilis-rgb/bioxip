import { findDrug, suggestDrugs, FORNAS } from "../_drugs.js";
import monitoring from "../_monitoring.json";

const OPENFDA = "https://api.fda.gov/drug/label.json";
const PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name";
const CHEMBL = "https://www.ebi.ac.uk/chembl/api/data";
const RXNAV = "https://rxnav.nlm.nih.gov/REST";
const TIMEOUT_MS = 9000;
const MAX_FIELD = 1500;

const LABEL_FIELDS = [
  ["indikasi", "indications_and_usage"],
  ["dosis", "dosage_and_administration"],
  ["kontraindikasi", "contraindications"],
  ["peringatan", "warnings"],
  ["peringatan_blackbox", "boxed_warning"],
  ["interaksi", "drug_interactions"],
  ["kehamilan", "pregnancy"],
  ["menyusui", "nursing_mothers"],
  ["pediatri", "pediatric_use"],
  ["geriatri", "geriatric_use"],
];

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return json({ error: "param q wajib" }, 400);

    let drug = findDrug(q);
    let outsideCatalogue = false;

    const rxnorm = await resolveRxNorm(...rxCandidates(drug, q)).catch(() => null);

    if (!drug) {
      if (rxnorm?.rxcui) {
        drug = {
          slug: `rxnorm-${rxnorm.rxcui}`,
          name: rxnorm.name,
          inn: rxnorm.name,
          atc: null,
          kelas: "Di luar katalog Fornas (hasil normalisasi RxNorm)",
          rute: null,
          aliases: [],
        };
        outsideCatalogue = true;
      } else {
        return json({ matched: false, query: q, suggestions: suggestDrugs(q) });
      }
    }

    const term = String(drug.inn).split("/")[0].trim();
    const [label, chemistry, mechanism] = await Promise.all([
      fetchLabel(drug, rxnorm).catch(() => null),
      fetchChemistry(term).catch(() => null),
      fetchMechanism(term).catch(() => null),
    ]);

    const missing = LABEL_FIELDS.map(([key]) => key).filter(
      (key) => !(label && label.fields && label.fields[key]),
    );

    const blackbox = label?.fields?.peringatan_blackbox || null;

    return json({
      matched: true,
      query: q,
      catalogue: !outsideCatalogue,
      outside_catalogue: outsideCatalogue,
      drug,
      fornas: outsideCatalogue ? null : FORNAS,
      rxnorm,
      retrieved_at: new Date().toISOString(),
      chemistry,
      mechanism,
      monitoring: monitoring.drugs?.[drug.slug] || null,
      monitoring_reviewed: Boolean(monitoring.reviewed),
      label,
      safety: {
        blackbox: Boolean(blackbox),
        blackbox_excerpt: blackbox ? truncate(blackbox.text, 400) : null,
        watchouts: drug.watchouts || [],
        lasa_notes: drug.lasa_notes || [],
        missing_fields: missing,
      },
      disclaimer:
        "Informasi bukti & label untuk referensi profesional; bukan nasihat medis, bukan perintah peresepan. Dosis harus disesuaikan penilaian klinis dan sumber resmi terbaru.",
      notes: [
        "Isi label berasal dari openFDA/DailyMed (bahasa Inggris, apa adanya) dan ditautkan ke sumbernya.",
        "Normalisasi nama obat memakai RxNorm (NLM). Field yang tidak ada di sumber ditandai kosong — tidak dikarang.",
      ],
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

function rxCandidates(drug, q) {
  const list = drug
    ? [drug.us_name, drug.inn, ...(drug.aliases || []), drug.name]
    : [q];
  return [...new Set(list.map((t) => String(t || "").trim()).filter(Boolean))].slice(0, 4);
}

async function resolveRxNorm(...terms) {
  for (const term of terms) {
    const resp = await fetch(
      `${RXNAV}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=3`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!resp.ok) continue;
    const data = await resp.json();
    const candidates = data.approximateGroup?.candidate || [];
    const best = candidates
      .filter((c) => c.rxcui)
      .sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99) || Number(b.score || 0) - Number(a.score || 0))[0];
    if (!best) continue;
    if (Number(best.rank || 99) > 1) continue;
    return {
      rxcui: String(best.rxcui),
      name: best.name || term,
      score: Number(best.score || 0),
      source: `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${best.rxcui}`,
    };
  }
  return null;
}

function labelCandidates(drug, rxnorm) {
  const raw = [rxnorm?.name, drug.us_name, drug.inn, ...(drug.aliases || [])];
  const cleaned = raw
    .map((t) => String(t || "").trim().toLowerCase())
    .filter((t) => /^[a-z][a-z\s-]{2,}$/.test(t));
  return [...new Set(cleaned)].slice(0, 8);
}

async function fetchLabel(drug, rxnorm) {
  const candidates = labelCandidates(drug, rxnorm);
  const attempts = [];
  for (const candidate of candidates) {
    attempts.push(`openfda.generic_name:"${candidate}"`);
    attempts.push(`openfda.substance_name:"${candidate}"`);
  }
  let best = null;
  let matchedTerm = null;
  for (const search of attempts) {
    const resp = await fetch(
      `${OPENFDA}?search=${encodeURIComponent(search)}&limit=10`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!resp.ok) continue;
    const data = await resp.json();
    const results = data.results || [];
    if (!results.length) continue;
    const merged = mergeLabels(results);
    if (!best || Object.keys(merged.fields).length > Object.keys(best.fields).length) {
      best = merged;
      matchedTerm = candidateFrom(search);
    }
    if (Object.keys(best.fields).length >= LABEL_FIELDS.length) break;
  }
  if (best && Object.keys(best.fields).length < LABEL_FIELDS.length && matchedTerm) {
    for (const [key, fdaKey] of LABEL_FIELDS) {
      if (best.fields[key]) continue;
      const search = `openfda.generic_name:"${matchedTerm}" AND _exists_:${fdaKey}`;
      const resp = await fetch(`${OPENFDA}?search=${encodeURIComponent(search)}&limit=3`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if ((data.results || []).length) mergeInto(best, data.results);
      if (Object.keys(best.fields).length >= LABEL_FIELDS.length) break;
    }
  }

  if (!best || Object.keys(best.fields).length === 0) {
    return { available: false, source: OPENFDA, fields: {}, tried: candidates };
  }
  return {
    available: true,
    matched_term: matchedTerm,
    label_count: best.count,
    effective_time: best.effective_time,
    source: best.source,
    source_name: "openFDA / DailyMed drug label",
    lang: "en",
    fields: best.fields,
  };
}

function mergeLabels(results) {
  const merged = { fields: {}, count: results.length, effective_time: null, source: OPENFDA };
  mergeInto(merged, results);
  return merged;
}

function mergeInto(target, results) {
  for (const result of results) {
    const setid = result.openfda?.spl_set_id?.[0];
    const src = setid
      ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setid}`
      : OPENFDA;
    if (result.effective_time && (!target.effective_time || result.effective_time > target.effective_time)) {
      target.effective_time = result.effective_time;
    }
    for (const [key, fdaKey] of LABEL_FIELDS) {
      const value = join(result[fdaKey]);
      if (!value) continue;
      const existing = target.fields[key];
      if (!existing || value.length > existing.text.length) {
        target.fields[key] = buildField(value, src);
        if (key === "indikasi") target.source = src;
      }
    }
  }
  target.count = Math.max(target.count || 0, results.length);
}

function candidateFrom(search) {
  return search.replace(/^openfda\.\w+:"/, "").replace(/"$/, "");
}

function buildField(text, source) {
  const trimmed = text.length > MAX_FIELD;
  return {
    text: trimmed ? text.slice(0, MAX_FIELD).trim() + "…" : text,
    truncated: trimmed,
    source,
    lang: "en",
  };
}

async function fetchChemistry(term) {
  const props = "MolecularFormula,MolecularWeight,IUPACName";
  const resp = await fetch(
    `${PUBCHEM}/${encodeURIComponent(term)}/property/${props}/JSON`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!resp.ok) throw new Error(`pubchem ${resp.status}`);
  const data = await resp.json();
  const item = data.PropertyTable?.Properties?.[0];
  if (!item) throw new Error("pubchem: kosong");
  return {
    cid: item.CID,
    molecular_formula: item.MolecularFormula,
    molecular_weight: item.MolecularWeight,
    iupac_name: item.IUPACName,
    source: `https://pubchem.ncbi.nlm.nih.gov/compound/${item.CID}`,
    source_name: "PubChem",
  };
}

async function fetchMechanism(term) {
  const resp = await fetch(
    `${CHEMBL}/molecule/search?q=${encodeURIComponent(term)}&format=json&limit=1`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!resp.ok) throw new Error(`chembl ${resp.status}`);
  const data = await resp.json();
  const molecule = data.molecules?.[0];
  if (!molecule) throw new Error("chembl: kosong");
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
        target: m.target_chembl_id,
        mechanism: m.mechanism_of_action,
      }));
    }
  } catch {
    actions = [];
  }
  return {
    chembl_id: id,
    pref_name: molecule.pref_name,
    molecule_type: molecule.molecule_type,
    actions,
    source: `https://www.ebi.ac.uk/chembl/compound_report_card/${id}/`,
    source_name: "ChEMBL",
  };
}

function truncate(text, limit) {
  const value = String(text || "").trim();
  return value.length > limit ? value.slice(0, limit).trim() + "…" : value;
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
