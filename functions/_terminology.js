import { DICTIONARY } from "./_dictionary.js";

// Tambahan istilah Indonesia → Inggris + padanan MeSH untuk memperluas recall.
const EXTRA = [
  { id_term: "gagal jantung", en_terms: '"heart failure"', mesh: ["Heart Failure"] },
  { id_term: "asma", en_terms: '"asthma"', mesh: ["Asthma"] },
  { id_term: "ppok", en_terms: '"pulmonary disease, chronic obstructive" OR "COPD"', mesh: ["Pulmonary Disease, Chronic Obstructive"] },
  { id_term: "pneumonia", en_terms: '"pneumonia"', mesh: ["Pneumonia"] },
  { id_term: "diare", en_terms: '"diarrhea"', mesh: ["Diarrhea"] },
  { id_term: "anak", en_terms: '"child" OR "pediatric"', mesh: ["Child"] },
  { id_term: "lansia", en_terms: '"aged" OR "elderly" OR "older adults"', mesh: ["Aged"] },
  { id_term: "kehamilan", en_terms: '"pregnancy"', mesh: ["Pregnancy"] },
  { id_term: "kanker", en_terms: '"neoplasms" OR "cancer"', mesh: ["Neoplasms"] },
  { id_term: "ginjal", en_terms: '"kidney" OR "renal"', mesh: ["Kidney"] },
  { id_term: "hepatitis", en_terms: '"hepatitis"', mesh: ["Hepatitis"] },
  { id_term: "dengue", en_terms: '"dengue"', mesh: ["Dengue"] },
  { id_term: "stroke", en_terms: '"stroke"', mesh: ["Stroke"] },
  { id_term: "obesitas", en_terms: '"obesity"', mesh: ["Obesity"] },
  { id_term: "anemia", en_terms: '"anemia"', mesh: ["Anemia"] },
  { id_term: "gizi", en_terms: '"nutrition" OR "nutritional status"', mesh: ["Nutritional Status"] },
  { id_term: "vaksin", en_terms: '"vaccines" OR "vaccination"', mesh: ["Vaccination"] },
  { id_term: "antibiotik", en_terms: '"anti-bacterial agents" OR "antibiotics"', mesh: ["Anti-Bacterial Agents"] },
  { id_term: "nyeri", en_terms: '"pain"', mesh: ["Pain"] },
  { id_term: "kolesterol", en_terms: '"cholesterol" OR "lipids"', mesh: ["Cholesterol"] },
  { id_term: "kolesistitis", en_terms: '"cholecystitis"', mesh: ["Cholecystitis"] },
  { id_term: "batu empedu", en_terms: '"cholelithiasis" OR "gallstones"', mesh: ["Cholelithiasis"] },
  { id_term: "apendisitis", en_terms: '"appendicitis"', mesh: ["Appendicitis"] },
  { id_term: "usg", en_terms: '"ultrasonography" OR "ultrasound"', mesh: ["Ultrasonography"] },
  { id_term: "ultrasonografi", en_terms: '"ultrasonography" OR "ultrasound"', mesh: ["Ultrasonography"] },
  { id_term: "rontgen", en_terms: '"radiography" OR "x-ray"', mesh: ["Radiography"] },
  { id_term: "ct scan", en_terms: '"tomography, x-ray computed"', mesh: ["Tomography, X-Ray Computed"] },
  { id_term: "mri", en_terms: '"magnetic resonance imaging"', mesh: ["Magnetic Resonance Imaging"] },
  { id_term: "biopsi", en_terms: '"biopsy"', mesh: ["Biopsy"] },
  { id_term: "endoskopi", en_terms: '"endoscopy"', mesh: ["Endoscopy"] },
  { id_term: "infeksi", en_terms: '"infection"', mesh: ["Infections"] },
  { id_term: "sepsis", en_terms: '"sepsis"', mesh: ["Sepsis"] },
  { id_term: "syok", en_terms: '"shock"', mesh: ["Shock"] },
  { id_term: "kejang", en_terms: '"seizures"', mesh: ["Seizures"] },
  { id_term: "alergi", en_terms: '"hypersensitivity" OR "allergy"', mesh: ["Hypersensitivity"] },
  { id_term: "tumor", en_terms: '"neoplasms" OR "tumor"', mesh: ["Neoplasms"] },
  { id_term: "batuk", en_terms: '"cough"', mesh: ["Cough"] },
  { id_term: "demam", en_terms: '"fever"', mesh: ["Fever"] },
  { id_term: "sesak", en_terms: '"dyspnea"', mesh: ["Dyspnea"] },
  { id_term: "mual", en_terms: '"nausea"', mesh: ["Nausea"] },
  { id_term: "kreatinin", en_terms: '"creatinine"', mesh: ["Creatinine"] },
  { id_term: "hemoglobin", en_terms: '"hemoglobin"', mesh: ["Hemoglobin"] },
  { id_term: "trombosit", en_terms: '"blood platelets"', mesh: ["Blood Platelets"] },
  { id_term: "leukemia", en_terms: '"leukemia"', mesh: ["Leukemia"] },
  { id_term: "paru", en_terms: '"lung" OR "pulmonary"', mesh: ["Lung"] },
  { id_term: "hati", en_terms: '"liver" OR "hepatic"', mesh: ["Liver"] },
  { id_term: "jantung", en_terms: '"heart" OR "cardiac"', mesh: ["Heart"] },
  { id_term: "darah", en_terms: '"blood"', mesh: ["Blood"] },
  { id_term: "akurasi", en_terms: '"diagnostic accuracy"', mesh: ["Sensitivity and Specificity"] },
  { id_term: "sensitivitas", en_terms: '"sensitivity and specificity"', mesh: ["Sensitivity and Specificity"] },
  { id_term: "spesifisitas", en_terms: '"sensitivity and specificity"', mesh: ["Sensitivity and Specificity"] },
  // Konsep yang sebelumnya tidak dikenali → query jatuh ke klausa generik/Indonesia.
  { id_term: "resisten obat", en_terms: '"drug resistance" OR "drug-resistant tuberculosis" OR "MDR-TB"', mesh: ["Tuberculosis, Multidrug-Resistant"] },
  { id_term: "mdr", en_terms: '"MDR-TB" OR "multidrug-resistant tuberculosis"', mesh: ["Tuberculosis, Multidrug-Resistant"] },
  { id_term: "sglt2", en_terms: '"SGLT2 inhibitor" OR "sodium-glucose cotransporter 2 inhibitor"', mesh: ["Sodium-Glucose Transporter 2 Inhibitors"] },
  { id_term: "glp-1", en_terms: '"glucagon-like peptide-1 receptor agonist" OR "GLP-1 receptor agonist"', mesh: [] },
  { id_term: "dpp-4", en_terms: '"dipeptidyl peptidase-4 inhibitor" OR "DPP-4 inhibitor"', mesh: [] },
  { id_term: "statin", en_terms: '"hydroxymethylglutaryl-CoA reductase inhibitors" OR "statins"', mesh: ["Hydroxymethylglutaryl-CoA Reductase Inhibitors"] },
  { id_term: "kortikosteroid", en_terms: '"adrenal cortex hormones" OR "corticosteroids"', mesh: ["Adrenal Cortex Hormones"] },
  { id_term: "kesehatan mental", en_terms: '"mental health" OR "mental disorders"', mesh: ["Mental Disorders"] },
  { id_term: "kesehatan ibu", en_terms: '"maternal health" OR "maternal"', mesh: ["Maternal Health"] },
  { id_term: "d-dimer", en_terms: '"fibrin fragment D" OR "D-dimer"', mesh: ["Fibrin Fibrinogen Degradation Products"] },
  { id_term: "trombosis vena", en_terms: '"venous thrombosis" OR "deep vein thrombosis"', mesh: ["Venous Thrombosis"] },
  { id_term: "aktivitas fisik", en_terms: '"exercise" OR "physical activity"', mesh: ["Exercise"] },
  { id_term: "polusi udara", en_terms: '"air pollution" OR "particulate matter"', mesh: ["Air Pollution"] },
  { id_term: "hipoglikemia", en_terms: '"hypoglycemia"', mesh: ["Hypoglycemia"] },
  { id_term: "antiretroviral", en_terms: '"antiretroviral therapy" OR "anti-retroviral agents"', mesh: ["Anti-Retroviral Agents"] },
  { id_term: "nsaid", en_terms: '"anti-inflammatory agents, non-steroidal" OR "NSAID"', mesh: ["Anti-Inflammatory Agents, Non-Steroidal"] },
  { id_term: "rantai dingin", en_terms: '"refrigeration" OR "cold chain"', mesh: [] },
  { id_term: "uji klinis", en_terms: '"clinical trials as topic" OR "clinical trial"', mesh: ["Clinical Trials as Topic"] },
  { id_term: "risiko bias", en_terms: '"bias" OR "risk of bias"', mesh: [] },
  // Aspek yang sebelumnya tidak terpetakan → hasil topikal tapi salah fokus.
  { id_term: "cairan", en_terms: '"fluid therapy" OR "fluid resuscitation" OR "rehydration"', mesh: ["Fluid Therapy"] },
  { id_term: "resusitasi", en_terms: '"resuscitation" OR "fluid resuscitation"', mesh: ["Resuscitation"] },
  { id_term: "penyesuaian dosis", en_terms: '"dose adjustment" OR "dosage adjustment" OR "drug dosage calculations"', mesh: ["Drug Dosage Calculations"] },
  { id_term: "gangguan ginjal", en_terms: '"renal insufficiency" OR "kidney disease"', mesh: ["Renal Insufficiency"] },
  { id_term: "hitung sampel", en_terms: '"sample size" OR "sample size determination"', mesh: ["Sample Size"] },
  { id_term: "besar sampel", en_terms: '"sample size" OR "sample size determination"', mesh: ["Sample Size"] },
  { id_term: "sampel", en_terms: '"sample size" OR "sampling studies"', mesh: ["Sample Size"] },
  { id_term: "dimulai", en_terms: '"initiation" OR "initiated" OR "when to start"', mesh: [] },
  { id_term: "inisiasi", en_terms: '"initiation" OR "when to start"', mesh: [] },
  // Aspek farmakologi/akademik (dipakai item golden yang gagal: d0xx, m1xx, t0xx).
  { id_term: "pemantauan", en_terms: '"drug monitoring" OR "monitoring"', mesh: ["Drug Monitoring"] },
  { id_term: "interaksi obat", en_terms: '"drug interactions"', mesh: ["Drug Interactions"] },
  { id_term: "efek samping", en_terms: '"drug-related side effects and adverse reactions" OR "adverse effects"', mesh: ["Drug-Related Side Effects and Adverse Reactions"] },
  { id_term: "keamanan", en_terms: '"safety" OR "adverse effects"', mesh: [] },
  { id_term: "prognosis", en_terms: '"prognosis"', mesh: ["Prognosis"] },
  { id_term: "luaran", en_terms: '"treatment outcome" OR "prognosis"', mesh: ["Treatment Outcome"] },
  { id_term: "faktor risiko", en_terms: '"risk factors"', mesh: ["Risk Factors"] },
  { id_term: "etiologi", en_terms: '"risk factors" OR "etiology"', mesh: ["Risk Factors"] },
  { id_term: "meta-analisis", en_terms: '"meta-analysis as topic" OR "meta-analysis"', mesh: ["Meta-Analysis as Topic"] },
  { id_term: "heterogenitas", en_terms: '"heterogeneity"', mesh: [] },
  { id_term: "number needed to treat", en_terms: '"numbers needed to treat"', mesh: ["Numbers Needed To Treat"] },
  { id_term: "dosis", en_terms: '"dose" OR "dosage" OR "dose adjustment"', mesh: [] },
  { id_term: "pemeriksaan penunjang", en_terms: '"diagnostic techniques and procedures" OR "diagnostic tests"', mesh: ["Diagnostic Techniques and Procedures"] },
];

