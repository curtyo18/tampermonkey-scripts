// ==UserScript==
// @name         GitLab Code Search+
// @namespace    https://github.com/curtyo18/tampermonkey-scripts
// @version      1.2.0
// @description  Augments GitLab search with filter UI, full pagination, and export
// @match        *://*/-/search*
// @include      /\/search\?/
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
  function parseExtensions(raw) {
    return raw.split(/[,\s]+/).map((e) => e.trim().replace(/^\./, "").toLowerCase()).filter(Boolean);
  }
  function filterResults(results, textFilter, extensions) {
    let out = results;
    if (extensions.length > 0) {
      out = out.filter((r) => {
        const ext = r.filename.split(".").pop()?.toLowerCase() ?? "";
        return extensions.includes(ext);
      });
    }
    if (textFilter.trim()) {
      const q = textFilter.toLowerCase();
      out = out.filter(
        (r) => r.path.toLowerCase().includes(q) || r.filename.toLowerCase().includes(q) || (r.data?.toLowerCase().includes(q) ?? false)
      );
    }
    return out;
  }
  function extractRepoPaths(results) {
    const seen = /* @__PURE__ */ new Set();
    for (const r of results) {
      if (r.project_path) seen.add(r.project_path);
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
  var projectPathCache = /* @__PURE__ */ new Map();
  async function resolveProjectPath(id) {
    if (projectPathCache.has(id)) return projectPathCache.get(id);
    try {
      const resp = await fetch(`/api/v4/projects/${id}`, {
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      if (!resp.ok) return null;
      const p = await resp.json();
      projectPathCache.set(id, p.path_with_namespace);
      return p.path_with_namespace;
    } catch {
      return null;
    }
  }
  async function resolveProjectPaths(ids) {
    const entries = await Promise.all(
      ids.map(async (id) => [id, await resolveProjectPath(id)])
    );
    return new Map(entries.filter((e) => e[1] !== null));
  }
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
  var VAR = {
    bg: "var(--gl-background-color-default, Canvas)",
    bgSubtle: "var(--gl-background-color-subtle, Canvas)",
    border: "var(--gl-border-color-default, ButtonBorder)",
    text: "var(--gl-text-color-primary, CanvasText)",
    textMuted: "var(--gl-text-color-secondary, GrayText)",
    textLink: "var(--gl-text-color-link, LinkText)",
    danger: "var(--gl-text-color-danger, #c0392b)",
    blue: "var(--gl-color-blue-500, #1f75cb)"
  };
  var BASE_FONT = "font:13px/1.5 system-ui,-apple-system,sans-serif;box-sizing:border-box;";
  function div(css) {
    const el = document.createElement("div");
    el.style.cssText = css;
    return el;
  }
  function mkInput(placeholder, flex) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = placeholder;
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.stopPropagation();
    });
    inp.style.cssText = [
      "padding:4px 8px",
      `border:1px solid ${VAR.border}`,
      "border-radius:4px",
      BASE_FONT,
      `background:${VAR.bg}`,
      `color:${VAR.text}`,
      "min-width:0",
      flex ? "flex:1" : ""
    ].filter(Boolean).join(";");
    return inp;
  }
  function mkBtn(label, onClick, primary = false) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.cssText = [
      "padding:4px 10px",
      `border:1px solid ${primary ? VAR.blue : VAR.border}`,
      "border-radius:4px",
      "cursor:pointer",
      BASE_FONT,
      `background:${primary ? VAR.blue : VAR.bg}`,
      `color:${primary ? "#fff" : VAR.text}`,
      "white-space:nowrap",
      "flex-shrink:0"
    ].join(";");
    btn.addEventListener("click", () => void onClick());
    return btn;
  }
  function mkLabel(text) {
    const s = document.createElement("span");
    s.textContent = text;
    s.style.cssText = `font-size:11px;font-weight:600;color:${VAR.textMuted};white-space:nowrap;flex-shrink:0;`;
    return s;
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
  function createPanel(initialQuery, onFetch) {
    let allResults = [];
    let hasFetched = false;
    const root = div([
      BASE_FONT,
      `border:1px solid ${VAR.border}`,
      "border-radius:6px",
      "overflow:hidden",
      `background:${VAR.bg}`,
      `color:${VAR.text}`,
      "margin-bottom:16px"
    ].join(";"));
    root.id = "gcs-panel";
    const titleBar = div([
      "padding:8px 14px",
      "display:flex",
      "justify-content:space-between",
      "align-items:center",
      `background:${VAR.bgSubtle}`,
      `border-bottom:1px solid ${VAR.border}`
    ].join(";"));
    const titleEl = document.createElement("strong");
    titleEl.textContent = "Enhanced Code Search";
    titleEl.style.cssText = "font-size:14px;";
    const closeBtn = mkBtn("\u2715 Close", () => {
    });
    titleBar.append(titleEl, closeBtn);
    const fetchBar = div([
      "padding:10px 14px",
      "display:flex",
      "gap:8px",
      "align-items:center",
      `border-bottom:1px solid ${VAR.border}`
    ].join(";"));
    const queryInput = mkInput("Search query \u2014 supports extension:js  filename:*.ts  path:src", true);
    queryInput.value = initialQuery;
    const fetchBtn = mkBtn("Fetch All", () => {
      const q = queryInput.value.trim();
      if (q) onFetch(q);
    }, true);
    queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        fetchBtn.click();
      }
    });
    fetchBar.append(queryInput, fetchBtn);
    const filterBar = div([
      "padding:8px 14px",
      "display:flex",
      "gap:8px",
      "align-items:center",
      "flex-wrap:wrap",
      `border-bottom:1px solid ${VAR.border}`
    ].join(";"));
    const filterInput = mkInput("Filter loaded results\u2026", true);
    const extInput = mkInput("Extensions: js, ts, py\u2026");
    extInput.style.width = "150px";
    const hint = document.createElement("span");
    hint.textContent = `\u2139 Searches paths and code snippets literally after loading \u2014 finds "hello-world" even if GitLab's tokenised index split it at the hyphen`;
    hint.style.cssText = `font-size:11px;color:${VAR.textMuted};flex-basis:100%;margin-top:2px;`;
    filterInput.addEventListener("input", debounce(refilter, 200));
    extInput.addEventListener("input", debounce(refilter, 200));
    filterBar.append(mkLabel("Filter:"), filterInput, mkLabel("Ext:"), extInput, hint);
    const statusRow = div([
      "padding:6px 14px",
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:8px",
      "flex-wrap:wrap",
      `border-bottom:1px solid ${VAR.border}`,
      "font-size:12px"
    ].join(";"));
    const countSpan = document.createElement("span");
    countSpan.style.color = VAR.textMuted;
    countSpan.textContent = "Enter a query above and click Fetch All.";
    const toolRow = div("display:flex;gap:6px;flex-wrap:wrap;");
    const copyBtn = mkBtn("Copy repos", async () => {
      const repos = extractRepoPaths(getVisible()).join("\n");
      try {
        await navigator.clipboard.writeText(repos);
        const orig = copyBtn.textContent;
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
    const divEl = div(`width:1px;background:${VAR.border};margin:2px 0;flex-shrink:0;`);
    toolRow.append(
      mkBtn("Expand all", () => {
        list.querySelectorAll(".gcs-snippet").forEach((el) => {
          el.style.display = "block";
        });
        list.querySelectorAll(".gcs-chevron").forEach((el) => {
          el.style.transform = "rotate(90deg)";
        });
      }),
      mkBtn("Collapse all", () => {
        list.querySelectorAll(".gcs-snippet").forEach((el) => {
          el.style.display = "none";
        });
        list.querySelectorAll(".gcs-chevron").forEach((el) => {
          el.style.transform = "";
        });
      }),
      divEl,
      mkBtn("Export JSON", () => {
        triggerDownload(JSON.stringify(getVisible(), null, 2), "application/json", "json", queryInput.value);
      }),
      mkBtn("Export CSV", () => {
        triggerDownload(toCsv(getVisible()), "text/csv", "csv", queryInput.value);
      }),
      copyBtn
    );
    statusRow.append(countSpan, toolRow);
    const list = div("");
    list.id = "gcs-list";
    root.append(titleBar, fetchBar, filterBar, statusRow, list);
    function getVisible() {
      return filterResults(allResults, filterInput.value, parseExtensions(extInput.value));
    }
    function renderList(results) {
      list.innerHTML = "";
      const frag = document.createDocumentFragment();
      for (const r of results) frag.appendChild(renderCard(r));
      list.appendChild(frag);
    }
    function updateCount() {
      const visible = getVisible();
      if (!hasFetched) {
        countSpan.textContent = "Enter a query above and click Fetch All.";
      } else if (allResults.length === 0) {
        countSpan.textContent = "No results found.";
      } else if (visible.length === allResults.length) {
        countSpan.textContent = `${allResults.length.toLocaleString()} result${allResults.length !== 1 ? "s" : ""}`;
      } else {
        countSpan.textContent = `${visible.length.toLocaleString()} of ${allResults.length.toLocaleString()} results (filtered)`;
      }
      countSpan.style.color = VAR.textMuted;
    }
    function refilter() {
      if (!hasFetched) return;
      renderList(getVisible());
      updateCount();
    }
    return {
      el: root,
      closeBtn,
      setFetchProgress(loaded, total) {
        countSpan.textContent = `Loading\u2026 ${loaded.toLocaleString()} / ~${total.toLocaleString()} results`;
        countSpan.style.color = VAR.textMuted;
      },
      setResults(results) {
        hasFetched = true;
        allResults = results;
        renderList(getVisible());
        updateCount();
      },
      setError(msg) {
        countSpan.textContent = msg;
        countSpan.style.color = VAR.danger;
        list.innerHTML = "";
      },
      clear() {
        hasFetched = false;
        allResults = [];
        list.innerHTML = "";
        updateCount();
      }
    };
  }
  function renderCard(result) {
    const card = div(`border-bottom:1px solid ${VAR.border};${BASE_FONT}`);
    card.className = "gcs-card";
    const header = div([
      "display:flex",
      "align-items:baseline",
      "gap:6px",
      "padding:8px 14px",
      "cursor:pointer",
      "user-select:none"
    ].join(";"));
    const chevron = document.createElement("span");
    chevron.className = "gcs-chevron";
    chevron.textContent = "\u25B6";
    chevron.style.cssText = `font-size:9px;color:${VAR.textMuted};flex-shrink:0;transition:transform .12s;`;
    const meta = div("flex:1;min-width:0;");
    if (result.project_path) {
      const repo = document.createElement("span");
      repo.textContent = result.project_path + " \xB7 ";
      repo.style.cssText = `font-size:11px;color:${VAR.textMuted};`;
      meta.appendChild(repo);
    }
    const link = document.createElement("a");
    link.href = result.project_path ? `${location.origin}/${result.project_path}/-/blob/${result.ref}/${result.path}` : `${location.origin}/${result.path}`;
    link.textContent = result.path;
    link.style.cssText = `color:${VAR.textLink};text-decoration:none;font-weight:500;word-break:break-all;`;
    link.addEventListener("mouseenter", () => {
      link.style.textDecoration = "underline";
    });
    link.addEventListener("mouseleave", () => {
      link.style.textDecoration = "none";
    });
    link.addEventListener("click", (e) => e.stopPropagation());
    meta.appendChild(link);
    const ref = document.createElement("span");
    ref.textContent = ` \xB7 ${result.ref}`;
    ref.style.cssText = `font-size:11px;color:${VAR.textMuted};`;
    meta.appendChild(ref);
    header.append(chevron, meta);
    card.appendChild(header);
    const snippet = document.createElement("pre");
    snippet.className = "gcs-snippet";
    snippet.style.cssText = [
      "display:none",
      "margin:0",
      "padding:8px 14px 10px 30px",
      `background:${VAR.bgSubtle}`,
      "overflow:auto",
      'font:12px/1.4 "SFMono-Regular",Consolas,monospace',
      "white-space:pre-wrap",
      "word-break:break-all",
      "max-height:200px"
    ].join(";");
    if (result.data) {
      const lineHint = result.startline ? `Line ${result.startline}: ` : "";
      snippet.textContent = lineHint + result.data.slice(0, 800);
    }
    card.appendChild(snippet);
    header.addEventListener("click", () => {
      const open = snippet.style.display !== "none";
      snippet.style.display = open ? "none" : "block";
      chevron.style.transform = open ? "" : "rotate(90deg)";
    });
    return card;
  }
  function triggerDownload(content, mimeType, ext, query) {
    const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
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
  function showNativeResults() {
    document.querySelectorAll(
      ".results-list, .search-results-list, .search-results ul"
    ).forEach((el) => {
      el.style.display = "";
    });
  }
  function findInjectionPoint() {
    return document.querySelector(".results-list")?.parentElement ?? document.querySelector(".search-results-list")?.parentElement ?? document.querySelector("main");
  }
  function isSearchPage() {
    const p = location.pathname;
    return p.endsWith("/search") || p.includes("/-/search");
  }
  async function runSearch(panel, query) {
    const endpoint = resolveApiEndpoint(location.pathname, getProjectId());
    panel.clear();
    function handleError(err) {
      if (err.status === 401 || err.status === 403) {
        panel.setError("Not authorised \u2014 are you logged in?");
      } else if (err.status === 404) {
        panel.setError("Search endpoint not found \u2014 is Advanced Search enabled on this instance?");
      } else {
        panel.setError(`Search failed: ${err.message}`);
      }
    }
    try {
      const rawResults = await fetchAllPages(endpoint, query, {
        onBatch(_, loaded, total) {
          panel.setFetchProgress(loaded, total);
        },
        onError: handleError
      });
      const uniqueIds = [
        ...new Set(rawResults.map((r) => r.project_id).filter((id) => id !== null))
      ];
      const projectPaths = await resolveProjectPaths(uniqueIds);
      const enriched = rawResults.map((r) => ({
        ...r,
        project_path: r.project_id != null ? projectPaths.get(r.project_id) ?? void 0 : void 0
      }));
      panel.setResults(enriched);
    } catch (err) {
      handleError(err);
    }
  }
  var activePanel = null;
  function injectTrigger() {
    if (document.getElementById("gcs-trigger")) return;
    const btn = document.createElement("button");
    btn.id = "gcs-trigger";
    btn.type = "button";
    btn.textContent = "\u26A1 Enhanced Search";
    btn.style.cssText = [
      "display:block",
      "margin:0 0 12px",
      "padding:6px 14px",
      "border:1px solid var(--gl-border-color-default, ButtonBorder)",
      "border-radius:6px",
      "background:var(--gl-background-color-default, Canvas)",
      "color:var(--gl-text-color-primary, CanvasText)",
      "font:13px/1.5 system-ui,-apple-system,sans-serif",
      "cursor:pointer"
    ].join(";");
    btn.addEventListener("click", activate);
    const point = findInjectionPoint();
    if (point) point.insertBefore(btn, point.firstChild);
  }
  function activate() {
    document.getElementById("gcs-trigger")?.remove();
    hideNativeResults();
    const panel = createPanel(getNativeQuery(), (query) => {
      void runSearch(panel, query);
    });
    panel.closeBtn.addEventListener("click", deactivate);
    const point = findInjectionPoint();
    if (point) point.insertBefore(panel.el, point.firstChild);
    activePanel = panel;
  }
  function deactivate() {
    activePanel?.el.remove();
    activePanel = null;
    showNativeResults();
    injectTrigger();
  }
  function resetPage() {
    activePanel?.el.remove();
    activePanel = null;
    document.getElementById("gcs-trigger")?.remove();
    showNativeResults();
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
  (function patchHistory(h) {
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
      if (!isSearchPage()) return;
      resetPage();
      waitForDom(injectTrigger);
    }, 250);
  }
  window.addEventListener("gcs-nav", onNav);
  document.addEventListener("turbo:load", onNav);
  document.addEventListener("turbo:render", onNav);
  waitForDom(injectTrigger);
})();
