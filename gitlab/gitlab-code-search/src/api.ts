import type { PageResult, FetchCallbacks, SearchResult } from './types.js';

export async function fetchPage(endpoint: string, query: string, page: number): Promise<PageResult> {
  throw new Error('not implemented');
}
export async function fetchAllPages(endpoint: string, query: string, callbacks?: FetchCallbacks): Promise<SearchResult[]> {
  return [];
}