export const TERMINOLOGY = [...DICTIONARY, ...EXTRA];

const QUESTION_TYPES = {
  // Urutan penting: jenis paling spesifik lebih dahulu; `therapy` jadi fallback.
  harm: [
    /\b(efek samping|keamanan|toksisitas|adverse (event|effect|reaction)|safety|harm)\b/i,
  ],
  diagnosis: [
    /\b(diagnosis|diagnostik|akurasi|sensitivitas|spesifisitas|skrining|accuracy|sensitivity|specificity|screening)\b/i,
    /\buji (diagnostik|skrining|saring)\b/i,
    /\b(pemeriksaan|deteksi|menegakkan|menyingkirkan)\b/i,
  ],
  prognosis: [/\b(prognosis|luaran|outcome|mortalitas|kematian|kelangsungan hidup|survival|progression)\b/i],
  etiology: [/\b(penyebab|etiologi|faktor risiko|risk factor|kausalitas|causality)\b/i],
  therapy: [
    /\b(terapi|pengobatan|efektivitas|efikasi|manfaat|tatalaksana|treatment|therapy|efficacy|effectiveness|dibanding|vs|versus)\b/i,
    /\b(apakah|apakah lebih|mana yang lebih)\b.*\b(lebih baik|efektif|menurunkan|meningkatkan)\b/i,
  ],
};

