import { buildApiQuery, filterResults, parseExtensions, extractRepoPaths, toCsv, toCsvDeep, uniqueFiles } from './utils.js';
import type { SearchResult, DeepMatch } from './types.js';

// ── CSS helpers ───────────────────────────────────────────────────────────────
// System colour keywords (Canvas/CanvasText/ButtonBorder/GrayText) adapt to
// OS dark-mode automatically and work on every browser, regardless of whether
// the GitLab CSS custom properties are defined on the running instance.

const VAR = {
  bg:        'var(--gl-background-color-default, Canvas)',
  bgSubtle:  'var(--gl-background-color-subtle, Canvas)',
  border:    'var(--gl-border-color-default, ButtonBorder)',
  text:      'var(--gl-text-color-primary, CanvasText)',
  textMuted: 'var(--gl-text-color-secondary, GrayText)',
  textLink:  'var(--gl-text-color-link, LinkText)',
  danger:    'var(--gl-text-color-danger, #c0392b)',
  blue:      'var(--gl-color-blue-500, #1f75cb)',
};

const BASE_FONT = 'font:13px/1.5 system-ui,-apple-system,sans-serif;box-sizing:border-box;';

function div(css: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = css;
  return el;
}

function mkInput(placeholder: string, flex?: boolean): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = placeholder;
  // stopPropagation prevents an ancestor GitLab <form> capturing Enter
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') e.stopPropagation(); });
  inp.style.cssText = [
    'padding:4px 8px',
    `border:1px solid ${VAR.border}`,
    'border-radius:4px',
    BASE_FONT,
    `background:${VAR.bg}`,
    `color:${VAR.text}`,
    'min-width:0',
    flex ? 'flex:1' : '',
  ].filter(Boolean).join(';');
  return inp;
}

function mkBtn(label: string, onClick: (() => void) | (() => Promise<void>), primary = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.cssText = [
    'padding:4px 10px',
    `border:1px solid ${primary ? VAR.blue : VAR.border}`,
    'border-radius:4px',
    'cursor:pointer',
    BASE_FONT,
    `background:${primary ? VAR.blue : VAR.bg}`,
    `color:${primary ? '#fff' : VAR.text}`,
    'white-space:nowrap',
    'flex-shrink:0',
  ].join(';');
  btn.addEventListener('click', () => void onClick());
  return btn;
}

function mkLabel(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.textContent = text;
  s.style.cssText = `font-size:11px;font-weight:600;color:${VAR.textMuted};white-space:nowrap;flex-shrink:0;`;
  return s;
}

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let t: ReturnType<typeof setTimeout>;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Public surface ────────────────────────────────────────────────────────────

export interface PanelHandle {
  el: HTMLDivElement;
  closeBtn: HTMLButtonElement;
  setFetchProgress(loaded: number, total: number): void;
  setResults(results: SearchResult[]): void;
  setError(msg: string): void;
  clear(): void;
  setDeepProgress(done: number, total: number, matchCount: number): void;
  setDeepResults(matches: DeepMatch[]): void;
  setDeepError(msg: string): void;
}

