export interface FilterState {
  extensions: string[];
  filename: string;
  path: string;
  mode: 'fuzzy' | 'exact';
}

export interface SearchResult {
  project_id: number | null;
  path: string;
  filename: string;
  ref: string;
  startline: number | null;
  data?: string;
  basename?: string;
  project_path?: string; // enriched post-fetch: "namespace/repo" from /api/v4/projects/{id}
}

export interface PageResult {
  data: SearchResult[];
  totalPages: number;
  total: number;
}

export interface FetchCallbacks {
  onBatch?: (batch: SearchResult[], loaded: number, total: number) => void;
  onError?: (err: ApiError) => void;
}

export interface ApiError extends Error {
  status?: number;
}

export interface ResultsContainer {
  el: HTMLDivElement;
  setStatus(loaded: number, total: number): void;
  appendResults(results: SearchResult[]): void;
  setError(msg: string): void;
  clear(): void;
}

export interface FilterPanel {
  panel: HTMLDivElement;
  getState(): FilterState;
}
