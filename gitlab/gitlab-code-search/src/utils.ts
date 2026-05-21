import type { SearchResult, DeepMatch } from './types.js';

export function resolveApiEndpoint(pathname: string, projectId: number | null): string {
  if (/^\/-\/search/.test(pathname)) return '/api/v4/search';

  // .+? intentionally matches slashes — GitLab nested groups use /groups/parent/child/-/search
  const groupMatch = pathname.match(/^\/groups\/(.+?)\/-\/search/);
  if (groupMatch) return `/api/v4/groups/${groupMatch[1]}/search`;

  if (projectId !== null) return `/api/v4/projects/${projectId}/search`;

  return '/api/v4/search';
}

/**
 * Build the API query string from the raw query and quick-add fields.
 * Single extension is sent server-side (GitLab supports it); multiple
 * extensions cannot be ANDed server-side so they are filtered client-side.
 */
export function buildApiQuery(rawQuery: string, filename: string, extension: string): string {
  const parts = [rawQuery.trim()];
  if (filename.trim()) parts.push(`filename:${filename.trim()}`);
  const exts = parseExtensions(extension);
  if (exts.length === 1) parts.push(`extension:${exts[0]}`);
  return parts.filter(Boolean).join(' ');
}

/**
 * Deduplicate results to one entry per unique file (project_id + path + ref).
 * Used to count and drive deep content searches.
 */
export function uniqueFiles(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = `${r.project_id}:${r.path}:${r.ref}`;
    if (!seen.has(key)) { seen.add(key); out.push(r); }
  }
  return out;
}

/** Parse a comma/space-separated extension string into normalised extension tokens. */
export function parseExtensions(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map(e => e.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
}

/**
 * Client-side filter applied to already-fetched results.
 * Extension match is exact suffix; text match is a case-insensitive literal
 * substring across path, filename, and code snippet — finds "hello-world"
 * even when GitLab's tokeniser split it at the hyphen.
 */
export function filterResults(
  results: SearchResult[],
  textFilter: string,
  extensions: string[],
): SearchResult[] {
  let out = results;

  if (extensions.length > 0) {
    out = out.filter(r => {
      const ext = r.filename.split('.').pop()?.toLowerCase() ?? '';
      return extensions.includes(ext);
    });
  }

  if (textFilter.trim()) {
    const q = textFilter.toLowerCase();
    out = out.filter(r =>
      r.path.toLowerCase().includes(q) ||
      r.filename.toLowerCase().includes(q) ||
      (r.data?.toLowerCase().includes(q) ?? false),
    );
  }

  return out;
}

export function extractRepoPaths(results: SearchResult[]): string[] {
  const seen = new Set<string>();
  for (const r of results) {
    if (r.project_path) seen.add(r.project_path);
  }
  return [...seen].sort();
}

export function toCsv(results: SearchResult[]): string {
  const cols: (keyof SearchResult)[] = ['project_id', 'path', 'filename', 'ref', 'startline'];
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = results.map(r => cols.map(c => esc(r[c])).join(','));
  return [cols.join(','), ...rows].join('\n');
}

/** CSV for deep search results — one row per matching line. */
export function toCsvDeep(matches: DeepMatch[]): string {
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'project_id,project_path,path,filename,ref,lineNum,text';
  const rows: string[] = [];
  for (const { result: r, lines } of matches) {
    for (const { lineNum, text } of lines) {
      rows.push([
        esc(r.project_id), esc(r.project_path), esc(r.path),
        esc(r.filename), esc(r.ref), esc(lineNum), esc(text),
      ].join(','));
    }
  }
  return [header, ...rows].join('\n');
}
