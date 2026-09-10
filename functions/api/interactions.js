import { findDrug } from "../_drugs.js";

const RXNAV = "https://rxnav.nlm.nih.gov/REST";
const CHEMBL = "https://www.ebi.ac.uk/chembl/api/data";
const TIMEOUT_MS = 9000;
const MAX_DRUGS = 5;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const raw = (url.searchParams.get("q") || "").trim();
    if (!raw) return json({ error: "param q wajib (mis. metformin + warfarin)" }, 400);

    const names = [...new Set(raw.split(/[+,;]|\bdan\b/i).map((s) => s.trim()).filter(Boolean))].slice(
      0,
      MAX_DRUGS,
    );
    if (names.length < 2) {
      return json({ error: "butuh minimal 2 obat, pisahkan dengan + (mis. metformin + warfarin)" }, 400);
    }

    const resolved = await Promise.all(
      names.map(async (name) => {
        const catalogue = findDrug(name);
        const term = catalogue?.inn ? String(catalogue.inn).split("/")[0].trim() : name;
        const rxcui = await resolveRxcui(term).catch(() => null);
        const chembl = await fetchChembl(term).catch(() => null);
        return {
          input: name,
          term_used: term,
          catalogue: catalogue ? catalogue.name : null,
          rxcui,
          chembl,
        };
      }),
    );

    const matched = resolved.filter((item) => item.rxcui?.rxcui);
    const unresolved = resolved.filter((item) => !item.rxcui?.rxcui).map((item) => item.input);

    let pairs = [];
    const notes = [];
    if (unresolved.length) notes.push(`Tidak terpetakan di RxNorm: ${unresolved.join(", ")}`);

    if (matched.length >= 2) {
      const rxcuis = matched.map((item) => item.rxcui.rxcui).join("+");
      const resp = await fetch(`${RXNAV}/interaction/list.json?rxcuis=${rxcuis}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (resp.ok) {
        const data = await resp.json();
        pairs = parseInteractions(data);
      } else {
        notes.push(`RxNav interaction ${resp.status}`);
      }
    }

    return json({
      query: raw,
      drugs: resolved,
      pairs,
      notes,
      disclaimer:
        "Pemeriksaan interaksi ini bersifat informatif untuk verifikasi profesional; sumber dapat berbeda (label, basis interaksi) dan tidak menggantikan penilaian apoteker/dokter.",
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

function parseInteractions(data) {
  const out = [];
  for (const group of data.interactionTypeGroup || []) {
    for (const type of group.interactionType || []) {
      for (const pair of type.interactionPair || []) {
        const concepts = (pair.interactionConcept || []).map(
          (c) => c.minConceptItem?.name || c.sourceConceptItem?.name || "",
        );
        out.push({
          a: concepts[0] || "",
          b: concepts[1] || "",
          severity: pair.severity || "unknown",
          description: pair.description || "",
          source: group.sourceName || type.sourceName || "RxNav",
        });
      }
    }
  }
  return out;
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
