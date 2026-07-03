import type { JiraFlavor, RawIssue } from './types.js';

interface ApiError extends Error {
  status?: number;
}

export async function fetchIssue(key: string, flavor: JiraFlavor): Promise<RawIssue> {
  const version = flavor === 'cloud' ? '3' : '2';
  const url = `/rest/api/${version}/issue/${encodeURIComponent(key)}?expand=${encodeURIComponent('names,renderedFields')}`;
  const resp = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    const err: ApiError = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return (await resp.json()) as RawIssue;
}

export function discoverAcFieldId(names: Record<string, string>): string | null {
  for (const [id, label] of Object.entries(names)) {
    if (/acceptance\s*criteria/i.test(label)) return id;
  }
  return null;
}
