import type { PageResult, FetchCallbacks, SearchResult, ApiError, DeepMatch } from './types.js';

const CONCURRENCY = 5;
const DEEP_CONCURRENCY = 3; // gentler rate for full-file fetches

// ── Project path resolution ───────────────────────────────────────────

const projectPathCache = new Map<number, string>();

async function resolveProjectPath(id: number): Promise<string | null> {
  if (projectPathCache.has(id)) return projectPathCache.get(id)!;
  try {
    const resp = await fetch(`/api/v4/projects/${id}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const p = await resp.json() as { path_with_namespace: string };
    projectPathCache.set(id, p.path_with_namespace);
    return p.path_with_namespace;
  } catch {
    return null;
  }
}

export async function resolveProjectPaths(ids: number[]): Promise<Map<number, string>> {
  const entries = await Promise.all(
    ids.map(async id => [id, await resolveProjectPath(id)] as const)
  );
  return new Map(entries.filter((e): e is [number, string] => e[1] !== null));
}

export async function fetchPage(endpoint: string, query: string, page: number): Promise<PageResult> {
  const url = `${endpoint}?scope=blobs&search=${encodeURIComponent(query)}&page=${page}&per_page=100`;
  const resp = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    const err: ApiError = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const data = (await resp.json()) as SearchResult[];
  return {
    data,
    totalPages: parseInt(resp.headers.get('X-Total-Pages') ?? '1', 10),
    total: parseInt(resp.headers.get('X-Total') ?? String(data.length), 10),
  };
}

export async function fetchAllPages(
  endpoint: string,
  query: string,
  { onBatch, onError }: FetchCallbacks = {},
): Promise<SearchResult[]> {
  const cacheKey = `gcs:${endpoint}:${query}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const results = JSON.parse(cached) as SearchResult[];
      onBatch?.(results, results.length, results.length);
      return results;
    }
  } catch { /* sessionStorage unavailable */ }

  const first = await fetchPage(endpoint, query, 1);
  const all: SearchResult[] = [...first.data];
  onBatch?.(first.data, all.length, first.total);

  const remaining = Array.from({ length: first.totalPages - 1 }, (_, i) => i + 2);

  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const chunk = remaining.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map(p => fetchPage(endpoint, query, p)));
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        all.push(...result.value.data);
        onBatch?.(result.value.data, all.length, first.total);
      } else {
        onError?.(result.reason as ApiError);
      }
    }
  }

  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(all));
  } catch { /* quota exceeded */ }

  return all;
}

// ── Deep content search ───────────────────────────────────────────────

/** Fetch a file's raw content via the repository files API. Returns null on failure. */
export async function fetchFileRaw(
  projectId: number,
  filePath: string,
  ref: string,
): Promise<string | null> {
  try {
    const url = `/api/v4/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(ref)}`;
    const resp = await fetch(url, { credentials: 'include', headers: { Accept: 'text/plain' } });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

export interface DeepSearchCallbacks {
  onProgress(done: number, total: number, matchCount: number): void;
}

/**
 * Fetch the raw content of each file in `files` and find lines containing
 * `query` (case-insensitive literal match). Results are streamed back via
 * onProgress and returned as an array of DeepMatch once complete.
 */
export async function deepSearchFiles(
  files: SearchResult[],
  query: string,
  { onProgress }: DeepSearchCallbacks,
): Promise<DeepMatch[]> {
  const total = files.length;
  let done = 0;
  const matches: DeepMatch[] = [];
  const q = query.toLowerCase();

  for (let i = 0; i < files.length; i += DEEP_CONCURRENCY) {
    const chunk = files.slice(i, i + DEEP_CONCURRENCY);
    await Promise.allSettled(
      chunk.map(async r => {
        if (r.project_id === null) { done++; onProgress(done, total, matches.length); return; }
        const content = await fetchFileRaw(r.project_id, r.path, r.ref);
        done++;
        if (!content) { onProgress(done, total, matches.length); return; }
        const lines = content
          .split('\n')
          .map((text, idx) => ({ lineNum: idx + 1, text }))
          .filter(({ text }) => text.toLowerCase().includes(q));
        if (lines.length > 0) matches.push({ result: r, lines });
        onProgress(done, total, matches.length);
      }),
    );
  }

  return matches;
}