export function createPanel(
  initialQuery: string,
  onFetch: (query: string) => void,
  onDeepSearch: (files: SearchResult[], query: string) => void,
): PanelHandle {
  let allResults: SearchResult[] = [];
  let deepResults: DeepMatch[] | null = null;
  let hasFetched = false;

  // ── Root ──────────────────────────────────────────────────────────────────
  const root = div([
    BASE_FONT,
    `border:1px solid ${VAR.border}`,
    'border-radius:6px',
    'overflow:hidden',
    `background:${VAR.bg}`,
    `color:${VAR.text}`,
    'margin-bottom:16px',
  ].join(';')) as HTMLDivElement;
  root.id = 'gcs-panel';

  // ── Title bar ─────────────────────────────────────────────────────────────
  const titleBar = div([
    'padding:8px 14px',
    'display:flex',
    'justify-content:space-between',
    'align-items:center',
    `background:${VAR.bgSubtle}`,
    `border-bottom:1px solid ${VAR.border}`,
  ].join(';'));
  const titleEl = document.createElement('strong');
  titleEl.textContent = 'Enhanced Code Search';
  titleEl.style.cssText = 'font-size:14px;';
  const closeBtn = mkBtn('✕ Close', () => {});
  titleBar.append(titleEl, closeBtn);

  // ── Fetch bar ─────────────────────────────────────────────────────────────
  const fetchBar = div([
    'padding:10px 14px',
    'display:flex',
    'gap:8px',
    'align-items:center',
    'flex-wrap:wrap',
    `border-bottom:1px solid ${VAR.border}`,
  ].join(';'));

  const queryInput = mkInput('Search query (GitLab syntax: extension:js  filename:*.ts  path:src)', true);
  queryInput.value = initialQuery;
  queryInput.style.minWidth = '200px';

  const filenameInput = mkInput('Filename');
  filenameInput.style.width = '160px';

  const extInput = mkInput('Extension: ts, js…');
  extInput.style.width = '130px';

  const fetchBtn = mkBtn('Fetch All', () => {
    const q = buildApiQuery(queryInput.value.trim(), filenameInput.value.trim(), extInput.value);
    if (q) onFetch(q);
  }, true);

  queryInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); fetchBtn.click(); }
  });

  fetchBar.append(queryInput, mkLabel('File:'), filenameInput, mkLabel('Ext:'), extInput, fetchBtn);

  // ── Status + toolbar ──────────────────────────────────────────────────────
  const statusRow = div([
    'padding:6px 14px',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:8px',
    'flex-wrap:wrap',
    `border-bottom:1px solid ${VAR.border}`,
    'font-size:12px',
  ].join(';'));

  const countSpan = document.createElement('span');
  countSpan.style.color = VAR.textMuted;
  countSpan.textContent = 'Enter a query above and click Fetch All.';

  const toolRow = div('display:flex;gap:6px;flex-wrap:wrap;align-items:center;');

  const copyBtn = mkBtn('Copy repos', async () => {
    const repos = deepResults !== null
      ? [...new Set(deepResults.map(m => m.result.project_path).filter(Boolean) as string[])].sort()
      : extractRepoPaths(getVisible());
    try {
      await navigator.clipboard.writeText(repos.join('\n'));
      const orig = copyBtn.textContent!;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = orig; }, 1500);
    } catch {
      copyBtn.textContent = 'Copy failed';
      setTimeout(() => { copyBtn.textContent = 'Copy repos'; }, 2000);
    }
  });

  const divEl = div(`width:1px;background:${VAR.border};margin:2px 0;flex-shrink:0;`);

  toolRow.append(
    mkBtn('Expand all', () => {
      list.querySelectorAll<HTMLElement>('.gcs-chevron-content').forEach(el => { el.style.display = 'block'; });
      list.querySelectorAll<HTMLElement>('.gcs-chevron').forEach(el => { el.style.transform = 'rotate(90deg)'; });
    }),
    mkBtn('Collapse all', () => {
      list.querySelectorAll<HTMLElement>('.gcs-chevron-content').forEach(el => { el.style.display = 'none'; });
      list.querySelectorAll<HTMLElement>('.gcs-chevron').forEach(el => { el.style.transform = ''; });
    }),
    divEl,
    mkBtn('Export JSON', () => {
      const content = deepResults !== null
        ? JSON.stringify(deepResults.map(m => ({ ...m.result, matches: m.lines })), null, 2)
        : JSON.stringify(getVisible(), null, 2);
      triggerDownload(content, 'application/json', 'json', queryInput.value);
    }),
    mkBtn('Export CSV', () => {
      const content = deepResults !== null
        ? toCsvDeep(deepResults)
        : toCsv(getVisible());
      triggerDownload(content, 'text/csv', 'csv', queryInput.value);
    }),
    copyBtn,
  );

  statusRow.append(countSpan, toolRow);

  // ── Results list ──────────────────────────────────────────────────────────
  const list = div('');
  list.id = 'gcs-list';

  // ── Deep search section ───────────────────────────────────────────────────
  const deepSection = div([
    `border-top:1px solid ${VAR.border}`,
    'padding:10px 14px',
    'display:none',
  ].join(';'));

  const deepTitle = mkLabel('Deep content search');
  deepTitle.style.cssText += ';display:block;margin-bottom:8px;font-size:12px;';

  const deepInputRow = div('display:flex;gap:8px;align-items:center;');
  const deepInput = mkInput('Literal string — e.g. "tanstack-hello": "^1.0.0"', true);
  const deepBtn = mkBtn('Search', handleDeepClick);
  deepInputRow.append(deepInput, deepBtn);

  deepInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); deepBtn.click(); }
  });

  // Warning row (hidden by default)
  const warningRow = div('display:none;');

  const deepHint = document.createElement('p');
  deepHint.style.cssText = `margin:6px 0 0;font-size:11px;color:${VAR.textMuted};`;
  deepHint.textContent = 'ℹ Fetches full file content for each result — finds literal matches that GitLab\'s tokenised index splits (e.g. hello-world, "pkg": "^1.0").';

  deepSection.append(deepTitle, deepInputRow, warningRow, deepHint);

  root.append(titleBar, fetchBar, statusRow, list, deepSection);

  // ── Internal helpers ──────────────────────────────────────────────────────

  function getVisible(): SearchResult[] {
    return filterResults(allResults, '', parseExtensions(extInput.value));
  }

  function renderApiList(results: SearchResult[]): void {
    list.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const r of results) frag.appendChild(renderCard(r));
    list.appendChild(frag);
  }

  function renderDeepList(matches: DeepMatch[]): void {
    list.innerHTML = '';
    if (matches.length === 0) {
      const empty = div(`padding:16px;text-align:center;color:${VAR.textMuted};font-size:13px;`);
      empty.textContent = 'No matches found in full file content.';
      list.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const m of matches) frag.appendChild(renderDeepCard(m));
    list.appendChild(frag);
  }

  function updateCount(): void {
    if (!hasFetched) {
      countSpan.textContent = 'Enter a query above and click Fetch All.';
    } else if (allResults.length === 0) {
      countSpan.textContent = 'No results found.';
    } else {
      const visible = getVisible();
      countSpan.textContent = visible.length === allResults.length
        ? `${allResults.length.toLocaleString()} result${allResults.length !== 1 ? 's' : ''}`
        : `${visible.length.toLocaleString()} of ${allResults.length.toLocaleString()} results (ext filter active)`;
    }
    countSpan.style.color = VAR.textMuted;
  }

  // Extension filter: re-render API results when ext field changes (no deep search effect)
  extInput.addEventListener('input', debounce(() => {
    if (!hasFetched || deepResults !== null) return;
    renderApiList(getVisible());
    updateCount();
  }, 300));

  function handleDeepClick(): void {
    const q = deepInput.value.trim();
    if (!q) return;
    const files = uniqueFiles(allResults).filter(r => r.project_id !== null);
    if (files.length === 0) return;

    if (files.length > 500) {
      showDeepWarning(files.length, () => startDeep(files, q));
    } else {
      startDeep(files, q);
    }
  }

  function showDeepWarning(fileCount: number, proceed: () => void): void {
    deepInputRow.style.display = 'none';
    warningRow.style.display = 'flex';
    warningRow.style.cssText += ';gap:8px;align-items:center;flex-wrap:wrap;';
    warningRow.innerHTML = '';
    const msg = document.createElement('span');
    msg.style.cssText = `font-size:12px;color:${VAR.danger};`;
    msg.textContent = `⚠ This will fetch ${fileCount.toLocaleString()} files — large files (e.g. package-lock.json) can be several MB each. Proceed?`;
    const proceedBtn = mkBtn('Proceed', () => { resetDeepWarning(); proceed(); });
    const cancelBtn  = mkBtn('Cancel',  resetDeepWarning);
    warningRow.append(msg, proceedBtn, cancelBtn);
  }

  function resetDeepWarning(): void {
    warningRow.style.display = 'none';
    warningRow.innerHTML = '';
    deepInputRow.style.display = 'flex';
  }

  function startDeep(files: SearchResult[], q: string): void {
    deepResults = null;
    deepBtn.disabled = true;
    onDeepSearch(files, q);
  }

  return {
    el: root,
    closeBtn,

    setFetchProgress(loaded, total) {
      countSpan.textContent = `Loading… ${loaded.toLocaleString()} / ~${total.toLocaleString()} results`;
      countSpan.style.color = VAR.textMuted;
    },

    setResults(results) {
      hasFetched = true;
      deepResults = null;
      deepBtn.disabled = false;
      allResults = results;
      renderApiList(getVisible());
      updateCount();
      // Show deep search section when there are results to search
      deepSection.style.display = results.length > 0 ? 'block' : 'none';
    },

    setError(msg) {
      countSpan.textContent = msg;
      countSpan.style.color = VAR.danger;
      list.innerHTML = '';
      deepSection.style.display = 'none';
    },

    clear() {
      hasFetched = false;
      deepResults = null;
      allResults = [];
      list.innerHTML = '';
      deepSection.style.display = 'none';
      resetDeepWarning();
      deepBtn.disabled = false;
      updateCount();
    },

    setDeepProgress(done, total, matchCount) {
      countSpan.textContent = `Deep search: ${done.toLocaleString()} / ${total.toLocaleString()} files fetched · ${matchCount} match${matchCount !== 1 ? 'es' : ''} so far`;
      countSpan.style.color = VAR.textMuted;
    },

    setDeepResults(matches) {
      deepResults = matches;
      deepBtn.disabled = false;
      renderDeepList(matches);
      const cleared = div('display:flex;gap:8px;align-items:center;margin-top:8px;');
      const summary = document.createElement('span');
      summary.style.cssText = `font-size:12px;color:${VAR.textMuted};`;
      summary.textContent = `Found in ${matches.length} file${matches.length !== 1 ? 's' : ''}.`;
      const clearBtn = mkBtn('Clear — back to API results', () => {
        deepResults = null;
        deepBtn.disabled = false;
        renderApiList(getVisible());
        updateCount();
        cleared.remove();
        deepInputRow.style.display = 'flex';
      });
      cleared.append(summary, clearBtn);
      deepInputRow.style.display = 'none';
      deepSection.insertBefore(cleared, deepHint);
    },

    setDeepError(msg) {
      deepBtn.disabled = false;
      countSpan.textContent = msg;
      countSpan.style.color = VAR.danger;
    },
  };
}

