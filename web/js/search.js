/* hasil live — window.BIOXIP_SEARCH */

window.BIOXIP_SEARCH = {
  async run(q, filters = {}, page = 1, cursors = null) {
    const params = new URLSearchParams();
    params.set("q", q);
    if (filters.types && filters.types.length) params.set("types", filters.types.join(","));
    if (filters.oa) params.set("oa", "true");
    if (filters.indonesia) params.set("indonesia", "true");
    if (filters.clinical) params.set("clinical", "1");
    if (filters.sort && filters.sort !== "relevance") params.set("sort", filters.sort);
    if (filters.perPage && filters.perPage !== 20) params.set("per_page", String(filters.perPage));
    params.set("page", String(page));
    if (cursors && cursors.epmcCursor) params.set("epmc_cursor", cursors.epmcCursor);
    if (cursors && cursors.ctToken) params.set("ct_token", cursors.ctToken);

    const resp = await fetch(`/api/search?${params.toString()}`);
    if (!resp.ok) throw new Error(`search gagal: ${resp.status}`);
    return resp.json();
  },

  renderResult(doc) {
    const authors = (doc.authors || []).slice(0, 6).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).join(", ");
    const metaBits = [];
    metaBits.push(`<span class="chip">${this.escape(this.sourceLabel(doc.source))}</span>`);
    metaBits.push(`<span class="chip">${this.escape(doc.doc_type)}</span>`);
    if (doc.guideline) {
      if (doc.guideline.tier) metaBits.push(`<span class="chip">${this.escape(doc.guideline.label || doc.guideline.tier)}</span>`);
      if (doc.guideline.edisi) metaBits.push(this.escape(doc.guideline.edisi));
      if (doc.guideline.locator) metaBits.push(this.escape(doc.guideline.locator));
    }
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
          ${doc.url ? `<button class="btn small ghost" data-copy-link="${this.escape(doc.url)}">Salin tautan</button>` : ""}
          <button class="btn small ghost" data-copy="${this.escape(this.formatCitation(doc, "vancouver"))}">Sitasi Vancouver</button>
          <button class="btn small ghost" data-copy="${this.escape(this.formatCitation(doc, "apa"))}">Sitasi APA</button>
        </p>
      </article>`;
  },

  formatCitation(doc, format = "vancouver") {
    const families = (doc.authors || []).map((a) => a.family || a.given || "").filter(Boolean).slice(0, 6);
    const authors = families.join(", ") || doc.source || "Anonim";
    const year = doc.year || "n.d.";
    const title = doc.title || "(tanpa judul)";
    const journal = doc.journal || doc.source || "";
    const url = doc.url || "";
    if (format === "apa") {
      return `${authors}. (${year}). ${title}. ${journal}. ${url}`.replace(/\s+\./g, ".").replace(/\.\.+/g, ".").trim();
    }
    // Vancouver (ringkas, sesuai metadata yang tersedia).
    return `${authors}. ${title}. ${journal}. ${year}. ${url}`.replace(/\s+\./g, ".").replace(/\.\.+/g, ".").trim();
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

  sourceLabel(source) {
    return (
      {
        europepmc: "Europe PMC",
        pubmed: "PubMed",
        clinicaltrials: "ClinicalTrials.gov",
        crossref: "Crossref",
        doaj: "DOAJ",
        neliti: "Neliti",
        guideline: "Pedoman",
        onesearch: "Indonesia OneSearch",
        garuda: "Garuda",
      }[source] || source
    );
  },

  safeUrl(value) {
    return this.escape(value || "#").replaceAll("&amp;", "&");
  },
};
