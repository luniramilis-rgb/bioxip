export {};

/* hasil live — window.BIOXIP_SEARCH */

window.BIOXIP_SEARCH = {
  async run(q, filters = {}, page = 1) {
    const params = new URLSearchParams();
    params.set("q", q);
    if (filters.types && filters.types.length) params.set("types", filters.types.join(","));
    if (filters.oa) params.set("oa", "true");
    if (filters.indonesia) params.set("indonesia", "true");
    if (filters.sort && filters.sort !== "relevance") params.set("sort", filters.sort);
    params.set("page", String(page));
    params.set("per_page", "20");

    const resp = await fetch(`/api/search?${params.toString()}`);
    if (!resp.ok) throw new Error(`search gagal: ${resp.status}`);
    return resp.json();
  },

  renderResult(doc) {
    const authors = (doc.authors || []).slice(0, 6).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).join(", ");
    const metaBits = [];
    metaBits.push(`<span class="chip">${this.escape(doc.doc_type)}</span>`);
    if (doc.oa && doc.oa.is_oa) metaBits.push('<span class="chip oa">OA</span>');
    if (doc.journal) metaBits.push(this.escape(doc.journal));
    if (doc.year) metaBits.push(String(doc.year));
    if (doc.source === "clinicaltrials" && doc.meta && doc.meta.phase && doc.meta.phase.length) {
      metaBits.push(this.escape(doc.meta.phase.join(",")));
    }
    const title = doc.url
      ? `<a href="${this.safeUrl(doc.url)}" target="_blank" rel="noopener">${this.escape(doc.title)}</a>`
      : this.escape(doc.title);
    return `
      <article class="result">
        <h3>${title}</h3>
        <p class="meta">${metaBits.join(" · ")}</p>
        <p class="muted">${this.escape(authors || "-")}</p>
        <p class="actions">
          ${doc.oa && doc.oa.pdf_url ? `<a class="btn small" target="_blank" rel="noopener" href="${this.safeUrl(doc.oa.pdf_url)}">PDF</a>` : ""}
          ${doc.url ? `<a class="btn small ghost" target="_blank" rel="noopener" href="${this.safeUrl(doc.url)}">Buka sumber</a>` : ""}
          <button class="btn small ghost" data-copy="${this.escape(citeOf(doc))}">Salin sitasi</button>
        </p>
      </article>`;
  },

  renderNote(data) {
    if (!data.notes || !data.notes.length) return "";
    return `<p class="muted">Catatan: ${this.escape(data.notes.join("; "))}</p>`;
  },

  escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  },

  safeUrl(value) {
    return this.escape(value || "#").replaceAll("&amp;", "&");
  },
};

function citeOf(doc) {
  const authors = (doc.authors || []).slice(0, 6).map((a) => `${a.family || a.given || ""}`.trim()).join(", ");
  return `${authors || doc.source}. (${doc.year || "n.d."}). ${doc.title}. ${doc.journal || doc.source}. ${doc.url || ""}`;
}