// ── Card renderers ────────────────────────────────────────────────────────────

function cardHeader(result: SearchResult): { header: HTMLDivElement; chevron: HTMLSpanElement } {
  const header = div([
    'display:flex',
    'align-items:baseline',
    'gap:6px',
    'padding:8px 14px',
    'cursor:pointer',
    'user-select:none',
  ].join(';'));

  const chevron = document.createElement('span');
  chevron.className = 'gcs-chevron';
  chevron.textContent = '▶';
  chevron.style.cssText = `font-size:9px;color:${VAR.textMuted};flex-shrink:0;transition:transform .12s;`;

  const meta = div('flex:1;min-width:0;');

  if (result.project_path) {
    const repo = document.createElement('span');
    repo.textContent = result.project_path + ' · ';
    repo.style.cssText = `font-size:11px;color:${VAR.textMuted};`;
    meta.appendChild(repo);
  }

  const link = document.createElement('a');
  link.href = result.project_path
    ? `${location.origin}/${result.project_path}/-/blob/${result.ref}/${result.path}`
    : `${location.origin}/${result.path}`;
  link.textContent = result.path;
  link.style.cssText = `color:${VAR.textLink};text-decoration:none;font-weight:500;word-break:break-all;`;
  link.addEventListener('mouseenter', () => { link.style.textDecoration = 'underline'; });
  link.addEventListener('mouseleave', () => { link.style.textDecoration = 'none'; });
  link.addEventListener('click', e => e.stopPropagation());
  meta.appendChild(link);

  return { header: (header.append(chevron, meta), header), chevron };
}

