const SOURCES = [
  {
    id: "europepmc",
    name: "Europe PMC",
    covers: "PubMed, bioRxiv, medRxiv, PMC (full-text open access), preprint",
    url: "https://europepmc.org/",
  },
  {
    id: "clinicaltrials",
    name: "ClinicalTrials.gov",
    covers: "Registry uji klinis global (desain, fase, kondisi, status)",
    url: "https://clinicaltrials.gov/",
  },
  {
    id: "pubchem",
    name: "PubChem",
    covers: "Senyawa kimia (struktur, properti, bioassay) — live lookup",
    url: "https://pubchem.ncbi.nlm.nih.gov/",
  },
  {
    id: "chembl",
    name: "ChEMBL",
    covers: "Molekul bioaktif & bioaktivitas — live lookup",
    url: "https://www.ebi.ac.uk/chembl/",
  },
  {
    id: "opentargets",
    name: "Open Targets",
    covers: "Target-disease association — live lookup",
    url: "https://platform.opentargets.org/",
  },
];

export async function onRequestGet() {
  return json({
    mode: "live",
    note: "bioXip berjalan live: setiap pencarian menjangkau langsung seluruh koleksi upstream tanpa index lokal.",
    sources: SOURCES,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
