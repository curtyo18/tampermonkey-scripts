import type { FilterState, SearchResult, ResultsContainer, FilterPanel } from './types.js';

export function createFilterPanel(onChange: (state: FilterState) => void): FilterPanel {
  return { panel: document.createElement('div'), getState: () => ({ extensions: [], filename: '', path: '', mode: 'fuzzy' }) };
}
export function createResultsContainer(): ResultsContainer {
  return { el: document.createElement('div'), setStatus: () => {}, appendResults: () => {}, setError: () => {}, clear: () => {} };
}
export function createExportToolbar(getAllResults: () => SearchResult[]): HTMLDivElement {
  return document.createElement('div');
}
