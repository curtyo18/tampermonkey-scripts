# GitLab Code Search+

A Tampermonkey userscript that augments GitLab's built-in code search with a filter UI, full result un-pagination, and export tools. Works on gitlab.com and any self-hosted GitLab instance.

## Features

- **Filter panel** — add extension, filename glob, and path filters via UI controls; no need to type `extension:js` by hand
- **All results at once** — fetches every page from the GitLab API in parallel and renders them in one scrollable list
- **Exact result count** — replaces GitLab's vague "1–20 of many" with a precise total
- **Export JSON / CSV** — download all results with path, filename, ref, and line number
- **Copy repos** — one-click copy of every unique repository found in the results
- **SPA-aware** — updates correctly as you navigate between searches without a full page reload

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome or Firefox.
2. Open [`gitlab-code-search.user.js`](./gitlab-code-search.user.js) in raw view — Tampermonkey will prompt to install.

Auto-updates are enabled: Tampermonkey will notify you when a new version is available.

## Usage

Navigate to any GitLab search page. The filter panel appears above the results automatically.

- **Extension** — type without a leading dot, press Enter or comma to add. Add multiple. Backspace removes the last tag.
- **Filename** — supports GitLab glob syntax (`*.test.*`, `*config*`).
- **Path** — filters by file path prefix or substring.
- **Mode** — toggles between Fuzzy (Elasticsearch) and Exact (Zoekt) search backends. The Exact mode API parameter varies between GitLab versions; test on your instance and adjust `src/main.ts` if needed.
- **Clear filters** — resets all filter controls without clearing your main search query.

## Development

```bash
npm install
npm run build      # bundles src/ → gitlab-code-search.user.js
npm run typecheck  # tsc --noEmit (no emit; esbuild handles output)
npm test           # vitest
```

Commit the built `gitlab-code-search.user.js` — it is the file Tampermonkey installs.
