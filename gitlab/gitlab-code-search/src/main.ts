import type { ApiError, SearchResult } from './types.js';
import { resolveApiEndpoint } from './utils.js';
import { fetchAllPages, resolveProjectPaths } from './api.js';
import { createPanel } from './ui.js';
import type { PanelHandle } from './ui.js';

// ── Page helpers ──────────────────────────────────────────────────────────────

function getProjectId(): number | null {
  const raw = (document.body as HTMLElement & { dataset: DOMStringMap }).dataset.projectId;
  return raw ? parseInt(raw, 10) : null;
}

function getNativeQuery(): string {
  const input = document.querySelector<HTMLInputElement>(
    'input[data-testid="search-page-input"], input[name="search"]',
  );
  return input?.value.trim() ?? '';
}

function hideNativeResults(): void {
  document.querySelectorAll<HTMLElement>(
    '.results-list, .search-results-list, .search-results ul',
  ).forEach(el => { el.style.display = 'none'; });
}

function showNativeResults(): void {
  document.querySelectorAll<HTMLElement>(
    '.results-list, .search-results-list, .search-results ul',
  ).forEach(el => { el.style.display = ''; });
}

function findInjectionPoint(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('.results-list')?.parentElement ??
    document.querySelector<HTMLElement>('.search-results-list')?.parentElement ??
    document.querySelector<HTMLElement>('main')
  );
}

function isSearchPage(): boolean {
  const p = location.pathname;
  return p.endsWith('/search') || p.includes('/-/search');
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function runSearch(panel: PanelHandle, query: string): Promise<void> {
  const endpoint = resolveApiEndpoint(location.pathname, getProjectId());
  panel.clear();

  function handleError(err: ApiError): void {
    if (err.status === 401 || err.status === 403) {
      panel.setError('Not authorised — are you logged in?');
    } else if (err.status === 404) {
      panel.setError('Search endpoint not found — is Advanced Search enabled on this instance?');
    } else {
      panel.setError(`Search failed: ${err.message}`);
    }
  }

  try {
    const rawResults = await fetchAllPages(endpoint, query, {
      onBatch(_, loaded, total) {
        panel.setFetchProgress(loaded, total);
      },
      onError: handleError,
    });

    const uniqueIds = [
      ...new Set(rawResults.map(r => r.project_id).filter((id): id is number => id !== null)),
    ];
    const projectPaths = await resolveProjectPaths(uniqueIds);

    const enriched: SearchResult[] = rawResults.map(r => ({
      ...r,
      project_path: r.project_id != null ? (projectPaths.get(r.project_id) ?? undefined) : undefined,
    }));

    panel.setResults(enriched);
  } catch (err) {
    handleError(err as ApiError);
  }
}

// ── Trigger button ────────────────────────────────────────────────────────────

let activePanel: PanelHandle | null = null;

function injectTrigger(): void {
  if (document.getElementById('gcs-trigger')) return;

  const btn = document.createElement('button');
  btn.id = 'gcs-trigger';
  btn.type = 'button';
  btn.textContent = '⚡ Enhanced Search';
  btn.style.cssText = [
    'display:block',
    'margin:0 0 12px',
    'padding:6px 14px',
    'border:1px solid var(--gl-border-color-default, ButtonBorder)',
    'border-radius:6px',
    'background:var(--gl-background-color-default, Canvas)',
    'color:var(--gl-text-color-primary, CanvasText)',
    'font:13px/1.5 system-ui,-apple-system,sans-serif',
    'cursor:pointer',
  ].join(';');

  btn.addEventListener('click', activate);

  const point = findInjectionPoint();
  if (point) point.insertBefore(btn, point.firstChild);
}

function activate(): void {
  document.getElementById('gcs-trigger')?.remove();
  hideNativeResults();

  const panel = createPanel(getNativeQuery(), query => { void runSearch(panel, query); });
  panel.closeBtn.addEventListener('click', deactivate);

  const point = findInjectionPoint();
  if (point) point.insertBefore(panel.el, point.firstChild);

  activePanel = panel;
}

function deactivate(): void {
  activePanel?.el.remove();
  activePanel = null;
  showNativeResults();
  injectTrigger();
}

// ── Boot + SPA nav ────────────────────────────────────────────────────────────

function resetPage(): void {
  // On navigation, tear down any active panel and re-inject the trigger
  activePanel?.el.remove();
  activePanel = null;
  document.getElementById('gcs-trigger')?.remove();
  showNativeResults();
}

function waitForDom(callback: () => void): void {
  const selectors = ['.results-list', '.search-results-list', 'main'];
  if (selectors.some(s => document.querySelector(s))) { callback(); return; }

  const obs = new MutationObserver(() => {
    if (selectors.some(s => document.querySelector(s))) {
      obs.disconnect();
      clearTimeout(timer);
      callback();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  const timer = setTimeout(() => { obs.disconnect(); callback(); }, 3000);
}

(function patchHistory(h: History) {
  const fire = (): void => { window.dispatchEvent(new Event('gcs-nav')); };
  const ps = h.pushState.bind(h);
  const rs = h.replaceState.bind(h);
  h.pushState    = function (...a: Parameters<typeof h.pushState>)    { const r = ps(...a); fire(); return r; };
  h.replaceState = function (...a: Parameters<typeof h.replaceState>) { const r = rs(...a); fire(); return r; };
  window.addEventListener('popstate', fire);
})(window.history);

let navDebounce: ReturnType<typeof setTimeout>;
function onNav(): void {
  clearTimeout(navDebounce);
  navDebounce = setTimeout(() => {
    if (!isSearchPage()) return;
    resetPage();
    waitForDom(injectTrigger);
  }, 250);
}

window.addEventListener('gcs-nav', onNav);
document.addEventListener('turbo:load', onNav);
document.addEventListener('turbo:render', onNav);

waitForDom(injectTrigger);
