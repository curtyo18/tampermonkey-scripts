import type { FilterState, ApiError } from './types.js';
import { resolveApiEndpoint, buildQuery } from './utils.js';
import { fetchAllPages, resolveProjectPaths } from './api.js';
import { createFilterPanel, createResultsContainer, createExportToolbar } from './ui.js';
import type { SearchResult, ResultsContainer } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────

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

function findInjectionPoint(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('.results-list')?.parentElement ??
    document.querySelector<HTMLElement>('.search-results-list')?.parentElement ??
    document.querySelector<HTMLElement>('main')
  );
}

// ── Search ────────────────────────────────────────────────────────────

async function runSearch(container: ResultsContainer, filterState: FilterState, session: { results: SearchResult[] }): Promise<void> {
  const query = buildQuery(getNativeQuery(), filterState);
  if (!query) return;

  const endpoint = resolveApiEndpoint(location.pathname, getProjectId());
  session.results = [];
  container.clear();

  function handleError(err: ApiError): void {
    if (err.status === 401 || err.status === 403) {
      container.setError('Not authorised — are you logged in?');
    } else if (err.status === 404) {
      container.setError('Search endpoint not found — is Advanced Search enabled on this instance?');
    } else {
      container.setError(`Search failed: ${err.message}`);
    }
  }

  try {
    // Collect all pages first, showing fetch progress but deferring render until
    // project paths are resolved — otherwise links would all point to the wrong place.
    const rawResults = await fetchAllPages(endpoint, query, {
      onBatch(_, loaded, total) {
        container.setStatus(loaded, total);
      },
      onError: handleError,
    });

    // Resolve project paths for every unique project_id in the result set.
    // The GitLab blob search API only returns a numeric project_id; the namespace/repo
    // path needed to build correct file URLs must be fetched separately.
    const uniqueIds = [
      ...new Set(rawResults.map(r => r.project_id).filter((id): id is number => id !== null)),
    ];
    const projectPaths = await resolveProjectPaths(uniqueIds);

    const enriched: SearchResult[] = rawResults.map(r => ({
      ...r,
      project_path: r.project_id != null ? (projectPaths.get(r.project_id) ?? undefined) : undefined,
    }));

    // Extension filtering: single extension is handled server-side (see buildQuery).
    // Multiple extensions require client-side OR logic because GitLab applies AND between
    // multiple extension: filters, which returns zero results.
    const filtered =
      filterState.extensions.length > 1
        ? enriched.filter(r => {
            const ext = r.filename.split('.').pop()?.toLowerCase() ?? '';
            return filterState.extensions.some(e => e.toLowerCase() === ext);
          })
        : enriched;

    session.results = filtered;
    container.appendResults(filtered);
    container.setStatus(filtered.length, filtered.length);
    if (filtered.length === 0) container.setStatus(0, 0);
  } catch (err) {
    handleError(err as ApiError);
  }
}

// ── Init ──────────────────────────────────────────────────────────────

function cleanup(): void {
  document.getElementById('gcs-panel')?.remove();
  document.getElementById('gcs-results')?.remove();
  document.getElementById('gcs-toolbar')?.remove();
}

function init(): void {
  cleanup();
  const injectionPoint = findInjectionPoint();
  if (!injectionPoint) {
    console.warn('[gcs] Could not find injection point — DOM selectors may need updating for this GitLab version');
    return;
  }

  hideNativeResults();

  const session = { results: [] as SearchResult[] };
  const container = createResultsContainer();
  const toolbar = createExportToolbar(() => session.results);
  const { panel } = createFilterPanel(state => { void runSearch(container, state, session); });

  injectionPoint.insertBefore(panel, injectionPoint.firstChild);
  panel.insertAdjacentElement('afterend', container.el);
  container.el.insertAdjacentElement('afterend', toolbar);

  void runSearch(container, { extensions: [], filename: '', path: '', mode: 'fuzzy' }, session);
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

// ── SPA navigation ────────────────────────────────────────────────────

(function (h: History) {
  const fire = (): void => { window.dispatchEvent(new Event('gcs-nav')); };
  const ps = h.pushState.bind(h);
  const rs = h.replaceState.bind(h);
  h.pushState    = function (...a: Parameters<typeof h.pushState>)    { const r = ps(...a); fire(); return r; };
  h.replaceState = function (...a: Parameters<typeof h.replaceState>) { const r = rs(...a); fire(); return r; };
  window.addEventListener('popstate', fire);
})(window.history);

let navDebounce: ReturnType<typeof setTimeout>;
function isSearchPage(): boolean {
  const p = location.pathname;
  return p.endsWith('/search') || p.includes('/-/search');
}

function onNav(): void {
  clearTimeout(navDebounce);
  navDebounce = setTimeout(() => {
    if (!isSearchPage()) return;
    waitForDom(init);
  }, 250);
}

window.addEventListener('gcs-nav', onNav);
document.addEventListener('turbo:load', onNav);
document.addEventListener('turbo:render', onNav);

// ── Boot ──────────────────────────────────────────────────────────────

waitForDom(init);
