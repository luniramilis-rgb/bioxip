const PATIENT_DATA = [
  /\b\d{16}\b/, // NIK (16 digit)
  /\b(?:no\.?|nomor)\s*(?:rm|rekam medis|mrn)\b/i, // nomor rekam medis eksplisit
  /\b(?:rm|mrn)\s*[:#]?\s*\d{4,}/i, // penulisan singkat RM: 12345
  /(\+62|62|0)8\d{7,12}\b/, // nomor HP
  /tanggal lahir|tgl\.?\s*lahir|\bdob\b/i,
  /nama pasien|pasien saya bernama/i,
];

const DIAGNOSIS_REQUEST = [
  /(diagnos[ai]s?|menegakkan diagnosa|differential diagnosis)\b.*(pasien|saya|klien)/i,
  /(pasien|saya)\b.*(diagnos[ai]s?|penyakit apa|menderita apa)/i,
  /apa penyakit (saya|pasien)/i,
];

const PRESCRIPTION_REQUEST = [
  /resepkan|beri resep|tulis resep/i,
  /obat apa yang harus (saya|kami) berikan/i,
  /dosis untuk pasien (saya|kami)/i,
  /(berikan|atur) dosis .*(pasien|saya)/i,
];

const RED_FLAGS = [
  /nyeri dada/i,
  /sesak napas|sesak nafas/i,
  /perdarahan hebat|muntah darah|bab berdarah/i,
  /penurunan kesadaran|tidak sadar|pingsan/i,
  /kejang/i,
  /(wajah|bicara) pelo|kelemahan satu sisi|stroke/i,
  /nyeri perut hebat/i,
];

// Flag dari LLM bebas-format: hanya terima frasa pendek dan buang prosa/penjelasan.
export function normalizeRedFlags(flags) {
  if (!Array.isArray(flags)) return [];
  const out = [];
  for (const raw of flags) {
    if (typeof raw !== "string") continue;
    const flag = raw.replace(/\s+/g, " ").trim();
    if (!flag || flag.length > 60) continue;
    if (/[.!?]\s/.test(flag)) continue;
    if (!out.includes(flag)) out.push(flag);
  }
  return out;
}

// Flag keselamatan (deterministik) selalu dipakai; flag LLM hanya menambah, tidak menimpa.
export function mergeRedFlags(safetyFlags, llmFlags) {
  const merged = [];
  for (const flag of safetyFlags || []) {
    if (typeof flag !== "string") continue;
    const clean = flag.replace(/\s+/g, " ").trim();
    if (clean && !merged.includes(clean)) merged.push(clean);
  }
  for (const flag of normalizeRedFlags(llmFlags)) {
    if (!merged.includes(flag)) merged.push(flag);
  }
  return merged;
}

export const SAFETY_CODES = {
  PATIENT_DATA: "patient_data",
  DIAGNOSIS_REQUEST: "diagnosis_request",
  PRESCRIPTION_REQUEST: "prescription_request",
};

export function classifyInput(text) {
  const value = String(text || "");
  if (!value.trim()) return { blocked: false, red_flags: [] };

  for (const pattern of PATIENT_DATA) {
    if (pattern.test(value)) {
      return {
        blocked: true,
        code: SAFETY_CODES.PATIENT_DATA,
        reason:
          "Permintaan memuat data pribadi/pasien. bioXip tidak menerima data pasien — hapus identitas & data pribadi, lalu ajukan pertanyaan klinis umum.",
        red_flags: [],
      };
    }
  }
  for (const pattern of PRESCRIPTION_REQUEST) {
    if (pattern.test(value)) {
      return {
        blocked: true,
        code: SAFETY_CODES.PRESCRIPTION_REQUEST,
        reason:
          "bioXip tidak memberikan perintah peresepan. Ajukan pertanyaan bukti, mis. 'opsi terapi untuk DM tipe 2 dengan CKD menurut bukti terbaru'.",
        red_flags: [],
      };
    }
  }
  for (const pattern of DIAGNOSIS_REQUEST) {
    if (pattern.test(value)) {
      return {
        blocked: true,
        code: SAFETY_CODES.DIAGNOSIS_REQUEST,
        reason:
          "bioXip tidak menegakkan diagnosis pasien. Ajukan pertanyaan bukti, mis. 'bukti akurasi USG untuk diagnosis kolesistitis'.",
        red_flags: [],
      };
    }
  }

  const redFlags = RED_FLAGS.filter((pattern) => pattern.test(value)).map((pattern) => pattern.source);
  return { blocked: false, red_flags: redFlags };
}

export function redFlagNotice() {
  return (
    "Temuan ini menyebut keluhan yang berpotensi gawat. Segera arahkan ke layanan gawat darurat " +
    "atau tenaga kesehatan terdekat; jangan menunda penanganan."
  );
}
