/* Pola pertanyaan siap pakai (preset front-end) — window.BIOXIP_PATTERNS
 * Setiap pola hanya mengisi `q` + parameter yang sudah didukung /api/search.
 * Guardrail: tidak ada pola yang meminta diagnosis atau peresepan; pola "tanda bahaya"
 * mengarahkan ke eskalasi (IGD), bukan daftar diagnosis.
 */
window.BIOXIP_PATTERNS = [
  {
    id: "pico-terapi",
    label: "Bandingkan terapi",
    desc: "Efektivitas intervensi vs pembanding",
    role: "klinis",
    query: "Efektivitas metformin dibanding sulfonilurea pada diabetes tipe 2 untuk menurunkan HbA1c",
    filters: { types: ["paper"] },
  },
  {
    id: "interaksi-obat",
    label: "Cek interaksi obat",
    desc: "Mekanisme + pemantauan klinis",
    role: "farmasi",
    query: "Mekanisme interaksi warfarin dan amiodaron serta pemantauan INR",
    filters: { types: ["paper"] },
  },
  {
    id: "dosis-organ",
    label: "Dosis & fungsi organ",
    desc: "Penyesuaian dosis ginjal/hati",
    role: "farmasi",
    query: "Dosis dan penyesuaian apiksaban pada gangguan ginjal kronik",
    filters: { types: ["paper"] },
  },
  {
    id: "ketersediaan-fornas",
    label: "Ketersediaan Fornas",
    desc: "Status & batasan peresepan",
    role: "farmasi",
    query: "Apakah insulin glargine termasuk Formularium Nasional dan apa batasan peresepannya",
    filters: { indonesia: true },
  },
  {
    id: "tanda-bahaya",
    label: "Tanda bahaya (kapan rujuk)",
    desc: "Arahan eskalasi ke IGD, bukan diagnosis",
    role: "klinis",
    query: "Tanda bahaya nyeri dada yang memerlukan rujukan segera ke IGD",
    filters: { types: ["paper"] },
  },
];

window.BIOXIP_PATTERNS_NOTE =
  "Pola adalah contoh pertanyaan. bioXip tidak mendiagnosis dan tidak meresepkan.";
