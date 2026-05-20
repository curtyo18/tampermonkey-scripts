// ==UserScript==
// @name         GitLab Code Search+
// @namespace    https://github.com/curtyo18/tampermonkey-scripts
// @version      1.0.0
// @description  Augments GitLab search with filter UI, full pagination, and export
// @match        *://*/-/search*
// @match        *://*/*/-/search*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/gitlab/gitlab-code-search/gitlab-code-search.user.js
// @downloadURL  https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/gitlab/gitlab-code-search/gitlab-code-search.user.js
// ==/UserScript==
"use strict";
(() => {
  // src/utils.ts
  function resolveApiEndpoint(pathname, projectId) {
    if (/^\/-\/search/.test(pathname)) return "/api/v4/search";
    const groupMatch = pathname.match(/^\/groups\/(.+?)\/-\/search/);
    if (groupMatch) return `/api/v4/groups/${groupMatch[1]}/search`;
    if (projectId !== null) return `/api/v4/projects/${projectId}/search`;
    return "/api/v4/search";
  }
  function buildQuery(mainQuery, filters) {
    const parts = [mainQuery.trim()];
    for (const ext of filters.extensions ?? []) {
      if (ext) parts.push(`extension:${ext}`);
    }
    if (filters.filename) parts.push(`filename:${filters.filename}`);
    if (filters.path) parts.push(`path:${filters.path}`);
    return parts.filter(Boolean).join(" ");
  }
  function extractRepoPaths(results) {
    const seen = /* @__PURE__ */ new Set();
    for (const r of results) {
      const segs = (r.path ?? "").split("/");
      if (segs.length >= 2) seen.add(`${segs[0]}/${segs[1]}`);
    }
    return [...seen].sort();
  }
  function toCsv(results) {
    const cols = ["project_id", "path", "filename", "ref", "startline"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = results.map((r) => cols.map((c) => esc(r[c])).join(","));
    return [cols.join(","), ...rows].join("\n");
  }

  // src/api.ts
  var CONCURRENCY = 5;
  async function fetchPage(endpoint, query, page) {
    const url = `${endpoint}?scope=blobs&search=${encodeURIComponent(query)}&page=${page}&per_page=100`;
    const resp = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    const data = await resp.json();
    return {
      data,
      totalPages: parseInt(resp.headers.get("X-Total-Pages") ?? "1", 10),
      total: parseInt(resp.headers.get("X-Total") ?? String(data.length), 10)
    };
  }
  async function fetchAllPages(endpoint, query, { onBatch, onError } = {}) {
    const cacheKey = `gcs:${endpoint}:${query}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const results = JSON.parse(cached);
        onBatch?.(results, results.length, results.length);
        return results;
      }
    } catch {
    }
    const first = await fetchPage(endpoint, query, 1);
    const all = [...first.data];
    onBatch?.(first.data, all.length, first.total);
    const remaining = Array.from({ length: first.totalPages - 1 }, (_, i) => i + 2);
    for (let i = 0; i < remaining.length; i += CONCURRENCY) {
      const chunk = remaining.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map((p) => fetchPage(endpoint, query, p)));
      for (const result of settled) {
        if (result.status === "fulfilled") {
          all.push(...result.value.data);
          onBatch?.(result.value.data, all.length, first.total);
        } else {
          onError?.(result.reason);
        }
      }
    }
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(all));
    } catch {
    }
    return all;
  }

  // src/ui.ts
  function createFilterPanel(onChange) {
    const state = { extensions: [], filename: "", path: "", mode: "fuzzy" };
    const panel = document.createElement("div");
    panel.id = "gcs-panel";
    panel.style.cssText = [
      "padding:10px 16px",
      "background:var(--gl-background-color-subtle)",
      "border-bottom:1px solid var(--gl-border-color-default)",
      "display:flex",
      "gap:16px",
      "align-items:flex-end",
      "flex-wrap:wrap",
      "font:13px/1.5 system-ui,-apple-system,sans-serif",
      "box-sizing:border-box",
      "width:100%"
    ].join(";");
    const extWrap = makeFieldWrap("Extension");
    const tagRow = document.createElement("div");
    tagRow.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;align-items:center;min-height:26px;padding:2px 4px;border:1px solid var(--gl-border-color-default);border-radius:4px;background:var(--gl-background-color-default);";
    const extInput = document.createElement("input");
    extInput.type = "text";
    extInput.placeholder = "js, ts\u2026";
    extInput.style.cssText = "border:none;outline:none;width:70px;font:inherit;color:var(--gl-text-color-primary);background:transparent;";
    function renderTags() {
      Array.from(tagRow.children).forEach((child) => {
        if (child !== extInput) tagRow.removeChild(child);
      });
      for (const ext of state.extensions) {
        const tag = document.createElement("span");
        tag.style.cssText = "background:var(--gl-background-color-strong);border-radius:3px;padding:1px 4px;display:flex;align-items:center;gap:3px;font-size:12px;";
        tag.appendChild(document.createTextNode(ext));
        const rm = document.createElement("button");
        rm.textContent = "\xD7";
        rm.style.cssText = "border:none;background:none;cursor:pointer;padding:0;line-height:1;font-size:14px;color:var(--gl-text-color-secondary);";
        rm.addEventListener("click", () => {
          state.extensions = state.extensions.filter((e) => e !== ext);
          renderTags();
          onChange({ ...state });
        });
        tag.appendChild(rm);
        tagRow.insertBefore(tag, extInput);
      }
    }
    extInput.addEventListener("keydown", (e) => {
      const val = extInput.value.trim().replace(/^\./, "");
      if ((e.key === "Enter" || e.key === ",") && val) {
        e.preventDefault();
        if (!state.extensions.includes(val)) {
          state.extensions = [...state.extensions, val];
          extInput.value = "";
          renderTags();
          onChange({ ...state });
        }
      }
      if (e.key === "Backspace" && !extInput.value && state.extensions.length) {
        state.extensions = state.extensions.slice(0, -1);
        renderTags();
        onChange({ ...state });
      }
    });
    renderTags();
    extWrap.appendChild(tagRow);
    const fnWrap = makeFieldWrap("Filename");
    const fnInput = makeTextInput("*.test.*");
    fnInput.addEventListener("input", debounce(() => {
      state.filename = fnInput.value.trim();
      onChange({ ...state });
    }, 400));
    fnWrap.appendChild(fnInput);
    const pathWrap = makeFieldWrap("Path");
    const pathInput = makeTextInput("src/components");
    pathInput.addEventListener("input", debounce(() => {
      state.path = pathInput.value.trim();
      onChange({ ...state });
    }, 400));
    pathWrap.appendChild(pathInput);
    const modeWrap = makeFieldWrap("Mode");
    const modeBtn = document.createElement("button");
    modeBtn.textContent = "Fuzzy";
    modeBtn.style.cssText = "border:1px solid var(--gl-border-color-default);border-radius:4px;padding:3px 10px;cursor:pointer;background:var(--gl-background-color-default);color:var(--gl-text-color-primary);font:inherit;";
    modeBtn.addEventListener("click", () => {
      state.mode = state.mode === "fuzzy" ? "exact" : "fuzzy";
      modeBtn.textContent = state.mode === "fuzzy" ? "Fuzzy" : "Exact";
      modeBtn.style.background = state.mode === "exact" ? "var(--gl-color-blue-500,#1f75cb)" : "var(--gl-background-color-default)";
      modeBtn.style.color = state.mode === "exact" ? "#fff" : "var(--gl-text-color-primary)";
      onChange({ ...state });
    });
    modeWrap.appendChild(modeBtn);
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear filters";
    clearBtn.style.cssText = "border:1px solid var(--gl-border-color-default);border-radius:4px;padding:3px 10px;cursor:pointer;background:var(--gl-background-color-default);font:inherit;color:var(--gl-text-color-secondary);";
    clearBtn.addEventListener("click", () => {
      state.extensions = [];
      state.filename = "";
      state.path = "";
      state.mode = "fuzzy";
      fnInput.value = "";
      pathInput.value = "";
      modeBtn.textContent = "Fuzzy";
      modeBtn.style.background = "var(--gl-background-color-default)";
      modeBtn.style.color = "var(--gl-text-color-primary)";
      renderTags();
      onChange({ ...state });
    });
    panel.appendChild(extWrap);
    panel.appendChild(fnWrap);
    panel.appendChild(pathWrap);
    panel.appendChild(modeWrap);
    panel.appendChild(clearBtn);
    return { panel, getState: () => ({ ...state }) };
  }
  function createResultsContainer() {
    const wrap = document.createElement("div");
    wrap.id = "gcs-results";
    const status = document.createElement("div");
    status.style.cssText = "padding:8px 16px;font:13px system-ui;color:var(--gl-text-color-secondary);border-bottom:1px solid var(--gl-border-color-default);";
    status.textContent = "Loading\u2026";
    const list = document.createElement("div");
    list.id = "gcs-list";
    wrap.appendChild(status);
    wrap.appendChild(list);
    return {
      el: wrap,
      setStatus(loaded, total) {
        if (total === 0) {
          status.textContent = "No results";
        } else if (loaded >= total) {
          status.textContent = `${total.toLocaleString()} result${total !== 1 ? "s" : ""}`;
        } else {
          status.textContent = `Loading\u2026 ${loaded.toLocaleString()} / ~${total.toLocaleString()}`;
        }
      },
      appendResults(results) {
        for (const r of results) list.appendChild(renderCard(r));
      },
      setError(msg) {
        status.textContent = msg;
        status.style.color = "var(--gl-text-color-danger,#c0392b)";
      },
      clear() {
        list.innerHTML = "";
        status.textContent = "Loading\u2026";
        status.style.color = "var(--gl-text-color-secondary)";
      }
    };
  }
  function renderCard(result) {
    const card = document.createElement("div");
    card.style.cssText = "padding:12px 16px;border-bottom:1px solid var(--gl-border-color-default);font:13px/1.5 system-ui,-apple-system,sans-serif;";
    const header = document.createElement("div");
    header.style.marginBottom = "6px";
    const link = document.createElement("a");
    link.href = `${location.origin}/${result.path}`;
    link.textContent = result.path;
    link.style.cssText = "color:var(--gl-text-color-link);text-decoration:none;font-weight:500;word-break:break-all;";
    link.addEventListener("mouseenter", () => {
      link.style.textDecoration = "underline";
    });
    link.addEventListener("mouseleave", () => {
      link.style.textDecoration = "none";
    });
    const ref = document.createElement("span");
    ref.textContent = ` \xB7 ${result.ref}`;
    ref.style.color = "var(--gl-text-color-secondary)";
    header.appendChild(link);
    header.appendChild(ref);
    card.appendChild(header);
    if (result.data) {
      const pre = document.createElement("pre");
      pre.style.cssText = 'margin:0;padding:8px 10px;background:var(--gl-background-color-subtle);border-radius:4px;overflow:auto;font:12px/1.4 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:200px;';
      const lineHint = result.startline ? `Line ${result.startline}: ` : "";
      pre.textContent = lineHint + result.data.slice(0, 800);
      card.appendChild(pre);
    }
    return card;
  }
  function createExportToolbar(getAllResults) {
    const toolbar = document.createElement("div");
    toolbar.id = "gcs-toolbar";
    toolbar.style.cssText = "padding:8px 16px;display:flex;gap:8px;border-top:1px solid var(--gl-border-color-default);background:var(--gl-background-color-subtle);";
    toolbar.appendChild(makeToolbarBtn("Export JSON", () => {
      triggerDownload(JSON.stringify(getAllResults(), null, 2), "application/json", "json");
    }));
    toolbar.appendChild(makeToolbarBtn("Export CSV", () => {
      triggerDownload(toCsv(getAllResults()), "text/csv", "csv");
    }));
    const copyBtn = makeToolbarBtn("Copy repos", async () => {
      const repos = extractRepoPaths(getAllResults()).join("\n");
      try {
        await navigator.clipboard.writeText(repos);
        const orig = copyBtn.textContent ?? "";
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = orig;
        }, 1500);
      } catch {
        copyBtn.textContent = "Copy failed";
        setTimeout(() => {
          copyBtn.textContent = "Copy repos";
        }, 2e3);
      }
    });
    toolbar.appendChild(copyBtn);
    return toolbar;
  }
  function makeFieldWrap(label) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    lbl.style.cssText = "font-size:11px;font-weight:600;color:var(--gl-text-color-secondary);text-transform:uppercase;letter-spacing:.4px;";
    wrap.appendChild(lbl);
    return wrap;
  }
  function makeTextInput(placeholder) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = placeholder;
    inp.style.cssText = "border:1px solid var(--gl-border-color-default);border-radius:4px;padding:3px 6px;width:140px;font:inherit;background:var(--gl-background-color-default);color:var(--gl-text-color-primary);";
    return inp;
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
  function makeToolbarBtn(label, onClick) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = "border:1px solid var(--gl-border-color-default);border-radius:4px;padding:3px 10px;cursor:pointer;background:var(--gl-background-color-default);font:12px system-ui;color:var(--gl-text-color-primary);";
    btn.addEventListener("click", onClick);
    return btn;
  }
  function triggerDownload(content, mimeType, ext) {
    const raw = document.querySelector(
      'input[data-testid="search-page-input"], input[name="search"]'
    )?.value ?? "results";
    const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const blob = new Blob([content], { type: mimeType });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gitlab-search-${slug}-${date}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // src/main.ts
  function getProjectId() {
    const raw = document.body.dataset.projectId;
    return raw ? parseInt(raw, 10) : null;
  }
  function getNativeQuery() {
    const input = document.querySelector(
      'input[data-testid="search-page-input"], input[name="search"]'
    );
    return input?.value.trim() ?? "";
  }
  function hideNativeResults() {
    document.querySelectorAll(
      ".results-list, .search-results-list, .search-results ul"
    ).forEach((el) => {
      el.style.display = "none";
    });
  }
  function findInjectionPoint() {
    return document.querySelector(".results-list")?.parentElement ?? document.querySelector(".search-results-list")?.parentElement ?? document.querySelector("main");
  }
  async function runSearch(container, filterState, session) {
    const query = buildQuery(getNativeQuery(), filterState);
    if (!query) return;
    const endpoint = resolveApiEndpoint(location.pathname, getProjectId());
    session.results = [];
    container.clear();
    function handleError(err) {
      if (err.status === 401 || err.status === 403) {
        container.setError("Not authorised \u2014 are you logged in?");
      } else if (err.status === 404) {
        container.setError("Search endpoint not found \u2014 is Advanced Search enabled on this instance?");
      } else {
        container.setError(`Search failed: ${err.message}`);
      }
    }
    try {
      session.results = await fetchAllPages(endpoint, query, {
        onBatch(batch, loaded, total) {
          container.appendResults(batch);
          container.setStatus(loaded, total);
        },
        onError: handleError
      });
      if (session.results.length === 0) container.setStatus(0, 0);
    } catch (err) {
      handleError(err);
    }
  }
  function cleanup() {
    document.getElementById("gcs-panel")?.remove();
    document.getElementById("gcs-results")?.remove();
    document.getElementById("gcs-toolbar")?.remove();
  }
  function init() {
    cleanup();
    const injectionPoint = findInjectionPoint();
    if (!injectionPoint) {
      console.warn("[gcs] Could not find injection point \u2014 DOM selectors may need updating for this GitLab version");
      return;
    }
    hideNativeResults();
    const session = { results: [] };
    const container = createResultsContainer();
    const toolbar = createExportToolbar(() => session.results);
    const { panel } = createFilterPanel((state) => {
      void runSearch(container, state, session);
    });
    injectionPoint.insertBefore(panel, injectionPoint.firstChild);
    panel.insertAdjacentElement("afterend", container.el);
    container.el.insertAdjacentElement("afterend", toolbar);
    void runSearch(container, { extensions: [], filename: "", path: "", mode: "fuzzy" }, session);
  }
  function waitForDom(callback) {
    const selectors = [".results-list", ".search-results-list", "main"];
    if (selectors.some((s) => document.querySelector(s))) {
      callback();
      return;
    }
    const obs = new MutationObserver(() => {
      if (selectors.some((s) => document.querySelector(s))) {
        obs.disconnect();
        clearTimeout(timer);
        callback();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => {
      obs.disconnect();
      callback();
    }, 3e3);
  }
  (function(h) {
    const fire = () => {
      window.dispatchEvent(new Event("gcs-nav"));
    };
    const ps = h.pushState.bind(h);
    const rs = h.replaceState.bind(h);
    h.pushState = function(...a) {
      const r = ps(...a);
      fire();
      return r;
    };
    h.replaceState = function(...a) {
      const r = rs(...a);
      fire();
      return r;
    };
    window.addEventListener("popstate", fire);
  })(window.history);
  var navDebounce;
  function onNav() {
    clearTimeout(navDebounce);
    navDebounce = setTimeout(() => {
      if (!location.pathname.includes("/-/search")) return;
      waitForDom(init);
    }, 250);
  }
  window.addEventListener("gcs-nav", onNav);
  document.addEventListener("turbo:load", onNav);
  document.addEventListener("turbo:render", onNav);
  waitForDom(init);
})();
