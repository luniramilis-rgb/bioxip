import { findDrug, suggestDrugs, FORNAS } from "../_drugs.js";

const OPENFDA = "https://api.fda.gov/drug/label.json";
const PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name";
const CHEMBL = "https://www.ebi.ac.uk/chembl/api/data";
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

    const drug = findDrug(q);
    if (!drug) {
      return json({ matched: false, query: q, suggestions: suggestDrugs(q) });
    }

    const term = String(drug.inn).split("/")[0].trim();
    const [label, chemistry, mechanism] = await Promise.all([
      fetchLabel(term).catch(() => null),
      fetchChemistry(term).catch(() => null),
      fetchMechanism(term).catch(() => null),
    ]);

    return json({
      matched: true,
      query: q,
      drug,
      fornas: FORNAS,
      retrieved_at: new Date().toISOString(),
      chemistry,
      mechanism,
      label,
      disclaimer:
        "Informasi bukti & label untuk referensi profesional; bukan nasihat medis, bukan perintah peresepan. Dosis harus disesuaikan penilaian klinis dan sumber resmi terbaru.",
      notes: [
        "Isi label berasal dari openFDA/DailyMed (bahasa Inggris, apa adanya) dan ditautkan ke sumbernya.",
        "Field yang tidak ada di sumber ditandai kosong — tidak dikarang.",
      ],
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

async function fetchLabel(term) {
  const attempts = [
    `openfda.generic_name:"${term}"`,
    `openfda.substance_name:"${term}"`,
    `openfda.brand_name:"${term}"`,
  ];
  for (const search of attempts) {
    const resp = await fetch(
      `${OPENFDA}?search=${encodeURIComponent(search)}&limit=1`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!resp.ok) continue;
    const data = await resp.json();
    const result = data.results?.[0];
    if (!result) continue;
    const source = result.openfda?.spl_set_id?.[0]
      ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${result.openfda.spl_set_id[0]}`
      : `${OPENFDA}?search=${encodeURIComponent(search)}`;
    const fields = {};
    for (const [key, fdaKey] of LABEL_FIELDS) {
      const value = join(result[fdaKey]);
      if (value) fields[key] = buildField(value, source);
    }
    return {
      available: Object.keys(fields).length > 0,
      effective_time: result.effective_time || null,
      source,
      source_name: "openFDA / DailyMed drug label",
      lang: "en",
      fields,
    };
  }
  return { available: false, source: OPENFDA, fields: {} };
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