function toggleOnClick(header: HTMLElement, chevron: HTMLSpanElement, content: HTMLElement): void {
  header.addEventListener('click', () => {
    const open = content.style.display !== 'none';
    content.style.display = open ? 'none' : 'block';
    chevron.style.transform = open ? '' : 'rotate(90deg)';
  });
}

function renderCard(result: SearchResult): HTMLDivElement {
  const card = div(`border-bottom:1px solid ${VAR.border};${BASE_FONT}`);
  card.className = 'gcs-card';

  const { header, chevron } = cardHeader(result);

  const ref = document.createElement('span');
  ref.textContent = ` · ${result.ref}`;
  ref.style.cssText = `font-size:11px;color:${VAR.textMuted};`;
  header.appendChild(ref);

  card.appendChild(header);

  const snippet = document.createElement('pre');
  snippet.className = 'gcs-chevron-content';
  snippet.style.cssText = [
    'display:none',
    'margin:0',
    'padding:8px 14px 10px 30px',
    `background:${VAR.bgSubtle}`,
    'overflow:auto',
    'font:12px/1.4 "SFMono-Regular",Consolas,monospace',
    'white-space:pre-wrap',
    'word-break:break-all',
    'max-height:200px',
  ].join(';');
  if (result.data) {
    const lineHint = result.startline ? `Line ${result.startline}: ` : '';
    snippet.textContent = lineHint + result.data.slice(0, 800);
  }
  card.appendChild(snippet);
  toggleOnClick(header, chevron, snippet);
  return card;
}

