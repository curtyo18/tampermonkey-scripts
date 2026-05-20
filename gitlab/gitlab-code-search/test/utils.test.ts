import { describe, it, expect } from 'vitest';
import { resolveApiEndpoint } from '../src/utils.js';

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
