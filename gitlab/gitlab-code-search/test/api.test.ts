import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { SearchResult } from '../src/types.js';
import { fetchPage, fetchAllPages } from '../src/api.js';

function makeResponse(data: SearchResult[], totalPages: number, total: number): Response {
  return {
    ok: true,
    headers: { get: (h: string) => h === 'X-Total-Pages' ? String(totalPages) : String(total) },
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

afterEach(() => vi.restoreAllMocks());

describe('fetchPage', () => {
  it('calls the correct URL with scope and pagination params', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse([], 1, 0));
    await fetchPage('/api/v4/search', 'hello extension:js', 2);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('search=hello%20extension%3Ajs'),
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.anything());
  });

  it('returns data, totalPages, and total', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse([{ path: 'a/b/c.ts', project_id: 1, filename: 'c.ts', ref: 'main', startline: 1 }], 3, 250),
    );
    const result = await fetchPage('/api/v4/search', 'foo', 1);
    expect(result.data).toHaveLength(1);
    expect(result.totalPages).toBe(3);
    expect(result.total).toBe(250);
  });

  it('throws with status on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(fetchPage('/api/v4/search', 'foo', 1)).rejects.toMatchObject({ status: 401 });
  });
});

describe('fetchAllPages', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'sessionStorage', 'get').mockReturnValue({
      getItem: () => null,
      setItem: () => {},
    } as unknown as Storage);
  });

  it('returns all results from a single page', async () => {
    const r: SearchResult = { path: 'a/b/c.ts', project_id: 1, filename: 'c.ts', ref: 'main', startline: 1 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse([r], 1, 1));
    const results = await fetchAllPages('/api/v4/search', 'foo');
    expect(results).toEqual([r]);
  });

  it('calls onBatch for each page', async () => {
    const r1: SearchResult = { path: 'a/b/x.ts', project_id: 1, filename: 'x.ts', ref: 'main', startline: 1 };
    const r2: SearchResult = { path: 'a/b/y.ts', project_id: 1, filename: 'y.ts', ref: 'main', startline: 2 };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeResponse([r1], 2, 2))
      .mockResolvedValueOnce(makeResponse([r2], 2, 2));
    const batches: SearchResult[][] = [];
    await fetchAllPages('/api/v4/search', 'foo', { onBatch: b => batches.push(b) });
    expect(batches).toHaveLength(2);
    expect(batches[0]).toEqual([r1]);
  });

  it('calls onError for failed pages but continues with successful ones', async () => {
    const r: SearchResult = { path: 'a/b/x.ts', project_id: 1, filename: 'x.ts', ref: 'main', startline: 1 };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeResponse([r], 2, 2))
      .mockRejectedValueOnce(new Error('network fail'));
    const errors: Error[] = [];
    const results = await fetchAllPages('/api/v4/search', 'foo', { onError: e => errors.push(e) });
    expect(results).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});
