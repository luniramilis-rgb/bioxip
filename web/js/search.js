/* hasil & drawer — window.BIOXIP_SEARCH */

window.BIOXIP_SEARCH = {
  async run(q, filters = {}, page = 1) {
    const params = new URLSearchParams();
    params.set("q", q);
    if (filters.types && filters.types.length) params.set("types", filters.types.join(","));
    if (filters.year_min) params.set("year_min", filters.year_min);
    if (filters.year_max) params.set("year_max", filters.year_max);
    if (filters.oa) params.set("oa", "true");
    if (filters.indonesia) params.set("indonesia", "true");
    if (filters.sort && filters.sort !== "relevance") params.set("sort", filters.sort);
    params.set("page", String(page));
    params.set("per_page", "20");

    const resp = await fetch(`/api/search?${params.toString()}`);
    if (!resp.ok) throw new Error(`search gagal: ${resp.status}`);
    return resp.json();
  },

  async detail(id) {
    const resp = await fetch(`/api/doc/${encodeURIComponent(id)}`);
    if (!resp.ok) throw new Error(`detail gagal: ${resp.status}`);
    return resp.json();
  },

  renderSnippet(abstract, q, limit = 320) {
    const text = abstract || "Abstrak tidak tersedia.";
    return text.length > limit ? text.slice(0, limit) + "…" : text;
  },

  async openDrawer(id) {
    const drawer = document.getElementById("drawer");
    const body = document.getElementById("drawer-body");
    body.innerHTML = '<p class="muted">Memuat…</p>';
    drawer.hidden = false;
    try {
      const doc = await this.detail(id);
      body.innerHTML = this.drawerHTML(doc);
    } catch (error) {
      body.innerHTML = `<p class="muted">${error.message}</p>`;
    }
  },

  drawerHTML(doc) {
    const authors = (doc.authors || []).slice(0, 12).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).join(", ");
    const localHint = doc.oa && doc.oa.is_oa
      ? `<a class="btn" target="_blank" rel="noopener" href="${this.safeUrl(doc.oa.pdf_url || doc.url)}">Buka teks lengkap (OA)</a>`
      : `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(doc.title)}">Cari versi lokal (Garuda/OneSearch/Neliti)</a>`;
    const cite = `APA: ${authors || doc.source}. (${doc.year || "n.d."}). ${doc.title}. ${doc.journal || doc.source}.`;
    return `
      <span class="chip">${doc.doc_type}</span>
      ${doc.oa && doc.oa.is_oa ? '<span class="chip oa">Open Access</span>' : ""}
      <h2>${this.escape(doc.title)}</h2>
      <p class="muted">${this.escape(authors || "-")}</p>
      <p class="meta">${this.escape(doc.journal || "")}${doc.year ? " · " + doc.year : ""} · ${doc.source} · ${doc.citation_count || 0} sitasi</p>
      <p>${this.escape(this.renderSnippet(doc.abstract, ""))}</p>
      <p class="actions">
        ${localHint}
        ${doc.url ? `<a class="btn ghost" target="_blank" rel="noopener" href="${this.safeUrl(doc.url)}">Sumber asli</a>` : ""}
        <button class="btn ghost" data-copy="${this.escape(cite)}">Salin sitasi</button>
      </p>
      <p class="muted cite">${this.escape(cite)}</p>`;
  },

  resultHTML(doc) {
    const authors = (doc.authors || []).slice(0, 6).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).join(", ");
    return `
      <article class="result">
        <h3><a href="#" data-open="${doc.id}">${this.escape(doc.title)}</a></h3>
        <p class="meta">
          <span class="chip">${doc.doc_type}</span>
          ${doc.oa && doc.oa.is_oa ? '<span class="chip oa">OA</span>' : ""}
          ${this.escape(doc.journal || "")}${doc.year ? " · " + doc.year : ""}
          ${doc.source === "clinicaltrials" && doc.meta && doc.meta.phase && doc.meta.phase.length ? " · " + doc.meta.phase.join(",") : ""}
        </p>
        <p class="muted">${this.escape(authors || "-")}</p>
        <p>${this.escape(this.renderSnippet(doc.abstract, ""))}</p>
        <p class="actions">
          ${doc.oa && doc.oa.pdf_url ? `<a class="btn small" target="_blank" rel="noopener" href="${this.safeUrl(doc.oa.pdf_url)}">PDF</a>` : ""}
          ${doc.url ? `<a class="btn small ghost" target="_blank" rel="noopener" href="${this.safeUrl(doc.url)}">Buka sumber</a>` : ""}
        </p>
      </article>`;
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