export function detectQuestionType(text) {
  const value = String(text || "");
  for (const [type, patterns] of Object.entries(QUESTION_TYPES)) {
    if (patterns.some((pattern) => pattern.test(value))) return type;
  }
  return "therapy";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pencocokan istilah:
 * - Frasa multi-kata dicocokkan sebagai substring.
 * - Istilah ≤3 huruf (mis. "mdr"/"hiv"/"asi") harus utuh sebagai kata, agar tidak
 *   salah tangkap di dalam kata lain ("asisten", "hives").
 * - Istilah lebih panjang: batas depan wajib (mencegah "hati" di "diperhatikan"),
 *   tetapi akhiran Indonesia yang umum diizinkan (mis. "nyerinya", "vaksinasi").
 */
const ID_SUFFIX = "(?:nya|kah|lah|pun|ku|mu|asi|isasi)";
export function containsTerm(text, term) {
  const value = String(text || "").toLowerCase();
  const needle = String(term || "").toLowerCase();
  if (!needle) return false;
  if (needle.includes(" ")) return value.includes(needle);
  if (needle.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, "i").test(value);
  }
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}(?:${ID_SUFFIX})?([^a-z0-9]|$)`, "i").test(value);
}

export function expandTerms(text) {
  const value = String(text || "").toLowerCase();
  const matched = TERMINOLOGY.filter((entry) => containsTerm(value, entry.id_term))
    // istilah lebih panjang (lebih spesifik) didahulukan, maksimum 3 konsep untuk AND
    .sort((a, b) => b.id_term.length - a.id_term.length);
  // Konsep generik (mis. "obat") tidak boleh menjadi klausa tunggal: itu menghasilkan
  // hasil acak (mis. makalah farmasi apa pun). Buang bila ada konsep spesifik; jika
  // hanya generik yang cocok, biarkan kosong agar pencarian memakai query asli.
  const specific = matched.filter((entry) => !entry.generic);
  const entries = (specific.length ? specific : []).slice(0, 3);
  return {
    entries,
    english: [...new Set(entries.flatMap((entry) => entry.en_terms.replaceAll('"', "").split(" OR ")))].slice(0, 10),
    mesh: [...new Set(entries.flatMap((entry) => entry.mesh || []))].slice(0, 5),
  };
}

/**
 * Klausa query Europe PMC: gabungkan konsep dengan AND agar presisi.
 * Contoh: "obat hipertensi" → (drug OR medication …) AND (hypertension OR MESH:"Hypertension").
 */
export function expansionClause(text) {
  const { entries } = expandTerms(text);
  if (!entries.length) return "";
  const seen = new Set();
  const groups = [];
  for (const entry of entries) {
    const parts = [entry.en_terms];
    if (entry.mesh?.length) parts.push(entry.mesh.map((term) => `MESH:"${term}"`).join(" OR "));
    const group = `(${parts.join(" OR ")})`;
    // Konsep yang menghasilkan klausa identik (mis. "faktor risiko" + "etiologi")
    // cukup sekali agar AND tidak kontradiktif/menyempit sia-sia.
    if (seen.has(group)) continue;
    seen.add(group);
    groups.push(group);
  }
  return groups.join(" AND ");
}

/** Teks untuk skoring ranking: pakai konsep paling spesifik saja (mis. penyakit/istilah, bukan "diagnostic accuracy"). */
export function expansionSearchText(text) {
  const { entries } = expandTerms(text);
  if (!entries.length) return String(text || "");
  const primary = entries[0];
  return primary.en_terms.replaceAll('"', "").split(" OR ").concat(primary.mesh || []).join(" ");
}

// Filter Europe PMC sesuai jenis pertanyaan klinis.
export function epmcFilterFor(type) {
  switch (type) {
    case "diagnosis":
      return '(MESH:"Sensitivity and Specificity" OR MESH:"Diagnostic Imaging" OR PUB_TYPE:"validation study")';
    case "prognosis":
      return '(MESH:"Prognosis" OR MESH:"Cohort Studies")';
    case "etiology":
      return '(MESH:"Risk Factors" OR MESH:"Etiology")';
    case "harm":
      return '(MESH:"Drug-Related Side Effects and Adverse Reactions" OR PUB_TYPE:"clinical trial")';
    default:
      return '(PUB_TYPE:"randomized controlled trial" OR PUB_TYPE:"meta-analysis" OR PUB_TYPE:"systematic review")';
  }
}

export function pubmedCategoryFor(type) {
  return ["therapy", "diagnosis", "prognosis", "etiology"].includes(type) ? type : "therapy";
}

export function studyTypeWeight(docType) {
  return { paper: 1, trial: 0.88, preprint: 0.66, local: 0.7 }[docType] ?? 0.6;
}
