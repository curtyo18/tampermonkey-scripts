// ==UserScript==
// @name         BattleMetrics Wipe Stats
// @namespace    local.tampermonkey.bm-wipe-stats
// @version      2.0.0
// @description  Visualises the current and previous Rust wipe cycles on BattleMetrics server pages, anchored to the first-Thursday-of-month force wipe.
// @match        https://www.battlemetrics.com/servers/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    // ─── CONFIG ────────────────────────────────────────────────────────────
    // Rust force-wipes on the first Thursday of each month at ~7pm BST. We
    // anchor at 18:00 UTC (close to wipe time year-round) so the "post-wipe"
    // view doesn't bleed into the previous cycle's tail.
    const CONFIG = Object.freeze({
        wipeHourUtc:    18,
        // Cover current cycle plus the previous one for overlay comparison.
        // Month lengths vary; 65 days gives enough headroom.
        lookbackDays:   65,
        // BattleMetrics retains hourly history for ~30 days, so older requests
        // come back sparse/empty. Use hourly for the recent window and daily
        // for the rest — daily is plenty for the previous-cycle trend overlay.
        recentHourlyDays:     30,
        recentResolutionMins: 60,
        olderResolutionMins:  1440,
        weeksAfterWipe: 4,
        weekendDays: [
            { dow: 5, label: 'Fri' },
            { dow: 6, label: 'Sat' },
            { dow: 0, label: 'Sun' },
        ],
    });

    const DOM = Object.freeze({
        containerId: 'tm-bm-wipe-stats',
        styleId:     'tm-bm-wipe-stats-styles',
    });

    const THEME = Object.freeze({
        bg:          '#1a1d24',
        panelBg:     '#12141a',
        border:      '#2a2e38',
        borderHov:   '#3d424d',
        text:        '#e7e9ee',
        textDim:     '#9aa1ad',
        textFaint:   '#4a4f5a',
        positive:    '#3ba55d',
        negative:    '#e06c75',
        current:     '#3ba55d',
        currentFill: 'rgba(59, 165, 93, 0.22)',
        previous:    '#8b94a4',
        weekend:     'rgba(120, 170, 255, 0.10)',
        weekendEdge: 'rgba(120, 170, 255, 0.28)',
        wipeMark:    '#e6a23c',
        capacity:    '#5e6472',
        gridLine:    '#252933',
    });

    const CHART = Object.freeze({
        viewW: 880,
        viewH: 240,
        pad: { top: 14, right: 14, bottom: 24, left: 40 },
    });

    // ─── PRIMITIVES ────────────────────────────────────────────────────────
    const DAY_MS  = 86_400_000;

    const fmtIsoDate = (d) => d.toISOString().slice(0, 10);
    const fmtShortDate = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    const fmtSignedPct = (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));

    // ─── WIPE-DATE MATH ────────────────────────────────────────────────────
    function firstThursdayWipe(year, month) {
        const d = new Date(Date.UTC(year, month, 1, CONFIG.wipeHourUtc, 0, 0));
        while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1);
        return d;
    }

    function currentWipeAnchor(ref = new Date()) {
        let y = ref.getUTCFullYear(), m = ref.getUTCMonth();
        let w = firstThursdayWipe(y, m);
        if (w > ref) {
            m -= 1;
            if (m < 0) { m = 11; y -= 1; }
            w = firstThursdayWipe(y, m);
        }
        return w;
    }

    function previousWipeAnchor(wipe) {
        let y = wipe.getUTCFullYear(), m = wipe.getUTCMonth() - 1;
        if (m < 0) { m = 11; y -= 1; }
        return firstThursdayWipe(y, m);
    }

    // ─── ROUTING ───────────────────────────────────────────────────────────
    function parseServer() {
        const m = location.pathname.match(/\/servers\/([^/]+)\/(\d+)/);
        return m ? { game: m[1], id: m[2] } : null;
    }

    // ─── DATA FETCH ────────────────────────────────────────────────────────
    async function fetchHistoryRange(serverId, start, stop, resolution, signal) {
        const url = new URL(
            `https://api.battlemetrics.com/servers/${serverId}/player-count-history`
        );
        url.searchParams.set('start',      start.toISOString());
        url.searchParams.set('stop',       stop.toISOString());
        url.searchParams.set('resolution', String(resolution));

        const resp = await fetch(url, { signal });
        if (!resp.ok) throw new Error(`Player history API ${resp.status}`);
        const json = await resp.json();
        if (!Array.isArray(json?.data)) throw new Error('Unexpected history response shape');
        return json.data.map(d => ({
            date:  new Date(d.attributes.timestamp),
            value: d.attributes.value,
        }));
    }

    async function fetchPlayerHistory(serverId, signal) {
        const now         = new Date();
        const recentStart = new Date(now.getTime() - CONFIG.recentHourlyDays * DAY_MS);
        const olderStart  = new Date(now.getTime() - CONFIG.lookbackDays * DAY_MS);

        const [older, recent] = await Promise.all([
            fetchHistoryRange(serverId, olderStart,  recentStart, CONFIG.olderResolutionMins,  signal),
            fetchHistoryRange(serverId, recentStart, now,         CONFIG.recentResolutionMins, signal),
        ]);
        return [...older, ...recent].sort((a, b) => a.date - b.date);
    }

    // Best-effort: failure here is non-fatal (the chart still renders).
    async function fetchServerInfo(serverId, signal) {
        try {
            const resp = await fetch(
                `https://api.battlemetrics.com/servers/${serverId}`, { signal }
            );
            if (!resp.ok) return null;
            const a = (await resp.json())?.data?.attributes;
            return a ? { name: a.name ?? null, maxPlayers: a.maxPlayers ?? null } : null;
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            return null;
        }
    }

    // ─── ANALYSIS (pure) ───────────────────────────────────────────────────
    function slicePoints(points, start, end) {
        return points.filter(p => p.date >= start && p.date < end);
    }

    function peakOf(points) {
        let m = 0;
        for (const p of points) if (p.value > m) m = p.value;
        return m;
    }

    // Highest player count in the 24h immediately following wipe.
    function wipeWindowPeak(cyclePoints, wipe) {
        const end = wipe.getTime() + DAY_MS;
        let m = 0;
        for (const p of cyclePoints) {
            const t = p.date.getTime();
            if (t >= wipe.getTime() && t < end && p.value > m) m = p.value;
        }
        return m;
    }

    // Per-week peak across Fri/Sat/Sun, returning [{ peak, label }].
    // Week N starts on the Friday following the wipe Thursday + (N-1)*7 days.
    function weekendPeaksByWeek(cyclePoints, wipe) {
        const wipeMidnight = Date.UTC(
            wipe.getUTCFullYear(), wipe.getUTCMonth(), wipe.getUTCDate()
        );
        const out = Array.from({ length: CONFIG.weeksAfterWipe }, (_, i) => ({
            label: `W${i + 1}`,
            peak: 0,
        }));
        for (const p of cyclePoints) {
            const pd = p.date;
            if (!CONFIG.weekendDays.some(d => d.dow === pd.getUTCDay())) continue;
            const pMidnight = Date.UTC(pd.getUTCFullYear(), pd.getUTCMonth(), pd.getUTCDate());
            const daysSince = Math.floor((pMidnight - wipeMidnight) / DAY_MS);
            if (daysSince < 1) continue;
            const week = Math.floor((daysSince - 1) / 7);
            if (week >= CONFIG.weeksAfterWipe) continue;
            if (p.value > out[week].peak) out[week].peak = p.value;
        }
        return out;
    }

    // Shift previous-cycle timestamps forward so they share the current
    // cycle's "hours-since-wipe" axis when overlaid.
    function alignToCurrentWipe(points, prevWipe, curWipe) {
        const shift = curWipe.getTime() - prevWipe.getTime();
        return points.map(p => ({
            date: new Date(p.date.getTime() + shift),
            value: p.value,
        }));
    }

    function summarise(allPoints, curWipe, prevWipe) {
        const cycleEnd = new Date(curWipe.getTime() + CONFIG.weeksAfterWipe * 7 * DAY_MS);
        const curCycle = slicePoints(allPoints, curWipe, cycleEnd);
        const prevCycleRaw = slicePoints(allPoints, prevWipe, curWipe);
        const prevCycleAligned = alignToCurrentWipe(prevCycleRaw, prevWipe, curWipe);

        const wipePeakCur  = wipeWindowPeak(curCycle, curWipe);
        const wipePeakPrev = wipeWindowPeak(prevCycleRaw, prevWipe);
        const weekly       = weekendPeaksByWeek(curCycle, curWipe);
        const cyclePeakCur  = Math.max(wipePeakCur, ...weekly.map(w => w.peak));
        const cyclePeakPrev = peakOf(prevCycleRaw);

        const delta = cyclePeakPrev > 0
            ? (cyclePeakCur - cyclePeakPrev) / cyclePeakPrev
            : null;

        return {
            curCycle,
            prevCycleAligned,
            wipePeakCur,
            wipePeakPrev,
            weekly,
            cyclePeakCur,
            cyclePeakPrev,
            delta,
        };
    }

    // ─── STYLES ────────────────────────────────────────────────────────────
    const STYLES = `
#${DOM.containerId} {
    background: ${THEME.bg};
    color: ${THEME.text};
    border: 1px solid ${THEME.border};
    border-radius: 8px;
    padding: 14px 16px;
    margin: 12px auto 16px;
    max-width: 940px;
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
#${DOM.containerId} .tm-hdr {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 12px; margin-bottom: 10px;
}
#${DOM.containerId} .tm-ttl  { font-size: 14px; font-weight: 600; letter-spacing: .2px; }
#${DOM.containerId} .tm-sub  { font-size: 11px; color: ${THEME.textDim}; margin-top: 2px; }
#${DOM.containerId} .tm-sub b { color: ${THEME.text}; font-weight: 600; }
#${DOM.containerId} .tm-btn {
    background: transparent; color: ${THEME.textDim};
    border: 1px solid ${THEME.border}; border-radius: 4px;
    padding: 3px 9px; font-size: 11px; cursor: pointer;
    transition: color .1s, border-color .1s;
}
#${DOM.containerId} .tm-btn:hover:not([disabled]) { color: ${THEME.text}; border-color: ${THEME.borderHov}; }
#${DOM.containerId} .tm-btn[disabled] { opacity: .5; cursor: default; }
#${DOM.containerId} .tm-err { color: ${THEME.negative}; font-size: 12px; }
#${DOM.containerId} .tm-skeleton {
    color: ${THEME.textFaint}; font-size: 12px;
    display: flex; align-items: center; gap: 8px;
}
#${DOM.containerId} .tm-spin {
    width: 10px; height: 10px; border-radius: 50%;
    border: 2px solid ${THEME.border}; border-top-color: ${THEME.textDim};
    animation: tm-bm-spin .8s linear infinite;
}
@keyframes tm-bm-spin { to { transform: rotate(360deg); } }
#${DOM.containerId} .tm-chart-wrap {
    position: relative;
    background: ${THEME.panelBg};
    border-radius: 6px;
    padding: 6px 8px 4px;
    max-width: 880px;
    margin: 0 auto;
}
#${DOM.containerId} .tm-chart {
    width: 100%; height: auto; display: block;
    overflow: visible;
}
#${DOM.containerId} .tm-cursor {
    stroke: ${THEME.textDim}; stroke-width: 1; stroke-dasharray: 2 3;
    opacity: 0; pointer-events: none;
}
#${DOM.containerId} .tm-chart-wrap:hover .tm-cursor { opacity: .8; }
#${DOM.containerId} .tm-tip {
    position: absolute; pointer-events: none; opacity: 0;
    background: #0f1116; border: 1px solid ${THEME.border}; border-radius: 4px;
    padding: 5px 8px; font-size: 11px; color: ${THEME.text};
    transform: translate(-50%, 0); white-space: nowrap;
    transition: opacity .08s; z-index: 2;
    top: 6px;
}
#${DOM.containerId} .tm-tip .ts { color: ${THEME.textDim}; margin-bottom: 2px; }
#${DOM.containerId} .tm-tip .row { display: flex; gap: 8px; align-items: baseline; }
#${DOM.containerId} .tm-tip .row .lbl { color: ${THEME.textDim}; }
#${DOM.containerId} .tm-tip .row.cur  .v { color: ${THEME.current};  font-weight: 600; }
#${DOM.containerId} .tm-tip .row.prev .v { color: ${THEME.previous}; font-weight: 600; }
#${DOM.containerId} .tm-legend {
    display: flex; gap: 14px; font-size: 11px; color: ${THEME.textDim};
    margin: 6px 2px 0; align-items: center; flex-wrap: wrap;
}
#${DOM.containerId} .tm-legend .sw {
    display: inline-block; width: 12px; height: 2px; margin-right: 6px;
    vertical-align: middle;
}
#${DOM.containerId} .tm-strip {
    display: flex; gap: 18px; flex-wrap: wrap;
    margin-top: 12px; font-size: 12px; align-items: baseline;
}
#${DOM.containerId} .tm-strip .item { display: flex; gap: 5px; align-items: baseline; }
#${DOM.containerId} .tm-strip .k { color: ${THEME.textDim}; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
#${DOM.containerId} .tm-strip .v { color: ${THEME.text}; font-weight: 600; font-variant-numeric: tabular-nums; }
#${DOM.containerId} .tm-strip .v.zero { color: ${THEME.textFaint}; font-weight: 400; }
#${DOM.containerId} .tm-delta.pos { color: ${THEME.positive}; }
#${DOM.containerId} .tm-delta.neg { color: ${THEME.negative}; }
`.trim();

    // ─── DOM SHELL ─────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById(DOM.styleId)) return;
        const s = document.createElement('style');
        s.id = DOM.styleId;
        s.textContent = STYLES;
        document.head.appendChild(s);
    }

    function removeExisting() {
        document.getElementById(DOM.containerId)?.remove();
    }

    function mountShell() {
        removeExisting();
        const el = document.createElement('div');
        el.id = DOM.containerId;
        const target = document.querySelector('main') || document.body;
        target.prepend(el);
        return el;
    }

    function headerHtml(subHtml, rightHtml = '') {
        return `
            <div class="tm-hdr">
                <div>
                    <div class="tm-ttl">Wipe Stats</div>
                    ${subHtml ? `<div class="tm-sub">${subHtml}</div>` : ''}
                </div>
                ${rightHtml}
            </div>
        `;
    }

    // ─── CHART RENDERER ────────────────────────────────────────────────────
    // series: [{ key, points, stroke, fill?, opacity?, strokeWidth? }]
    function buildChart({ series, wipe, weeks, maxPlayers }) {
        const { viewW: W, viewH: H, pad: P } = CHART;
        const domainStart = wipe.getTime();
        const domainEnd   = wipe.getTime() + weeks * 7 * DAY_MS;

        const allValues = series.flatMap(s => s.points.map(p => p.value));
        if (maxPlayers) allValues.push(maxPlayers);
        const yMax = Math.max(10, ...allValues, 1);

        const innerW = W - P.left - P.right;
        const innerH = H - P.top - P.bottom;
        const x = (t) => P.left + innerW * (t - domainStart) / (domainEnd - domainStart);
        const y = (v) => P.top  + innerH * (1 - v / yMax);

        // Weekend bands: Fri 00:00 UTC → Mon 00:00 UTC of each post-wipe week.
        // Bright-ish blue tint with thin edge lines so the bands read as
        // "Friday/Saturday/Sunday — the days that matter for Rust retention".
        const wipeMid = Date.UTC(wipe.getUTCFullYear(), wipe.getUTCMonth(), wipe.getUTCDate());
        const bands = [];
        for (let w = 0; w < weeks; w++) {
            const fri = wipeMid + (1 + w * 7) * DAY_MS;
            const mon = fri + 3 * DAY_MS;
            const x1 = Math.max(x(Math.max(fri, domainStart)), P.left);
            const x2 = Math.min(x(Math.min(mon, domainEnd)), W - P.right);
            if (x2 <= x1) continue;
            bands.push(`<rect x="${x1.toFixed(2)}" y="${P.top}" width="${(x2 - x1).toFixed(2)}" height="${innerH}" fill="${THEME.weekend}"/>`);
            bands.push(`<line x1="${x1.toFixed(2)}" x2="${x1.toFixed(2)}" y1="${P.top}" y2="${(H - P.bottom).toFixed(2)}" stroke="${THEME.weekendEdge}" stroke-width="0.5"/>`);
            bands.push(`<line x1="${x2.toFixed(2)}" x2="${x2.toFixed(2)}" y1="${P.top}" y2="${(H - P.bottom).toFixed(2)}" stroke="${THEME.weekendEdge}" stroke-width="0.5"/>`);
        }

        // Y grid + labels.
        const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(yMax * f));
        const yAxis = yTicks.map(v => {
            const yy = y(v).toFixed(2);
            return `<line x1="${P.left}" x2="${W - P.right}" y1="${yy}" y2="${yy}" stroke="${THEME.gridLine}" stroke-width="1"/>
                    <text x="${P.left - 6}" y="${yy}" fill="${THEME.textDim}" font-size="10" text-anchor="end" dominant-baseline="middle">${v}</text>`;
        }).join('');

        // X labels: each week boundary as a date.
        const xLabels = [];
        for (let w = 0; w <= weeks; w++) {
            const t = wipe.getTime() + w * 7 * DAY_MS;
            if (t > domainEnd + DAY_MS) continue;
            const xx = x(t).toFixed(2);
            const label = w === 0 ? `${fmtShortDate(wipe)} wipe` : fmtShortDate(new Date(t));
            xLabels.push(`<line x1="${xx}" x2="${xx}" y1="${H - P.bottom}" y2="${H - P.bottom + 3}" stroke="${THEME.textDim}" stroke-width="1"/>
                          <text x="${xx}" y="${H - 8}" fill="${THEME.textDim}" font-size="10" text-anchor="middle">${label}</text>`);
        }

        const wipeX = x(wipe.getTime()).toFixed(2);
        const wipeMark = `<line x1="${wipeX}" x2="${wipeX}" y1="${P.top}" y2="${H - P.bottom}" stroke="${THEME.wipeMark}" stroke-width="1" stroke-dasharray="3 3" opacity=".65"/>`;

        let capLine = '';
        if (maxPlayers && maxPlayers <= yMax * 1.02) {
            const cy = y(maxPlayers).toFixed(2);
            capLine = `<line x1="${P.left}" x2="${W - P.right}" y1="${cy}" y2="${cy}" stroke="${THEME.capacity}" stroke-width="1" stroke-dasharray="4 4" opacity=".55"/>
                       <text x="${W - P.right - 4}" y="${(Math.max(+cy - 3, P.top + 10)).toFixed(2)}" fill="${THEME.capacity}" font-size="10" text-anchor="end">cap ${maxPlayers}</text>`;
        }

        const pathFor = (pts, close) => {
            const inD = pts.filter(p => {
                const t = p.date.getTime();
                return t >= domainStart && t <= domainEnd;
            });
            if (!inD.length) return '';
            const d = inD.map((p, i) =>
                `${i === 0 ? 'M' : 'L'}${x(p.date.getTime()).toFixed(2)},${y(p.value).toFixed(2)}`
            ).join(' ');
            if (!close) return d;
            const last = inD[inD.length - 1], first = inD[0];
            return d
                + ` L${x(last.date.getTime()).toFixed(2)},${y(0).toFixed(2)}`
                + ` L${x(first.date.getTime()).toFixed(2)},${y(0).toFixed(2)} Z`;
        };

        const seriesSvg = series.map(s => {
            const opac = s.opacity ?? 1;
            const parts = [];
            if (s.fill) {
                parts.push(`<path d="${pathFor(s.points, true)}" fill="${s.fill}" stroke="none" opacity="${opac}"/>`);
            }
            parts.push(`<path d="${pathFor(s.points, false)}" fill="none" stroke="${s.stroke}" stroke-width="${s.strokeWidth ?? 1.5}" opacity="${opac}" stroke-linejoin="round" stroke-linecap="round"/>`);
            return parts.join('');
        }).join('');

        const cursor = `<line class="tm-cursor" x1="-10" x2="-10" y1="${P.top}" y2="${H - P.bottom}"/>`;

        const svg = `
<svg class="tm-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Wipe cycle player count chart">
  ${bands.join('')}
  ${yAxis}
  ${wipeMark}
  ${capLine}
  ${seriesSvg}
  ${xLabels.join('')}
  ${cursor}
</svg>`.trim();

        return {
            svg,
            meta: { viewW: W, viewH: H, pad: P, domainStart, domainEnd, yMax },
        };
    }

    // ─── TOOLTIP ───────────────────────────────────────────────────────────
    function wireTooltip(rootEl, meta, series) {
        const wrap = rootEl.querySelector('.tm-chart-wrap');
        const svg  = rootEl.querySelector('.tm-chart');
        const tip  = rootEl.querySelector('.tm-tip');
        const cursor = rootEl.querySelector('.tm-cursor');
        if (!wrap || !svg || !tip || !cursor) return;

        const { viewW, pad, domainStart, domainEnd } = meta;

        const nearest = (pts, t) => {
            if (!pts.length) return null;
            let lo = 0, hi = pts.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (pts[mid].date.getTime() < t) lo = mid + 1; else hi = mid;
            }
            const a = pts[lo], b = pts[Math.max(0, lo - 1)];
            return Math.abs(a.date.getTime() - t) < Math.abs(b.date.getTime() - t) ? a : b;
        };

        const hide = () => {
            tip.style.opacity = '0';
            cursor.setAttribute('x1', '-10');
            cursor.setAttribute('x2', '-10');
        };

        wrap.addEventListener('mousemove', (ev) => {
            const rect = svg.getBoundingClientRect();
            const xPx  = ev.clientX - rect.left;
            const innerLeft  = rect.width *  pad.left          / viewW;
            const innerRight = rect.width * (viewW - pad.right) / viewW;
            if (xPx < innerLeft || xPx > innerRight) { hide(); return; }

            const t = domainStart + (xPx - innerLeft) / (innerRight - innerLeft) * (domainEnd - domainStart);
            const cursorVbX = pad.left + (viewW - pad.right - pad.left) * (t - domainStart) / (domainEnd - domainStart);
            cursor.setAttribute('x1', cursorVbX.toFixed(2));
            cursor.setAttribute('x2', cursorVbX.toFixed(2));

            const when = new Date(t);
            const rows = [`<div class="ts">${fmtIsoDate(when)} ${String(when.getUTCHours()).padStart(2, '0')}:00 UTC</div>`];
            for (const s of series) {
                const p = nearest(s.points, t);
                if (!p) continue;
                rows.push(`<div class="row ${s.key}"><span class="lbl">${escapeHtml(s.label)}</span><span class="v">${p.value}</span></div>`);
            }
            tip.innerHTML = rows.join('');

            const wrapRect = wrap.getBoundingClientRect();
            const tipX = ev.clientX - wrapRect.left;
            tip.style.left = `${tipX}px`;
            tip.style.opacity = '1';
        });

        wrap.addEventListener('mouseleave', hide);
    }

    // ─── VIEW ──────────────────────────────────────────────────────────────
    function renderLoading(el) {
        el.innerHTML = headerHtml('') + `
            <div class="tm-skeleton"><span class="tm-spin"></span>Fetching player history…</div>
        `;
    }

    function renderError(el, msg, onRetry) {
        el.innerHTML = headerHtml(
            '',
            `<button class="tm-btn" type="button" data-action="retry">Retry</button>`
        ) + `<div class="tm-err">${escapeHtml(msg)}</div>`;
        el.querySelector('[data-action="retry"]').addEventListener('click', onRetry);
    }

    function stripItemHtml(label, value) {
        const v = value > 0
            ? `<span class="v">${value}</span>`
            : `<span class="v zero">—</span>`;
        return `<div class="item"><span class="k">${label}</span>${v}</div>`;
    }

    function renderStats(el, data, ctx, onRefresh) {
        const { curWipe, serverInfo } = ctx;
        const maxPlayers = serverInfo?.maxPlayers ?? null;

        const series = [
            data.prevCycleAligned.length ? {
                key: 'prev',
                label: 'previous',
                points: data.prevCycleAligned,
                stroke: THEME.previous,
                strokeWidth: 1,
                opacity: 0.85,
            } : null,
            {
                key: 'cur',
                label: 'current',
                points: data.curCycle,
                stroke: THEME.current,
                fill: THEME.currentFill,
                strokeWidth: 1.75,
            },
        ].filter(Boolean);

        const chart = buildChart({
            series,
            wipe: curWipe,
            weeks: CONFIG.weeksAfterWipe,
            maxPlayers,
        });

        const stripParts = [
            stripItemHtml('Wipe', data.wipePeakCur),
            ...data.weekly.map(w => stripItemHtml(w.label, w.peak)),
        ];
        if (data.delta !== null) {
            const cls = data.delta >= 0 ? 'pos' : 'neg';
            stripParts.push(`<div class="item"><span class="k">vs prev</span><span class="v tm-delta ${cls}">${fmtSignedPct(data.delta)}</span></div>`);
        }

        const subBits = [
            `wipe <b>${fmtIsoDate(curWipe)}</b>`,
            `peak <b>${data.cyclePeakCur || '—'}</b>`,
        ];
        if (serverInfo?.maxPlayers) subBits.push(`cap <b>${serverInfo.maxPlayers}</b>`);
        if (data.cyclePeakPrev) subBits.push(`prev cycle <b>${data.cyclePeakPrev}</b>`);

        el.innerHTML = `
            ${headerHtml(
                subBits.join(' · '),
                `<button class="tm-btn" type="button" data-action="refresh">Refresh</button>`
            )}
            <div class="tm-chart-wrap">
                ${chart.svg}
                <div class="tm-tip"></div>
            </div>
            <div class="tm-legend">
                <span><span class="sw" style="background:${THEME.current}"></span>Current cycle</span>
                ${data.prevCycleAligned.length ? `<span><span class="sw" style="background:${THEME.previous}"></span>Previous cycle</span>` : ''}
                <span><span class="sw" style="background:${THEME.wipeMark}"></span>Wipe</span>
                <span><span class="sw" style="background:${THEME.weekend}"></span>Weekend</span>
                ${maxPlayers ? `<span><span class="sw" style="background:${THEME.capacity}"></span>Capacity</span>` : ''}
            </div>
            <div class="tm-strip">${stripParts.join('')}</div>
        `;

        el.querySelector('[data-action="refresh"]').addEventListener('click', onRefresh);
        wireTooltip(el, chart.meta, series);
    }

    // ─── ORCHESTRATION ─────────────────────────────────────────────────────
    let currentRun = 0;
    let currentController = null;

    async function run() {
        const runId = ++currentRun;
        currentController?.abort();

        const server = parseServer();
        if (!server) { removeExisting(); return; }

        injectStyles();
        const el = mountShell();
        renderLoading(el);

        const controller = new AbortController();
        currentController = controller;

        try {
            const [points, serverInfo] = await Promise.all([
                fetchPlayerHistory(server.id, controller.signal),
                fetchServerInfo(server.id, controller.signal),
            ]);
            if (runId !== currentRun) return;

            const curWipe  = currentWipeAnchor();
            const prevWipe = previousWipeAnchor(curWipe);
            const data     = summarise(points, curWipe, prevWipe);

            renderStats(el, data, { curWipe, prevWipe, serverInfo }, run);
        } catch (err) {
            if (runId !== currentRun || err.name === 'AbortError') return;
            renderError(el, err.message || 'Failed to load stats', run);
        }
    }

    // ─── SPA NAVIGATION ────────────────────────────────────────────────────
    (function patchHistory(h) {
        const fire = () => window.dispatchEvent(new Event('tm-locationchange'));
        const ps = h.pushState, rs = h.replaceState;
        h.pushState    = function () { const r = ps.apply(this, arguments); fire(); return r; };
        h.replaceState = function () { const r = rs.apply(this, arguments); fire(); return r; };
        window.addEventListener('popstate', fire);
    })(window.history);

    let debounce;
    window.addEventListener('tm-locationchange', () => {
        clearTimeout(debounce);
        debounce = setTimeout(run, 250);
    });

    run();
})();
