import { filterResults, parseExtensions, extractRepoPaths, toCsv } from './utils.js';
import type { SearchResult } from './types.js';

// ── CSS helpers ──────────────────────────────────────────────────────────────
// System colour keywords (Canvas/CanvasText/ButtonBorder/GrayText) adapt to
// OS dark-mode automatically and work on every browser without any variables.
// GitLab CSS custom properties are applied as enhancements where they exist.

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
  // stopPropagation prevents a parent GitLab <form> from capturing Enter
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
  btn.type = 'button'; // prevent implicit form submission
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
  /** Show per-batch progress during a fetch */
  setFetchProgress(loaded: number, total: number): void;
  /** Called once all pages + project-path enrichment are done */
  setResults(results: SearchResult[]): void;
  /** Show an inline error */
  setError(msg: string): void;
  /** Reset to empty-state for a new fetch */
  clear(): void;
}

export function createPanel(initialQuery: string, onFetch: (query: string) => void): PanelHandle {
  let allResults: SearchResult[] = [];
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
    `border-bottom:1px solid ${VAR.border}`,
  ].join(';'));
  const queryInput = mkInput('Search query — supports extension:js  filename:*.ts  path:src', true);
  queryInput.value = initialQuery;
  const fetchBtn = mkBtn('Fetch All', () => {
    const q = queryInput.value.trim();
    if (q) onFetch(q);
  }, true);
  queryInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); fetchBtn.click(); }
  });
  fetchBar.append(queryInput, fetchBtn);

  // ── Filter bar ────────────────────────────────────────────────────────────
  const filterBar = div([
    'padding:8px 14px',
    'display:flex',
    'gap:8px',
    'align-items:center',
    'flex-wrap:wrap',
    `border-bottom:1px solid ${VAR.border}`,
  ].join(';'));

  const filterInput = mkInput('Filter loaded results…', true);
  const extInput = mkInput('Extensions: js, ts, py…');
  extInput.style.width = '150px';

  const hint = document.createElement('span');
  hint.textContent = 'ℹ Searches paths and code snippets literally after loading — finds "hello-world" even if GitLab\'s tokenised index split it at the hyphen';
  hint.style.cssText = `font-size:11px;color:${VAR.textMuted};flex-basis:100%;margin-top:2px;`;

  filterInput.addEventListener('input', debounce(refilter, 200));
  extInput.addEventListener('input', debounce(refilter, 200));

  filterBar.append(mkLabel('Filter:'), filterInput, mkLabel('Ext:'), extInput, hint);

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

  const toolRow = div('display:flex;gap:6px;flex-wrap:wrap;');

  const copyBtn = mkBtn('Copy repos', async () => {
    const repos = extractRepoPaths(getVisible()).join('\n');
    try {
      await navigator.clipboard.writeText(repos);
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
      list.querySelectorAll<HTMLElement>('.gcs-snippet').forEach(el => { el.style.display = 'block'; });
      list.querySelectorAll<HTMLElement>('.gcs-chevron').forEach(el => { el.style.transform = 'rotate(90deg)'; });
    }),
    mkBtn('Collapse all', () => {
      list.querySelectorAll<HTMLElement>('.gcs-snippet').forEach(el => { el.style.display = 'none'; });
      list.querySelectorAll<HTMLElement>('.gcs-chevron').forEach(el => { el.style.transform = ''; });
    }),
    divEl,
    mkBtn('Export JSON', () => {
      triggerDownload(JSON.stringify(getVisible(), null, 2), 'application/json', 'json', queryInput.value);
    }),
    mkBtn('Export CSV', () => {
      triggerDownload(toCsv(getVisible()), 'text/csv', 'csv', queryInput.value);
    }),
    copyBtn,
  );

  statusRow.append(countSpan, toolRow);

  // ── Results list ──────────────────────────────────────────────────────────
  const list = div('');
  list.id = 'gcs-list';

  root.append(titleBar, fetchBar, filterBar, statusRow, list);

  // ── Internal ──────────────────────────────────────────────────────────────

  function getVisible(): SearchResult[] {
    return filterResults(allResults, filterInput.value, parseExtensions(extInput.value));
  }

  function renderList(results: SearchResult[]): void {
    list.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const r of results) frag.appendChild(renderCard(r));
    list.appendChild(frag);
  }

  function updateCount(): void {
    const visible = getVisible();
    if (!hasFetched) {
      countSpan.textContent = 'Enter a query above and click Fetch All.';
    } else if (allResults.length === 0) {
      countSpan.textContent = 'No results found.';
    } else if (visible.length === allResults.length) {
      countSpan.textContent = `${allResults.length.toLocaleString()} result${allResults.length !== 1 ? 's' : ''}`;
    } else {
      countSpan.textContent = `${visible.length.toLocaleString()} of ${allResults.length.toLocaleString()} results (filtered)`;
    }
    countSpan.style.color = VAR.textMuted;
  }

  function refilter(): void {
    if (!hasFetched) return;
    renderList(getVisible());
    updateCount();
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
      allResults = results;
      renderList(getVisible());
      updateCount();
    },
    setError(msg) {
      countSpan.textContent = msg;
      countSpan.style.color = VAR.danger;
      list.innerHTML = '';
    },
    clear() {
      hasFetched = false;
      allResults = [];
      list.innerHTML = '';
      updateCount();
    },
  };
}

// ── Card renderer ─────────────────────────────────────────────────────────────

function renderCard(result: SearchResult): HTMLDivElement {
  const card = div(`border-bottom:1px solid ${VAR.border};${BASE_FONT}`);
  card.className = 'gcs-card';

  // Header row — always visible, click toggles snippet
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

  const ref = document.createElement('span');
  ref.textContent = ` · ${result.ref}`;
  ref.style.cssText = `font-size:11px;color:${VAR.textMuted};`;
  meta.appendChild(ref);

  header.append(chevron, meta);
  card.appendChild(header);

  // Snippet — hidden by default
  const snippet = document.createElement('pre');
  snippet.className = 'gcs-snippet';
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

  header.addEventListener('click', () => {
    const open = snippet.style.display !== 'none';
    snippet.style.display = open ? 'none' : 'block';
    chevron.style.transform = open ? '' : 'rotate(90deg)';
  });

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
