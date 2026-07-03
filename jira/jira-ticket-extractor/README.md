# Jira Ticket Extractor

A Tampermonkey userscript that extracts a Jira issue — key, summary, description,
acceptance criteria, type/status/priority, labels, components, links, attachments —
as LLM-ready Markdown, copied with one click. Reads the Jira REST API using your
existing browser session (no tokens), with a DOM-scrape fallback.

## Features

- **One-click extract** — floating button on any Jira issue page.
- **API-first** — REST v3 (Cloud) / v2 (Server/DC) via session cookies; falls back
  to DOM scraping if the API is blocked.
- **Acceptance Criteria detection** — dedicated custom field, else an
  "Acceptance Criteria" heading sliced out of the description.
- **LLM-ready Markdown** — deterministic layout; empty sections omitted.
- **Review panel** — see exactly what gets copied, with a source badge (api/dom).
- **SPA-aware** — follows issue changes on boards/backlogs without a reload.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open [`jira-ticket-extractor.user.js`](./jira-ticket-extractor.user.js) raw —
   Tampermonkey prompts to install. Auto-updates are enabled.

## Development

```bash
npm install
npm run build      # bundles src/ -> jira-ticket-extractor.user.js
npm run typecheck
npm test
```

Commit the built `jira-ticket-extractor.user.js` — it's what Tampermonkey installs.
