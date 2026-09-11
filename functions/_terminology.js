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
];

export const TERMINOLOGY = [...DICTIONARY, ...EXTRA];

const QUESTION_TYPES = {
  // Urutan penting: jenis paling spesifik lebih dahulu; `therapy` jadi fallback.
  harm: [
    /\b(efek samping|keamanan|toksisitas|adverse (event|effect|reaction)|safety|harm)\b/i,
  ],
  diagnosis: [
    /\b(diagnosis|diagnostik|akurasi|sensitivitas|spesifisitas|skrining|uji|pemeriksaan|accuracy|sensitivity|specificity|screening)\b/i,
    /\b(deteksi|menegakkan|menyingkirkan)\b/i,
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

export function expandTerms(text) {
  const value = String(text || "").toLowerCase();
  const matched = TERMINOLOGY.filter((entry) => value.includes(entry.id_term)).slice(0, 4);
  return {
    entries: matched,
    english: matched.flatMap((entry) => entry.en_terms.replaceAll('"', "").split(" OR ")),
    mesh: matched.flatMap((entry) => entry.mesh || []).slice(0, 5),
  };
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
