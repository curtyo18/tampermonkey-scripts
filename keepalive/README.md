# Keepalive

A Tampermonkey userscript that keeps any website's session alive using three independent techniques:

1. **Event dispatch** — fires synthetic DOM events (mousemove, keydown, etc.) to reset client-side inactivity timers.
2. **Fetch ping** — periodically fetches a URL to keep the server-side session alive.
3. **Element click** — periodically clicks a CSS-selected element.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open `keepalive.user.js` in your browser (or paste its contents into a new Tampermonkey script).
3. Edit the `@match` line at the top to target your site (e.g. `// @match https://yoursite.com/*`).
4. Edit the `CONFIG` block to enable/disable techniques and set intervals/selectors.

## Configuration

All configuration is in the `CONFIG` block near the top of the script — it's the only part you need to touch.

| Option | Default | Description |
|--------|---------|-------------|
| `eventDispatch.enabled` | `true` | Fire synthetic DOM events on an interval |
| `eventDispatch.intervalMs` | `30000` | How often to fire events (ms) |
| `eventDispatch.iframeId` | `null` | Also dispatch into this iframe (by `id` attribute). `null` = top window only |
| `fetchPing.enabled` | `true` | Fetch a URL on an interval |
| `fetchPing.intervalMs` | `300000` | How often to ping (ms). Set to ≤50% of your server's session TTL |
| `fetchPing.url` | `null` | URL to fetch. `null` = current page URL |
| `elementClick.enabled` | `true` | Click an element on an interval |
| `elementClick.intervalMs` | `30000` | How often to click (ms) |
| `elementClick.selector` | `null` | CSS selector for the element to click. `null` = disabled |

## Status badge

A small badge in the top-right corner shows which technique last fired and at what time:

```
[Keepalive v1.x.x] fetch ping @ 14:32:07
```

## Versioning

Versions are bumped automatically by a pre-commit git hook (`.githooks/pre-commit`).

If you've just cloned this repo, run once:

```bash
git config core.hooksPath .githooks
```
