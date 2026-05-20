import { describe, it, expect } from 'vitest';
import { resolveApiEndpoint, buildQuery } from '../src/utils.js';

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
