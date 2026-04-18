# BattleMetrics Wipe Stats

A Tampermonkey userscript that adds a panel to
[BattleMetrics](https://www.battlemetrics.com) server pages with a chart
of player counts across the current Rust wipe cycle, overlaid against
the previous cycle for direct comparison.

Built around Rust's force-wipe cadence (first Thursday of every month at
~7pm BST). The intent is fast server selection: at a glance, see how
many players a server pulled at wipe, how the weekends held up across
the month, and whether this cycle is trending up or down vs. last.

## What it shows

- **Chart** — concurrent player count over the 4-week cycle, hourly
  resolution.
  - Solid green line + fill: the **current cycle**, from this month's
    wipe to now.
  - Faint grey line: the **previous cycle**, time-shifted so that wipe
    Thursday lines up — so you read trend by comparing the two curves
    at the same "days since wipe" position.
  - Orange dashed line: the **wipe moment**.
  - Subtle bands: **weekends** (Fri–Sun), the days that matter most for
    Rust retention.
  - Faded dashed line + label: server **capacity** (max players), if
    the server-info endpoint returns it.
  - Hover anywhere on the chart for an exact-hour tooltip showing both
    cycles.
- **Summary strip** — wipe-day peak, peak per weekend (W1–W4), and a
  signed % delta vs. the previous cycle's peak.
- **Header** — wipe date, this cycle's peak, server capacity (if known),
  and previous cycle's peak.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your
   browser.
2. Open [`wipe-stats.user.js`](./wipe-stats.user.js) in raw view —
   Tampermonkey will prompt to install. Alternatively, copy the file
   contents into a new userscript.
3. Visit any BattleMetrics server page, e.g.
   `https://www.battlemetrics.com/servers/rust/30171681`.

## How it works

1. Parses the server ID out of the URL (`/servers/{game}/{id}`).
2. In parallel:
   - Fetches the last 65 days of `player-count-history` at hourly
     resolution (enough to cover the current cycle plus the previous
     one for overlay).
   - Fetches `/servers/{id}` for the server's `maxPlayers` (best
     effort; chart still renders if this fails).
3. Computes the most recent **first Thursday of a month at 18:00 UTC**
   and treats that as the current wipe anchor. Subtracts one calendar
   month for the previous wipe anchor.
4. Slices points into current cycle (`[curWipe, curWipe + 28d]`) and
   previous cycle (`[prevWipe, curWipe]`), then time-shifts the
   previous cycle forward by `(curWipe − prevWipe)` so it shares the
   current cycle's hours-since-wipe x-axis.
5. Computes the wipe-window peak (max in the 24h after wipe) and per-
   week weekend peaks (max across Fri/Sat/Sun in each of the four
   weeks following wipe).
6. Renders an SVG chart plus the summary strip.

All time math is UTC.

## Configuration

Constants at the top of the script:

```js
const CONFIG = Object.freeze({
    wipeHourUtc:    18,   // ~7pm BST
    lookbackDays:   65,   // current + previous cycle
    resolutionMins: 60,   // 'raw', 30, 60, or 1440
    weeksAfterWipe: 4,
    weekendDays: [
        { dow: 5, label: 'Fri' },
        { dow: 6, label: 'Sat' },
        { dow: 0, label: 'Sun' },
    ],
});
```

`THEME` and `CHART` blocks below `CONFIG` control colours and chart
dimensions.

To repurpose for a non-Rust schedule, replace `firstThursdayWipe()` and
`previousWipeAnchor()` with functions that return the appropriate
anchors for your wipe cadence.

## Caveats

- The wipe time anchor (18:00 UTC) is approximate. Actual force-wipe is
  ~19:00 BST which floats between 18:00 UTC (BST/summer) and 19:00 UTC
  (GMT/winter). Display alignment is unaffected at chart resolution.
- Custom server wipes (set by individual server owners independently of
  the monthly force wipe) are **not** detected. Buckets are anchored
  only to the force-wipe Thursday.
- Hourly resolution misses sub-hour peaks. Bump `resolutionMins` to
  `30` or `'raw'` for finer granularity at the cost of response size.
- The `@match` rule fires on every BattleMetrics server page; the wipe
  cadence assumed by the bucketing only really fits Rust servers.

## Permissions

`@grant none`. Two `fetch` calls to `api.battlemetrics.com` (the same
public API the site uses) — no cross-origin credential access, no
storage, no external hosts.
