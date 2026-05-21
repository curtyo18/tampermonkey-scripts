import { describe, it, expect } from 'vitest';
import { resolveApiEndpoint, buildApiQuery, uniqueFiles, filterResults, parseExtensions, extractRepoPaths, toCsv, toCsvDeep } from '../src/utils.js';
import type { SearchResult, DeepMatch } from '../src/types.js';

const r = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  project_id: 1,
  path: 'org/repo/src/file.ts',
  filename: 'file.ts',
  ref: 'main',
  startline: 1,
  data: 'export function hello() {}',
  project_path: 'org/repo',
  ...overrides,
});

describe('resolveApiEndpoint', () => {
  it('returns global endpoint for /-/search', () => {
    expect(resolveApiEndpoint('/-/search', null)).toBe('/api/v4/search');
  });

  it('returns group endpoint for group search path', () => {
    expect(resolveApiEndpoint('/groups/myorg/-/search', null))
      .toBe('/api/v4/groups/myorg/search');
  });

  it('preserves encoded slashes in nested group paths', () => {
    expect(resolveApiEndpoint('/groups/parent%2Fchild/-/search', null))
      .toBe('/api/v4/groups/parent%2Fchild/search');
  });

  it('returns project endpoint when projectId is provided', () => {
    expect(resolveApiEndpoint('/myns/myproject/-/search', 42))
      .toBe('/api/v4/projects/42/search');
  });

  it('falls back to global when projectId is null on non-group path', () => {
    expect(resolveApiEndpoint('/myns/myproject/-/search', null))
      .toBe('/api/v4/search');
  });

  it('returns global endpoint for bare /search path', () => {
    expect(resolveApiEndpoint('/search', null)).toBe('/api/v4/search');
  });
});

describe('buildApiQuery', () => {
  it('returns raw query unchanged when no quick-add fields', () => {
    expect(buildApiQuery('tanstack', '', '')).toBe('tanstack');
  });

  it('appends filename filter', () => {
    expect(buildApiQuery('tanstack', 'package-lock.json', '')).toBe('tanstack filename:package-lock.json');
  });

  it('appends single extension server-side', () => {
    expect(buildApiQuery('tanstack', '', 'ts')).toBe('tanstack extension:ts');
  });

  it('omits multiple extensions from API query (client-side only)', () => {
    expect(buildApiQuery('tanstack', '', 'ts, js')).toBe('tanstack');
  });

  it('combines filename and single extension', () => {
    expect(buildApiQuery('tanstack', 'package-lock.json', 'json'))
      .toBe('tanstack filename:package-lock.json extension:json');
  });

  it('handles empty raw query with filename only', () => {
    expect(buildApiQuery('', 'package-lock.json', '')).toBe('filename:package-lock.json');
  });
});

describe('uniqueFiles', () => {
  it('deduplicates results with the same project_id + path + ref', () => {
    const a = r({ path: 'src/a.ts', ref: 'main', startline: 1 });
    const b = r({ path: 'src/a.ts', ref: 'main', startline: 20 });
    const c = r({ path: 'src/b.ts', ref: 'main', startline: 1 });
    expect(uniqueFiles([a, b, c])).toHaveLength(2);
  });

  it('treats same path on different refs as distinct files', () => {
    const a = r({ path: 'src/a.ts', ref: 'main' });
    const b = r({ path: 'src/a.ts', ref: 'dev' });
    expect(uniqueFiles([a, b])).toHaveLength(2);
  });

  it('returns first occurrence when deduplicating', () => {
    const a = r({ path: 'src/a.ts', startline: 1 });
    const b = r({ path: 'src/a.ts', startline: 99 });
    expect(uniqueFiles([a, b])[0].startline).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(uniqueFiles([])).toHaveLength(0);
  });
});

describe('parseExtensions', () => {
  it('splits on commas', () => {
    expect(parseExtensions('js, ts')).toEqual(['js', 'ts']);
  });

  it('strips leading dots', () => {
    expect(parseExtensions('.js, .ts')).toEqual(['js', 'ts']);
  });

  it('splits on spaces', () => {
    expect(parseExtensions('js ts py')).toEqual(['js', 'ts', 'py']);
  });

  it('lowercases extensions', () => {
    expect(parseExtensions('TS, JS')).toEqual(['ts', 'js']);
  });

  it('returns empty array for empty string', () => {
    expect(parseExtensions('')).toEqual([]);
  });

  it('ignores extra delimiters', () => {
    expect(parseExtensions(',, js ,')).toEqual(['js']);
  });
});

