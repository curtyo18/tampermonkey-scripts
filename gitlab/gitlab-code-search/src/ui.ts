import { toCsv, extractRepoPaths } from './utils.js';
import type { FilterState, SearchResult, ResultsContainer, FilterPanel } from './types.js';

export function createFilterPanel(onChange: (state: FilterState) => void): FilterPanel {
  const state: FilterState = { extensions: [], filename: '', path: '', mode: 'fuzzy' };

  const panel = document.createElement('div');
  panel.id = 'gcs-panel';
  panel.style.cssText = [
    'padding:10px 16px',
    'background:var(--gl-background-color-subtle,#f5f5f5)',
    'border-bottom:1px solid var(--gl-border-color-default,#ddd)',
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
  tagRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;align-items:center;min-height:26px;padding:2px 4px;border:1px solid #ccc;border-radius:4px;background:#fff;';

  const extInput = document.createElement('input');
  extInput.type = 'text';
  extInput.placeholder = 'js, ts…';
  extInput.style.cssText = 'border:none;outline:none;width:70px;font:inherit;';

  function renderTags(): void {
    // Remove tag spans only; leave extInput in place to preserve focus and input state
    Array.from(tagRow.children).forEach(child => {
      if (child !== extInput) tagRow.removeChild(child);
    });
    for (const ext of state.extensions) {
      const tag = document.createElement('span');
      tag.style.cssText = 'background:#e2e8f0;border-radius:3px;padding:1px 4px;display:flex;align-items:center;gap:3px;font-size:12px;';
      tag.appendChild(document.createTextNode(ext));
      const rm = document.createElement('button');
      rm.textContent = '×';
      rm.style.cssText = 'border:none;background:none;cursor:pointer;padding:0;line-height:1;font-size:14px;color:#555;';
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
  modeBtn.style.cssText = 'border:1px solid #ccc;border-radius:4px;padding:3px 10px;cursor:pointer;background:#fff;font:inherit;';
  modeBtn.addEventListener('click', () => {
    state.mode = state.mode === 'fuzzy' ? 'exact' : 'fuzzy';
    modeBtn.textContent = state.mode === 'fuzzy' ? 'Fuzzy' : 'Exact';
    modeBtn.style.background = state.mode === 'exact' ? '#1f75cb' : '#fff';
    modeBtn.style.color = state.mode === 'exact' ? '#fff' : '#333';
    onChange({ ...state });
  });
  modeWrap.appendChild(modeBtn);

  // ── Clear all ────────────────────────────────────────────────────────
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear filters';
  clearBtn.style.cssText = 'border:1px solid #ccc;border-radius:4px;padding:3px 10px;cursor:pointer;background:#fff;font:inherit;color:#555;';
  clearBtn.addEventListener('click', () => {
    state.extensions = [];
    state.filename = '';
    state.path = '';
    state.mode = 'fuzzy';
    fnInput.value = '';
    pathInput.value = '';
    modeBtn.textContent = 'Fuzzy';
    modeBtn.style.background = '#fff';
    modeBtn.style.color = '#333';
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
  status.style.cssText = 'padding:8px 16px;font:13px system-ui;color:#666;border-bottom:1px solid var(--gl-border-color-default,#eee);';
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
      status.style.color = '#c0392b';
    },

    clear(): void {
      list.innerHTML = '';
      status.textContent = 'Loading…';
      status.style.color = '#666';
    },
  };
}

function renderCard(result: SearchResult): HTMLDivElement {
  const card = document.createElement('div');
  card.style.cssText = 'padding:12px 16px;border-bottom:1px solid var(--gl-border-color-default,#eee);font:13px/1.5 system-ui,-apple-system,sans-serif;';

  const header = document.createElement('div');
  header.style.marginBottom = '6px';

  const link = document.createElement('a');
  link.href = `${location.origin}/${result.path}`;
  link.textContent = result.path;
  link.style.cssText = 'color:var(--gl-text-color-link,#1068bf);text-decoration:none;font-weight:500;word-break:break-all;';
  link.addEventListener('mouseenter', () => { link.style.textDecoration = 'underline'; });
  link.addEventListener('mouseleave', () => { link.style.textDecoration = 'none'; });

  const ref = document.createElement('span');
  ref.textContent = ` · ${result.ref}`;
  ref.style.color = '#888';

  header.appendChild(link);
  header.appendChild(ref);
  card.appendChild(header);

  if (result.data) {
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:0;padding:8px 10px;background:var(--gl-background-color-subtle,#f8f9fa);border-radius:4px;overflow:auto;font:12px/1.4 "SFMono-Regular",Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:200px;';
    const lineHint = result.startline ? `Line ${result.startline}: ` : '';
    pre.textContent = lineHint + result.data.slice(0, 800);
    card.appendChild(pre);
  }

  return card;
}

export function createExportToolbar(getAllResults: () => SearchResult[]): HTMLDivElement {
  const toolbar = document.createElement('div');
  toolbar.id = 'gcs-toolbar';
  toolbar.style.cssText = 'padding:8px 16px;display:flex;gap:8px;border-top:1px solid var(--gl-border-color-default,#eee);background:var(--gl-background-color-subtle,#f9f9f9);';

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
  lbl.style.cssText = 'font-size:11px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:.4px;';
  wrap.appendChild(lbl);
  return wrap;
}

function makeTextInput(placeholder: string): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = placeholder;
  inp.style.cssText = 'border:1px solid #ccc;border-radius:4px;padding:3px 6px;width:140px;font:inherit;';
  return inp;
}

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let t: ReturnType<typeof setTimeout>;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function makeToolbarBtn(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = 'border:1px solid #ccc;border-radius:4px;padding:3px 10px;cursor:pointer;background:#fff;font:12px system-ui;color:#333;';
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
