import { toCsv, extractRepoPaths } from './utils.js';
import type { FilterState, SearchResult, ResultsContainer, FilterPanel } from './types.js';

export function createFilterPanel(onChange: (state: FilterState) => void): FilterPanel {
  const state: FilterState = { extensions: [], filename: '', path: '', mode: 'fuzzy' };

  const panel = document.createElement('div');
  panel.id = 'gcs-panel';
  panel.style.cssText = [
    'padding:10px 16px',
    'background:var(--gl-background-color-subtle)',
    'border-bottom:1px solid var(--gl-border-color-default)',
    'display:flex',
    'gap:16px',
    'align-items:flex-end',
    'flex-wrap:wrap',
    'font:13px/1.5 system-ui,-apple-system,sans-serif',
    'box-sizing:border-box',
    'width:100%',
  ].join(';');

  // ── Extension multi-tag ──────────────────────────────────────────────
  const extWrap = makeFieldWrap('Extension');
  const tagRow = document.createElement('div');
  tagRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;align-items:center;min-height:26px;padding:2px 4px;border:1px solid var(--gl-border-color-default);border-radius:4px;background:var(--gl-background-color-default);';

  const extInput = document.createElement('input');
  extInput.type = 'text';
  extInput.placeholder = 'js, ts…';
  extInput.style.cssText = 'border:none;outline:none;width:70px;font:inherit;color:var(--gl-text-color-primary);background:transparent;';

  function renderTags(): void {
    // Remove tag spans only; leave extInput in place to preserve focus and input state
    Array.from(tagRow.children).forEach(child => {
      if (child !== extInput) tagRow.removeChild(child);
    });
    for (const ext of state.extensions) {
      const tag = document.createElement('span');
      tag.style.cssText = 'background:var(--gl-background-color-strong);border-radius:3px;padding:1px 4px;display:flex;align-items:center;gap:3px;font-size:12px;';
      tag.appendChild(document.createTextNode(ext));
      const rm = document.createElement('button');
      rm.textContent = '×';
      rm.style.cssText = 'border:none;background:none;cursor:pointer;padding:0;line-height:1;font-size:14px;color:var(--gl-text-color-secondary);';
      rm.addEventListener('click', () => {
        state.extensions = state.extensions.filter(e => e !== ext);
        renderTags();
        onChange({ ...state });
      });
      tag.appendChild(rm);
      tagRow.insertBefore(tag, extInput);
    }
  }

  extInput.addEventListener('keydown', (e: KeyboardEvent) => {
    const val = extInput.value.trim().replace(/^\./, '');
    if ((e.key === 'Enter' || e.key === ',') && val) {
      e.preventDefault();
      if (!state.extensions.includes(val)) {
        state.extensions = [...state.extensions, val];
        extInput.value = '';
        renderTags();
        onChange({ ...state });
      }
    }
    if (e.key === 'Backspace' && !extInput.value && state.extensions.length) {
      state.extensions = state.extensions.slice(0, -1);
      renderTags();
      onChange({ ...state });
    }
  });

  renderTags();
  extWrap.appendChild(tagRow);

  // ── Filename ─────────────────────────────────────────────────────────
  const fnWrap = makeFieldWrap('Filename');
  const fnInput = makeTextInput('*.test.*');
  fnInput.addEventListener('input', debounce(() => {
    state.filename = fnInput.value.trim();
    onChange({ ...state });
  }, 400));
  fnWrap.appendChild(fnInput);

  // ── Path ─────────────────────────────────────────────────────────────
  const pathWrap = makeFieldWrap('Path');
  const pathInput = makeTextInput('src/components');
  pathInput.addEventListener('input', debounce(() => {
    state.path = pathInput.value.trim();
    onChange({ ...state });
  }, 400));
  pathWrap.appendChild(pathInput);

  // ── Search mode toggle ───────────────────────────────────────────────
  const modeWrap = makeFieldWrap('Mode');
  const modeBtn = document.createElement('button');
  modeBtn.textContent = 'Fuzzy';
  modeBtn.style.cssText = 'border:1px solid var(--gl-border-color-default);border-radius:4px;padding:3px 10px;cursor:pointer;background:var(--gl-background-color-default);color:var(--gl-text-color-primary);font:inherit;';
  modeBtn.addEventListener('click', () => {
    state.mode = state.mode === 'fuzzy' ? 'exact' : 'fuzzy';
    modeBtn.textContent = state.mode === 'fuzzy' ? 'Fuzzy' : 'Exact';
    modeBtn.style.background = state.mode === 'exact' ? 'var(--gl-color-blue-500,#1f75cb)' : 'var(--gl-background-color-default)';
    modeBtn.style.color = state.mode === 'exact' ? '#fff' : 'var(--gl-text-color-primary)';
    onChange({ ...state });
  });
  modeWrap.appendChild(modeBtn);

  // ── Clear all ────────────────────────────────────────────────────────
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear filters';
  clearBtn.style.cssText = 'border:1px solid var(--gl-border-color-default);border-radius:4px;padding:3px 10px;cursor:pointer;background:var(--gl-background-color-default);font:inherit;color:var(--gl-text-color-secondary);';
  clearBtn.addEventListener('click', () => {
    state.extensions = [];
    state.filename = '';
    state.path = '';
    state.mode = 'fuzzy';
    fnInput.value = '';
    pathInput.value = '';
    modeBtn.textContent = 'Fuzzy';
    modeBtn.style.background = 'var(--gl-background-color-default)';
    modeBtn.style.color = 'var(--gl-text-color-primary)';
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

export function createResultsContainer(): ResultsContainer {
  const wrap = document.createElement('div') as HTMLDivElement;
  wrap.id = 'gcs-results';

  const status = document.createElement('div');
  status.style.cssText = 'padding:8px 16px;font:13px system-ui;color:var(--gl-text-color-secondary);border-bottom:1px solid var(--gl-border-color-default);';
  status.textContent = 'Loading…';

  const list = document.createElement('div');
  list.id = 'gcs-list';

  wrap.appendChild(status);
  wrap.appendChild(list);

  return {
    el: wrap,

    setStatus(loaded: number, total: number): void {
      if (total === 0) {
        status.textContent = 'No results';
      } else if (loaded >= total) {
        status.textContent = `${total.toLocaleString()} result${total !== 1 ? 's' : ''}`;
      } else {
        status.textContent = `Loading… ${loaded.toLocaleString()} / ~${total.toLocaleString()}`;
      }
    },

    appendResults(results: SearchResult[]): void {
      for (const r of results) list.appendChild(renderCard(r));
    },

    setError(msg: string): void {
      status.textContent = msg;
      status.style.color = 'var(--gl-text-color-danger,#c0392b)';
    },

    clear(): void {
      list.innerHTML = '';
      status.textContent = 'Loading…';
      status.style.color = 'var(--gl-text-color-secondary)';
    },
  };
}

function renderCard(result: SearchResult): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'gcs-card';
  card.style.cssText = 'border-bottom:1px solid var(--gl-border-color-default);font:13px/1.5 system-ui,-apple-system,sans-serif;';

  // ── Header row (always visible, click to toggle snippet) ─────────────
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:baseline;gap:6px;padding:8px 16px;cursor:pointer;user-select:none;';

  const chevron = document.createElement('span');
  chevron.className = 'gcs-chevron';
  chevron.textContent = '▶';
  chevron.style.cssText = 'font-size:9px;color:var(--gl-text-color-secondary);flex-shrink:0;transition:transform .1s;';

  const meta = document.createElement('div');
  meta.style.cssText = 'flex:1;min-width:0;';

  if (result.project_path) {
    const repoLabel = document.createElement('span');
    repoLabel.textContent = result.project_path + ' · ';
    repoLabel.style.cssText = 'font-size:11px;color:var(--gl-text-color-secondary);';
    meta.appendChild(repoLabel);
  }

  const link = document.createElement('a');
  if (result.project_path) {
    link.href = `${location.origin}/${result.project_path}/-/blob/${result.ref}/${result.path}`;
    link.textContent = result.path;
  } else {
    link.href = `${location.origin}/${result.path}`;
    link.textContent = result.path;
  }
  link.style.cssText = 'color:var(--gl-text-color-link);text-decoration:none;font-weight:500;word-break:break-all;';
  link.addEventListener('mouseenter', () => { link.style.textDecoration = 'underline'; });
  link.addEventListener('mouseleave', () => { link.style.textDecoration = 'none'; });
  // Stop click on link from also toggling the card
  link.addEventListener('click', e => e.stopPropagation());
  meta.appendChild(link);

  const ref = document.createElement('span');
  ref.textContent = ` · ${result.ref}`;
  ref.style.cssText = 'font-size:11px;color:var(--gl-text-color-secondary);';
  meta.appendChild(ref);

  header.appendChild(chevron);
  header.appendChild(meta);
  card.appendChild(header);

  // ── Snippet (collapsed by default) ───────────────────────────────────
  const snippet = document.createElement('pre');
  snippet.className = 'gcs-snippet';
  snippet.style.cssText = 'display:none;margin:0;padding:8px 16px 10px 32px;background:var(--gl-background-color-subtle);overflow:auto;font:12px/1.4 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:200px;';
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

export function createExportToolbar(getAllResults: () => SearchResult[]): HTMLDivElement {
  const toolbar = document.createElement('div');
  toolbar.id = 'gcs-toolbar';
  toolbar.style.cssText = 'padding:8px 16px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--gl-border-color-default);background:var(--gl-background-color-subtle);';

  toolbar.appendChild(makeToolbarBtn('Expand all', () => {
    document.querySelectorAll<HTMLElement>('#gcs-list .gcs-snippet').forEach(el => {
      el.style.display = 'block';
    });
    document.querySelectorAll<HTMLElement>('#gcs-list .gcs-chevron').forEach(el => {
      el.style.transform = 'rotate(90deg)';
    });
  }));

  toolbar.appendChild(makeToolbarBtn('Collapse all', () => {
    document.querySelectorAll<HTMLElement>('#gcs-list .gcs-snippet').forEach(el => {
      el.style.display = 'none';
    });
    document.querySelectorAll<HTMLElement>('#gcs-list .gcs-chevron').forEach(el => {
      el.style.transform = '';
    });
  }));

  const divider = document.createElement('span');
  divider.style.cssText = 'width:1px;background:var(--gl-border-color-default);margin:2px 0;';
  toolbar.appendChild(divider);

  toolbar.appendChild(makeToolbarBtn('Export JSON', () => {
    triggerDownload(JSON.stringify(getAllResults(), null, 2), 'application/json', 'json');
  }));

  toolbar.appendChild(makeToolbarBtn('Export CSV', () => {
    triggerDownload(toCsv(getAllResults()), 'text/csv', 'csv');
  }));

  const copyBtn = makeToolbarBtn('Copy repos', async () => {
    const repos = extractRepoPaths(getAllResults()).join('\n');
    try {
      await navigator.clipboard.writeText(repos);
      const orig = copyBtn.textContent ?? '';
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = orig; }, 1500);
    } catch {
      copyBtn.textContent = 'Copy failed';
      setTimeout(() => { copyBtn.textContent = 'Copy repos'; }, 2000);
    }
  });
  toolbar.appendChild(copyBtn);

  return toolbar;
}

// ── Private helpers ───────────────────────────────────────────────────

function makeFieldWrap(label: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.cssText = 'font-size:11px;font-weight:600;color:var(--gl-text-color-secondary);text-transform:uppercase;letter-spacing:.4px;';
  wrap.appendChild(lbl);
  return wrap;
}

function makeTextInput(placeholder: string): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = placeholder;
  inp.style.cssText = 'border:1px solid var(--gl-border-color-default);border-radius:4px;padding:3px 6px;width:140px;font:inherit;background:var(--gl-background-color-default);color:var(--gl-text-color-primary);';
  return inp;
}

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let t: ReturnType<typeof setTimeout>;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function makeToolbarBtn(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = 'border:1px solid var(--gl-border-color-default);border-radius:4px;padding:3px 10px;cursor:pointer;background:var(--gl-background-color-default);font:12px system-ui;color:var(--gl-text-color-primary);';
  btn.addEventListener('click', onClick);
  return btn;
}

function triggerDownload(content: string, mimeType: string, ext: string): void {
  const raw = (document.querySelector(
    'input[data-testid="search-page-input"], input[name="search"]',
  ) as HTMLInputElement | null)?.value ?? 'results';
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gitlab-search-${slug}-${date}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}