function renderDeepCard(match: DeepMatch): HTMLDivElement {
  const card = div(`border-bottom:1px solid ${VAR.border};${BASE_FONT}`);

  const { header, chevron } = cardHeader(match.result);

  const refAndCount = document.createElement('span');
  refAndCount.textContent = ` · ${match.result.ref} · ${match.lines.length} match${match.lines.length !== 1 ? 'es' : ''}`;
  refAndCount.style.cssText = `font-size:11px;color:${VAR.textMuted};`;
  header.appendChild(refAndCount);
  card.appendChild(header);

  const linesDiv = div([
    'display:none',
    'padding:4px 14px 10px 30px',
    `background:${VAR.bgSubtle}`,
    'font:12px/1.6 "SFMono-Regular",Consolas,monospace',
    'overflow:auto',
    'max-height:300px',
  ].join(';'));
  linesDiv.className = 'gcs-chevron-content';

  for (const { lineNum, text } of match.lines) {
    const row = div('display:flex;gap:12px;');
    const num = document.createElement('span');
    num.textContent = String(lineNum);
    num.style.cssText = `color:${VAR.textMuted};user-select:none;min-width:40px;text-align:right;flex-shrink:0;`;
    const txt = document.createElement('span');
    txt.textContent = text.trim();
    txt.style.cssText = 'overflow:auto;white-space:pre;';
    row.append(num, txt);
    linesDiv.appendChild(row);
  }

  card.appendChild(linesDiv);
  toggleOnClick(header, chevron, linesDiv);
  return card;
}

// ── Download helper ───────────────────────────────────────────────────────────

function triggerDownload(content: string, mimeType: string, ext: string, query: string): void {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gitlab-search-${slug}-${date}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}