describe('filterResults', () => {
  it('returns all results when both filters are empty', () => {
    const results = [r(), r({ filename: 'other.js' })];
    expect(filterResults(results, '', [])).toHaveLength(2);
  });

  it('filters by extension', () => {
    const results = [r({ filename: 'a.ts' }), r({ filename: 'b.js' }), r({ filename: 'c.py' })];
    expect(filterResults(results, '', ['ts', 'py'])).toHaveLength(2);
  });

  it('filters by text in filename', () => {
    const results = [r({ filename: 'package-lock.json' }), r({ filename: 'index.ts' })];
    expect(filterResults(results, 'package-lock', [])).toHaveLength(1);
  });

  it('filters by text in path', () => {
    const results = [r({ path: 'src/components/Button.tsx' }), r({ path: 'lib/utils.ts' })];
    expect(filterResults(results, 'components', [])).toHaveLength(1);
  });

  it('filters by text in data (code snippet)', () => {
    const results = [
      r({ data: 'const hello-world = 1;' }),
      r({ data: 'const foo = 2;' }),
    ];
    expect(filterResults(results, 'hello-world', [])).toHaveLength(1);
  });

  it('text filter is case-insensitive', () => {
    const results = [r({ data: 'const HelloWorld = 1;' })];
    expect(filterResults(results, 'helloworld', [])).toHaveLength(1);
  });

  it('applies extension AND text filter together', () => {
    const results = [
      r({ filename: 'a.ts', data: 'hello-world' }),
      r({ filename: 'b.js', data: 'hello-world' }),
      r({ filename: 'c.ts', data: 'other stuff' }),
    ];
    expect(filterResults(results, 'hello-world', ['ts'])).toHaveLength(1);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterResults([r()], 'xyzzy', [])).toHaveLength(0);
  });
});

describe('extractRepoPaths', () => {
  it('returns unique project_path values', () => {
    const results: SearchResult[] = [
      r({ project_path: 'org/repo1' }),
      r({ project_path: 'org/repo1' }),
      r({ project_path: 'org/repo2' }),
    ];
    expect(extractRepoPaths(results)).toEqual(['org/repo1', 'org/repo2']);
  });

  it('returns a sorted list', () => {
    expect(extractRepoPaths([r({ project_path: 'z/z' }), r({ project_path: 'a/a' })]))
      .toEqual(['a/a', 'z/z']);
  });

  it('returns empty array for empty input', () => {
    expect(extractRepoPaths([])).toEqual([]);
  });

  it('ignores results with no project_path', () => {
    const result: SearchResult = { path: 'x', project_id: null, filename: 'x', ref: 'main', startline: null };
    expect(extractRepoPaths([result])).toEqual([]);
  });
});

describe('toCsvDeep', () => {
  it('has the correct header', () => {
    expect(toCsvDeep([])).toBe('project_id,project_path,path,filename,ref,lineNum,text');
  });

  it('produces one row per matching line', () => {
    const match: DeepMatch = {
      result: r({ project_path: 'org/repo' }),
      lines: [
        { lineNum: 10, text: '"hello-world": "^1.0.0",' },
        { lineNum: 20, text: '"hello-world": "^2.0.0",' },
      ],
    };
    const rows = toCsvDeep([match]).split('\n');
    expect(rows).toHaveLength(3); // header + 2 lines
    expect(rows[1]).toContain('"10"');
    expect(rows[2]).toContain('"20"');
  });
});

describe('toCsv', () => {
  it('first row is the header', () => {
    expect(toCsv([])).toBe('project_id,path,filename,ref,startline');
  });

  it('produces one data row per result', () => {
    const rows = toCsv([r()]).split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('"org/repo/src/file.ts"');
  });

  it('escapes double quotes in values', () => {
    expect(toCsv([r({ filename: 'b"c' })])).toContain('"b""c"');
  });

  it('handles null fields gracefully', () => {
    const result: SearchResult = { project_id: null, path: '', filename: '', ref: '', startline: null };
    expect(toCsv([result]).split('\n')[1]).toContain('""');
  });
});
