import { describe, it, expect } from 'vitest';
import { resolveApiEndpoint, buildQuery, extractRepoPaths, toCsv } from '../src/utils.js';
import type { SearchResult } from '../src/types.js';

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
});

describe('buildQuery', () => {
  it('returns the main query unchanged when no filters', () => {
    expect(buildQuery('getUserId', {})).toBe('getUserId');
  });

  it('trims whitespace from main query', () => {
    expect(buildQuery('  foo  ', {})).toBe('foo');
  });

  it('appends a single extension filter', () => {
    expect(buildQuery('foo', { extensions: ['js'] })).toBe('foo extension:js');
  });

  it('appends multiple extension filters', () => {
    expect(buildQuery('foo', { extensions: ['js', 'ts'] })).toBe('foo extension:js extension:ts');
  });

  it('appends filename filter', () => {
    expect(buildQuery('foo', { filename: '*.test.*' })).toBe('foo filename:*.test.*');
  });

  it('appends path filter', () => {
    expect(buildQuery('foo', { path: 'src/components' })).toBe('foo path:src/components');
  });

  it('combines all filters', () => {
    expect(buildQuery('foo', { extensions: ['rb'], filename: 'bar', path: 'lib' }))
      .toBe('foo extension:rb filename:bar path:lib');
  });

  it('ignores empty string filters', () => {
    expect(buildQuery('foo', { extensions: [], filename: '', path: '' })).toBe('foo');
  });

  it('handles empty main query with a filter', () => {
    expect(buildQuery('', { extensions: ['js'] })).toBe('extension:js');
  });
});

describe('extractRepoPaths', () => {
  it('returns unique namespace/project pairs', () => {
    const results: SearchResult[] = [
      { path: 'org/repo1/src/a.ts', project_id: 1, filename: 'a.ts', ref: 'main', startline: 1 },
      { path: 'org/repo1/src/b.ts', project_id: 1, filename: 'b.ts', ref: 'main', startline: 2 },
      { path: 'org/repo2/lib/c.ts', project_id: 2, filename: 'c.ts', ref: 'main', startline: 3 },
    ];
    expect(extractRepoPaths(results)).toEqual(['org/repo1', 'org/repo2']);
  });

  it('returns a sorted list', () => {
    const r = (path: string): SearchResult => ({ path, project_id: 1, filename: '', ref: 'main', startline: 1 });
    expect(extractRepoPaths([r('z/z/x.ts'), r('a/a/x.ts')])).toEqual(['a/a', 'z/z']);
  });

  it('takes the first two segments from deep paths', () => {
    const r = (path: string): SearchResult => ({ path, project_id: 1, filename: '', ref: 'main', startline: 1 });
    expect(extractRepoPaths([r('org/repo/src/deep/file.ts')])).toEqual(['org/repo']);
  });

  it('returns empty array for empty input', () => {
    expect(extractRepoPaths([])).toEqual([]);
  });

  it('ignores results with fewer than two path segments', () => {
    const r: SearchResult = { path: 'onlyone', project_id: null, filename: '', ref: 'main', startline: null };
    expect(extractRepoPaths([r])).toEqual([]);
  });
});

describe('toCsv', () => {
  it('first row is the header', () => {
    expect(toCsv([])).toBe('project_id,path,filename,ref,startline');
  });

  it('produces one data row per result', () => {
    const r: SearchResult = { project_id: 1, path: 'org/repo/a.ts', filename: 'a.ts', ref: 'main', startline: 10 };
    const rows = toCsv([r]).split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('"org/repo/a.ts"');
  });

  it('escapes double quotes in values', () => {
    const r: SearchResult = { project_id: 1, path: 'x', filename: 'b"c', ref: 'main', startline: 1 };
    expect(toCsv([r])).toContain('"b""c"');
  });

  it('handles null fields gracefully', () => {
    const r: SearchResult = { project_id: null, path: '', filename: '', ref: '', startline: null };
    const csv = toCsv([r]);
    expect(csv.split('\n')[1]).toContain('""');
  });
});
