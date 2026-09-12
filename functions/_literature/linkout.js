/**
 * Link-out ke sumber Indonesia tanpa API publik (tidak di-scrape, hanya tautan).
 * OneSearch (Perpusnas) terverifikasi 200. Garuda TIDAK disertakan default karena
 * URL pencariannya belum terverifikasi — aktifkan lewat env `GARUDA_SEARCH_URL`
 * (template prefix) bila sudah dipastikan.
 */
export function linkoutEntries(query, env = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  const entries = [
    {
      id: `linkout|onesearch|${q.toLowerCase()}`,
      doc_type: "link",
      linkout: true,
      title: `Cari "${q}" di Indonesia OneSearch (Perpusnas)`,
      authors: [],
      journal: null,
      year: null,
      published_on: null,
      doi: null,
      url: `https://onesearch.id/Search/Results?lookfor=${enc}`,
      source: "onesearch",
      oa: { is_oa: false, provider: "onesearch" },
      citation_count: 0,
      external_ids: {},
      abstract: "",
    },
  ];
  // BPOM CekBPOM (aturan/izin edar) — link-out ke portal resmi (root terverifikasi).
  entries.push({
    id: `linkout|bpom|${q.toLowerCase()}`,
    doc_type: "link",
    linkout: true,
    title: `Cek izin edar/registrasi produk di BPOM (CekBPOM)`,
    authors: [],
    journal: null,
    year: null,
    published_on: null,
    doi: null,
    url: "https://cekbpom.pom.go.id/",
    source: "bpom",
    oa: { is_oa: false, provider: "bpom" },
    citation_count: 0,
    external_ids: {},
    abstract: "",
  });
  const garuda = env?.GARUDA_SEARCH_URL;
  if (garuda) {
    entries.push({
      id: `linkout|garuda|${q.toLowerCase()}`,
      doc_type: "link",
      linkout: true,
      title: `Cari "${q}" di Garuda (Kemendikbud)`,
      authors: [],
      journal: null,
      year: null,
      published_on: null,
      doi: null,
      url: `${garuda}${enc}`,
      source: "garuda",
      oa: { is_oa: false, provider: "garuda" },
      citation_count: 0,
      external_ids: {},
      abstract: "",
    });
  }
  return entries;
}
