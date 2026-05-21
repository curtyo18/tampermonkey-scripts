// ==UserScript==
// @name         GitLab Code Search+
// @namespace    https://github.com/curtyo18/tampermonkey-scripts
// @version      1.4.0
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
  function buildApiQuery(rawQuery, filename, extension) {
    const parts = [rawQuery.trim()];
    if (filename.trim()) parts.push(`filename:${filename.trim()}`);
    const exts = parseExtensions(extension);
    if (exts.length === 1) parts.push(`extension:${exts[0]}`);
    return parts.filter(Boolean).join(" ");
  }
  function uniqueFiles(results) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const r of results) {
      const key = `${r.project_id}:${r.path}:${r.ref}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(r);
      }
    }
    return out;
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
  function toCsvDeep(matches) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = "project_id,project_path,path,filename,ref,lineNum,text";
    const rows = [];
    for (const { result: r, lines } of matches) {
      for (const { lineNum, text } of lines) {
        rows.push([
          esc(r.project_id),
          esc(r.project_path),
          esc(r.path),
          esc(r.filename),
          esc(r.ref),
          esc(lineNum),
          esc(text)
        ].join(","));
      }
    }
    return [header, ...rows].join("\n");
  }

  // src/api.ts
  var CONCURRENCY = 5;
  var DEEP_CONCURRENCY = 3;
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
  async function fetchFileRaw(projectId, filePath, ref) {
    try {
      const url = `/api/v4/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(ref)}`;
      const resp = await fetch(url, { credentials: "include", headers: { Accept: "text/plain" } });
      if (!resp.ok) return null;
      return await resp.text();
    } catch {
      return null;
    }
  }
  async function deepSearchFiles(files, query, { onProgress }) {
    const total = files.length;
    let done = 0;
    const matches = [];
    const q = query.toLowerCase();
    for (let i = 0; i < files.length; i += DEEP_CONCURRENCY) {
      const chunk = files.slice(i, i + DEEP_CONCURRENCY);
      await Promise.allSettled(
        chunk.map(async (r) => {
          if (r.project_id === null) {
            done++;
            onProgress(done, total, matches.length);
            return;
          }
          const content = await fetchFileRaw(r.project_id, r.path, r.ref);
          done++;
          if (!content) {
            onProgress(done, total, matches.length);
            return;
          }
          const lines = content.split("\n").map((text, idx) => ({ lineNum: idx + 1, text })).filter(({ text }) => text.toLowerCase().includes(q));
          if (lines.length > 0) matches.push({ result: r, lines });
          onProgress(done, total, matches.length);
        })
      );
    }
    return matches;
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
  function createPanel(initialQuery, onFetch, onDeepSearch) {
    let allResults = [];
    let deepResults = null;
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
      "flex-wrap:wrap",
      `border-bottom:1px solid ${VAR.border}`
    ].join(";"));
    const queryInput = mkInput("Search query (GitLab syntax: extension:js  filename:*.ts  path:src)", true);
    queryInput.value = initialQuery;
    queryInput.style.minWidth = "200px";
    const filenameInput = mkInput("Filename");
    filenameInput.style.width = "160px";
    const extInput = mkInput("Extension: ts, js\u2026");
    extInput.style.width = "130px";
    const fetchBtn = mkBtn("Fetch All", () => {
      const q = buildApiQuery(queryInput.value.trim(), filenameInput.value.trim(), extInput.value);
      if (q) onFetch(q);
    }, true);
    queryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        fetchBtn.click();
      }
    });
    fetchBar.append(queryInput, mkLabel("File:"), filenameInput, mkLabel("Ext:"), extInput, fetchBtn);
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
    const toolRow = div("display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
    const copyBtn = mkBtn("Copy repos", async () => {
      const repos = deepResults !== null ? [...new Set(deepResults.map((m) => m.result.project_path).filter(Boolean))].sort() : extractRepoPaths(getVisible());
      try {
        await navigator.clipboard.writeText(repos.join("\n"));
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
        list.querySelectorAll(".gcs-collapsible").forEach((el) => {
          el.style.display = "block";
        });
        list.querySelectorAll(".gcs-chevron").forEach((el) => {
          el.style.transform = "rotate(90deg)";
        });
      }),
      mkBtn("Collapse all", () => {
        list.querySelectorAll(".gcs-collapsible").forEach((el) => {
          el.style.display = "none";
        });
        list.querySelectorAll(".gcs-chevron").forEach((el) => {
          el.style.transform = "";
        });
      }),
      divEl,
      mkBtn("Export JSON", () => {
        const content = deepResults !== null ? JSON.stringify(deepResults.map((m) => ({ ...m.result, matches: m.lines })), null, 2) : JSON.stringify(getVisible(), null, 2);
        triggerDownload(content, "application/json", "json", queryInput.value);
      }),
      mkBtn("Export CSV", () => {
        const content = deepResults !== null ? toCsvDeep(deepResults) : toCsv(getVisible());
        triggerDownload(content, "text/csv", "csv", queryInput.value);
      }),
      copyBtn
    );
    statusRow.append(countSpan, toolRow);
    const list = div("");
    list.id = "gcs-list";
    const deepSection = div([
      `border-top:1px solid ${VAR.border}`,
      "padding:10px 14px",
      "display:none"
    ].join(";"));
    const deepTitle = mkLabel("Deep content search");
    deepTitle.style.cssText += ";display:block;margin-bottom:8px;font-size:12px;";
    const deepInputRow = div("display:flex;gap:8px;align-items:center;");
    const deepInput = mkInput('Literal string \u2014 e.g. "tanstack-hello": "^1.0.0"', true);
    const deepBtn = mkBtn("Search", handleDeepClick);
    deepInputRow.append(deepInput, deepBtn);
    deepInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        deepBtn.click();
      }
    });
    const warningRow = div("display:none;");
    const deepHint = document.createElement("p");
    deepHint.style.cssText = `margin:6px 0 0;font-size:11px;color:${VAR.textMuted};`;
    deepHint.textContent = `\u2139 Fetches full file content for each result \u2014 finds literal matches that GitLab's tokenised index splits (e.g. hello-world, "pkg": "^1.0").`;
    deepSection.append(deepTitle, deepInputRow, warningRow, deepHint);
    root.append(titleBar, fetchBar, statusRow, list, deepSection);
    function getVisible() {
      return filterResults(allResults, "", parseExtensions(extInput.value));
    }
    function renderApiList(results) {
      list.innerHTML = "";
      if (results.length === 0) return;
      const grouped = groupByRepo(results);
      const frag = document.createDocumentFragment();
      for (const [repo, items] of grouped) frag.appendChild(renderRepoGroup(repo, items));
      list.appendChild(frag);
    }
    function renderDeepList(matches) {
      list.innerHTML = "";
      if (matches.length === 0) {
        const empty = div(`padding:16px;text-align:center;color:${VAR.textMuted};font-size:13px;`);
        empty.textContent = "No matches found in full file content.";
        list.appendChild(empty);
        return;
      }
      const grouped = groupDeepByRepo(matches);
      const frag = document.createDocumentFragment();
      for (const [repo, items] of grouped) frag.appendChild(renderDeepRepoGroup(repo, items));
      list.appendChild(frag);
    }
    function updateCount() {
      if (!hasFetched) {
        countSpan.textContent = "Enter a query above and click Fetch All.";
      } else if (allResults.length === 0) {
        countSpan.textContent = "No results found.";
      } else {
        const visible = getVisible();
        const repoCount = groupByRepo(visible).size;
        countSpan.textContent = visible.length === allResults.length ? `${allResults.length.toLocaleString()} result${allResults.length !== 1 ? "s" : ""} across ${repoCount} repo${repoCount !== 1 ? "s" : ""}` : `${visible.length.toLocaleString()} of ${allResults.length.toLocaleString()} results across ${repoCount} repo${repoCount !== 1 ? "s" : ""} (ext filter active)`;
      }
      countSpan.style.color = VAR.textMuted;
    }
    extInput.addEventListener("input", debounce(() => {
      if (!hasFetched || deepResults !== null) return;
      renderApiList(getVisible());
      updateCount();
    }, 300));
    function handleDeepClick() {
      const q = deepInput.value.trim();
      if (!q) return;
      const files = uniqueFiles(allResults).filter((r) => r.project_id !== null);
      if (files.length === 0) return;
      if (files.length > 500) {
        showDeepWarning(files.length, () => startDeep(files, q));
      } else {
        startDeep(files, q);
      }
    }
    function showDeepWarning(fileCount, proceed) {
      deepInputRow.style.display = "none";
      warningRow.style.display = "flex";
      warningRow.style.gap = "8px";
      warningRow.style.alignItems = "center";
      warningRow.style.flexWrap = "wrap";
      warningRow.innerHTML = "";
      const msg = document.createElement("span");
      msg.style.cssText = `font-size:12px;color:${VAR.danger};`;
      msg.textContent = `\u26A0 This will fetch ${fileCount.toLocaleString()} files \u2014 large files (e.g. package-lock.json) can be several MB each. Proceed?`;
      warningRow.append(msg, mkBtn("Proceed", () => {
        resetDeepWarning();
        proceed();
      }), mkBtn("Cancel", resetDeepWarning));
    }
    function resetDeepWarning() {
      warningRow.style.display = "none";
      warningRow.innerHTML = "";
      deepInputRow.style.display = "flex";
    }
    function startDeep(files, q) {
      deepResults = null;
      deepBtn.disabled = true;
      onDeepSearch(files, q);
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
        deepResults = null;
        deepBtn.disabled = false;
        allResults = results;
        renderApiList(getVisible());
        updateCount();
        deepSection.style.display = results.length > 0 ? "block" : "none";
      },
      setError(msg) {
        countSpan.textContent = msg;
        countSpan.style.color = VAR.danger;
        list.innerHTML = "";
        deepSection.style.display = "none";
      },
      clear() {
        hasFetched = false;
        deepResults = null;
        allResults = [];
        list.innerHTML = "";
        deepSection.style.display = "none";
        resetDeepWarning();
        deepBtn.disabled = false;
        updateCount();
      },
      setDeepProgress(done, total, matchCount) {
        countSpan.textContent = `Deep search: ${done.toLocaleString()} / ${total.toLocaleString()} files fetched \xB7 ${matchCount} match${matchCount !== 1 ? "es" : ""} so far`;
        countSpan.style.color = VAR.textMuted;
      },
      setDeepResults(matches) {
        deepResults = matches;
        deepBtn.disabled = false;
        renderDeepList(matches);
        const cleared = div("display:flex;gap:8px;align-items:center;margin-top:8px;");
        const summary = document.createElement("span");
        summary.style.cssText = `font-size:12px;color:${VAR.textMuted};`;
        const totalLines = matches.reduce((s, m) => s + m.lines.length, 0);
        summary.textContent = `Found in ${matches.length} file${matches.length !== 1 ? "s" : ""} (${totalLines} matching line${totalLines !== 1 ? "s" : ""}).`;
        const clearBtn = mkBtn("Clear \u2014 back to API results", () => {
          deepResults = null;
          deepBtn.disabled = false;
          renderApiList(getVisible());
          updateCount();
          cleared.remove();
          deepInputRow.style.display = "flex";
        });
        cleared.append(summary, clearBtn);
        deepInputRow.style.display = "none";
        deepSection.insertBefore(cleared, deepHint);
      },
      setDeepError(msg) {
        deepBtn.disabled = false;
        countSpan.textContent = msg;
        countSpan.style.color = VAR.danger;
      }
    };
  }
  function groupByRepo(results) {
    const groups = /* @__PURE__ */ new Map();
    for (const r of results) {
      const key = r.project_path ?? `(project ${r.project_id})`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    return groups;
  }
  function groupDeepByRepo(matches) {
    const groups = /* @__PURE__ */ new Map();
    for (const m of matches) {
      const key = m.result.project_path ?? `(project ${m.result.project_id})`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    return groups;
  }
  function repoGroupHeader(repoPath, summary) {
    const group = div(`border-bottom:1px solid ${VAR.border};`);
    const header = div([
      "display:flex",
      "align-items:center",
      "gap:8px",
      "padding:7px 14px",
      "cursor:pointer",
      "user-select:none",
      `background:${VAR.bgSubtle}`
    ].join(";"));
    const chevron = document.createElement("span");
    chevron.className = "gcs-chevron";
    chevron.textContent = "\u25B6";
    chevron.style.cssText = `font-size:9px;color:${VAR.textMuted};flex-shrink:0;transition:transform .12s;`;
    const repoLink = document.createElement("a");
    repoLink.href = `${location.origin}/${repoPath}`;
    repoLink.textContent = repoPath;
    repoLink.style.cssText = `color:${VAR.textLink};font-weight:600;font-size:13px;text-decoration:none;word-break:break-all;flex:1;`;
    repoLink.addEventListener("mouseenter", () => {
      repoLink.style.textDecoration = "underline";
    });
    repoLink.addEventListener("mouseleave", () => {
      repoLink.style.textDecoration = "none";
    });
    repoLink.addEventListener("click", (e) => e.stopPropagation());
    const badge = document.createElement("span");
    badge.textContent = summary;
    badge.style.cssText = `font-size:11px;color:${VAR.textMuted};white-space:nowrap;flex-shrink:0;`;
    header.append(chevron, repoLink, badge);
    const content = div("display:none;");
    content.className = "gcs-collapsible";
    group.append(header, content);
    header.addEventListener("click", () => {
      const open = content.style.display !== "none";
      content.style.display = open ? "none" : "block";
      chevron.style.transform = open ? "" : "rotate(90deg)";
    });
    return { group, content };
  }
  function renderRepoGroup(repoPath, results) {
    const summary = `${results.length} result${results.length !== 1 ? "s" : ""}`;
    const { group, content } = repoGroupHeader(repoPath, summary);
    for (const r of results) content.appendChild(renderFileCard(r));
    return group;
  }
  function renderDeepRepoGroup(repoPath, matches) {
    const totalLines = matches.reduce((s, m) => s + m.lines.length, 0);
    const summary = `${matches.length} file${matches.length !== 1 ? "s" : ""} \xB7 ${totalLines} match${totalLines !== 1 ? "es" : ""}`;
    const { group, content } = repoGroupHeader(repoPath, summary);
    for (const m of matches) content.appendChild(renderDeepFileCard(m));
    return group;
  }
  function toggleCollapsible(trigger, chevron, content) {
    trigger.addEventListener("click", () => {
      const open = content.style.display !== "none";
      content.style.display = open ? "none" : "block";
      chevron.style.transform = open ? "" : "rotate(90deg)";
    });
  }
  function renderFileCard(result) {
    const card = div(`border-top:1px solid ${VAR.border};${BASE_FONT}`);
    const header = div([
      "display:flex",
      "align-items:baseline",
      "gap:6px",
      "padding:6px 14px 6px 28px",
      "cursor:pointer",
      "user-select:none"
    ].join(";"));
    const chevron = document.createElement("span");
    chevron.className = "gcs-chevron";
    chevron.textContent = "\u25B6";
    chevron.style.cssText = `font-size:9px;color:${VAR.textMuted};flex-shrink:0;transition:transform .12s;`;
    const link = document.createElement("a");
    link.href = result.project_path ? `${location.origin}/${result.project_path}/-/blob/${result.ref}/${result.path}` : `${location.origin}/${result.path}`;
    link.textContent = result.path;
    link.style.cssText = `color:${VAR.textLink};text-decoration:none;font-weight:500;word-break:break-all;flex:1;min-width:0;`;
    link.addEventListener("mouseenter", () => {
      link.style.textDecoration = "underline";
    });
    link.addEventListener("mouseleave", () => {
      link.style.textDecoration = "none";
    });
    link.addEventListener("click", (e) => e.stopPropagation());
    const ref = document.createElement("span");
    ref.textContent = result.ref;
    ref.style.cssText = `font-size:11px;color:${VAR.textMuted};white-space:nowrap;flex-shrink:0;`;
    header.append(chevron, link, ref);
    card.appendChild(header);
    const snippet = document.createElement("pre");
    snippet.className = "gcs-collapsible";
    snippet.style.cssText = [
      "display:none",
      "margin:0",
      "padding:8px 14px 10px 42px",
      `background:${VAR.bgSubtle}`,
      "overflow:auto",
      'font:12px/1.4 "SFMono-Regular",Consolas,monospace',
      "white-space:pre-wrap",
      "word-break:break-all",
      "max-height:200px"
    ].join(";");
    if (result.data) {
      snippet.textContent = (result.startline ? `Line ${result.startline}: ` : "") + result.data.slice(0, 800);
    }
    card.appendChild(snippet);
    toggleCollapsible(header, chevron, snippet);
    return card;
  }
  function renderDeepFileCard(match) {
    const card = div(`border-top:1px solid ${VAR.border};${BASE_FONT}`);
    const header = div([
      "display:flex",
      "align-items:baseline",
      "gap:6px",
      "padding:6px 14px 6px 28px",
      "cursor:pointer",
      "user-select:none"
    ].join(";"));
    const chevron = document.createElement("span");
    chevron.className = "gcs-chevron";
    chevron.textContent = "\u25B6";
    chevron.style.cssText = `font-size:9px;color:${VAR.textMuted};flex-shrink:0;transition:transform .12s;`;
    const link = document.createElement("a");
    link.href = match.result.project_path ? `${location.origin}/${match.result.project_path}/-/blob/${match.result.ref}/${match.result.path}` : `${location.origin}/${match.result.path}`;
    link.textContent = match.result.path;
    link.style.cssText = `color:${VAR.textLink};text-decoration:none;font-weight:500;word-break:break-all;flex:1;min-width:0;`;
    link.addEventListener("mouseenter", () => {
      link.style.textDecoration = "underline";
    });
    link.addEventListener("mouseleave", () => {
      link.style.textDecoration = "none";
    });
    link.addEventListener("click", (e) => e.stopPropagation());
    const meta = document.createElement("span");
    meta.textContent = `${match.result.ref} \xB7 ${match.lines.length} match${match.lines.length !== 1 ? "es" : ""}`;
    meta.style.cssText = `font-size:11px;color:${VAR.textMuted};white-space:nowrap;flex-shrink:0;`;
    header.append(chevron, link, meta);
    card.appendChild(header);
    const linesDiv = div([
      "display:none",
      "padding:4px 14px 10px 42px",
      `background:${VAR.bgSubtle}`,
      'font:12px/1.6 "SFMono-Regular",Consolas,monospace',
      "overflow:auto",
      "max-height:300px"
    ].join(";"));
    linesDiv.className = "gcs-collapsible";
    for (const { lineNum, text } of match.lines) {
      const row = div("display:flex;gap:12px;");
      const num = document.createElement("span");
      num.textContent = String(lineNum);
      num.style.cssText = `color:${VAR.textMuted};user-select:none;min-width:40px;text-align:right;flex-shrink:0;`;
      const txt = document.createElement("span");
      txt.textContent = text.trim();
      txt.style.cssText = "overflow:auto;white-space:pre;";
      row.append(num, txt);
      linesDiv.appendChild(row);
    }
    card.appendChild(linesDiv);
    toggleCollapsible(header, chevron, linesDiv);
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
  async function runDeepSearch(panel, files, query) {
    try {
      const matches = await deepSearchFiles(files, query, {
        onProgress(done, total, matchCount) {
          panel.setDeepProgress(done, total, matchCount);
        }
      });
      panel.setDeepResults(matches);
    } catch (err) {
      panel.setDeepError(`Deep search failed: ${err.message}`);
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
    const panel = createPanel(
      getNativeQuery(),
      (query) => {
        void runSearch(panel, query);
      },
      (files, query) => {
        void runDeepSearch(panel, files, query);
      }
    );
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
