/* Klasifikasi intent ringan (tanpa LLM) + saran pola — window.BIOXIP_INTENT */
(() => {
  const RULES = [
    { type: "safety", re: /nyeri dada|sesak napas|sesak nafas|pingsan|tidak sadar|kejang|perdarahan hebat|muntah darah|stroke|kelemahan satu sisi/i, tag: "tanda-bahaya" },
    { type: "interaction", re: /interaksi|\binteraction\b/i, tag: "interaksi-obat" },
    { type: "dose", re: /\bdosis\b|\bdose\b|penyesuaian dosis/i, tag: "dosis-organ" },
    { type: "availability", re: /fornas|formularium|ketersediaan|ditanggung|bpjs|restriksi/i, tag: "ketersediaan-fornas" },
    { type: "pico", re: /dibanding|\bvs\b|versus|efektivitas|efficacy|luaran|outcome/i, tag: "pico-terapi" },
    { type: "guideline", re: /tatalaksana|panduan|guideline|pedoman|protokol|rekomendasi|pnpk/i, tag: null },
  ];

  const TYPE_TO_TAG = {
    safety: "tanda-bahaya",
    interaction: "interaksi-obat",
    dose: "dosis-organ",
    availability: "ketersediaan-fornas",
    pico: "pico-terapi",
    guideline: "pico-terapi",
    question: "pico-terapi",
    drug: "ketersediaan-fornas",
  };

  function classifyIntent(text) {
    const q = String(text || "").trim();
    if (!q) return { type: "empty", tag: null };
    for (const rule of RULES) {
      if (rule.re && rule.re.test(q)) return { type: rule.type, tag: rule.tag };
    }
    // Kueri pendek tanpa kata tanya → kemungkinan nama obat (dikonfirmasi oleh /api/drug).
    const words = q.split(/\s+/);
    if (words.length <= 2 && /^[a-z0-9\- ]+$/i.test(q) && !/[?]/.test(q)) {
      return { type: "drug", tag: null };
    }
    return { type: "question", tag: null };
  }

  function suggestPatterns(text, limit = 3) {
    const patterns = window.BIOXIP_PATTERNS || [];
    if (!patterns.length) return [];
    const intent = classifyIntent(text);
    const out = [];
    const primary = intent.tag || TYPE_TO_TAG[intent.type];
    const push = (pattern) => {
      if (pattern && !out.includes(pattern) && out.length < limit) out.push(pattern);
    };
    push(patterns.find((p) => p.id === primary));
    if (!out.length && text) {
      // Tanpa sinyal kuat: tampilkan pola sesuai peran umum (fallback ke daftar).
      push(patterns.find((p) => p.id === "pico-terapi"));
    }
    for (const pattern of patterns) push(pattern);
    return out;
  }

  window.BIOXIP_INTENT = { classifyIntent, suggestPatterns };
})();
