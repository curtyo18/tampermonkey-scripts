import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchIssue, discoverAcFieldId } from '../src/api.js';
import type { RawIssue } from '../src/types.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => vi.restoreAllMocks());

describe('fetchIssue', () => {
  it('calls the v3 endpoint for cloud with credentials and expand', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ key: 'A-1', fields: {} } as RawIssue));
    await fetchIssue('A-1', 'cloud');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/rest/api/3/issue/A-1'),
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('expand=names%2CrenderedFields'),
      expect.anything(),
    );
  });

  it('calls the v2 endpoint for server', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ key: 'A-1', fields: {} } as RawIssue));
    await fetchIssue('A-1', 'server');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/rest/api/2/issue/A-1'),
      expect.anything(),
    );
  });

  it('throws with status on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(null, false, 403));
    await expect(fetchIssue('A-1', 'cloud')).rejects.toMatchObject({ status: 403 });
  });
});

describe('discoverAcFieldId', () => {
  it('finds a custom field whose label matches acceptance criteria', () => {
    const names = { customfield_10010: 'Acceptance Criteria', summary: 'Summary' };
    expect(discoverAcFieldId(names)).toBe('customfield_10010');
  });

  it('returns null when no matching label exists', () => {
    expect(discoverAcFieldId({ summary: 'Summary' })).toBeNull();
  });
});
