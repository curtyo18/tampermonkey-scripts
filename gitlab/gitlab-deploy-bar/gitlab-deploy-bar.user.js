// ==UserScript==
// @name         GitLabDeployBar
// @namespace    local.tampermonkey.gitlab-deploy-bar
// @version      1.13
// @description  Show the latest successful deploy job per environment at the top of GitLab project pages
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ─── GITLAB DETECTION ──────────────────────────────────────────────────
    // The `application-name` meta tag is gone on rebranded/self-hosted
    // instances, so rely on structural signals baked into GitLab's Rails
    // rendering: every page carries `body[data-page="<controller>:<action>"]`
    // and a `/-/manifest.json` link in the head (the `/-/` prefix is a
    // GitLab-internal route).
    function isGitLab() {
        return !!(
            document.body?.dataset?.page ||
            document.querySelector('link[href$="/-/manifest.json"]')
        );
    }
    if (!isGitLab()) return;

    // ─── CONFIG ────────────────────────────────────────────────────────────
    // Edit to match your own CI job names. The `jobName` values must match
    // exactly — the script queries GitLab for the latest SUCCESS job with
    // each name.
    const ENVS = [
        { jobName: 'deploy-dev',     label: 'DEV',     color: '#3b82f6' },
        { jobName: 'deploy-staging', label: 'STAGING', color: '#f59e0b' },
        { jobName: 'deploy-prod',    label: 'PROD',    color: '#ef4444' },
    ];

    const CONTAINER_ID     = 'tm-latest-deploys';
    const WAIT_TIMEOUT_MS  = 2000;
    const FETCH_TIMEOUT_MS = 10_000;
    const CACHE_TTL_MS     = 2 * 60 * 1000;

    const JOB_QUERY = `
        query getLatestSuccessJob(
            $fullPath: ID!,
            $name: String!,
            $statuses: [CiJobStatus!]
        ) {
            project(fullPath: $fullPath) {
                id
                jobs(first: 1, statuses: $statuses, name: $name, kind: BUILD) {
                    nodes {
                        id
                        name
                        webPath
                        refName
                        finishedAt
                        pipeline { user { name username webPath } }
                    }
                }
            }
        }
    `;

    // Top-level path segments that are never projects.
    const RESERVED_TOP_SEGMENTS = new Set([
        '-', 'admin', 'api', 'assets', 'dashboard', 'explore', 'groups',
        'help', 'profile', 'projects', 'public', 's', 'search', 'snippets',
        'uploads', 'users',
    ]);

    // DOM signals that GitLab renders on any project-scoped page.
    const PROJECT_INDICATORS = [
        'body[data-project-id]',
        '[data-project-full-path]',
        '.project-code-holder',
        '.js-project-path',
    ];

    // ─── STATE ─────────────────────────────────────────────────────────────
    const cache = new Map();            // projectPath -> { at, data }
    const inFlightFetches = new Set();  // AbortControllers for active requests
    let currentRun = 0;                 // monotonic; bumps invalidate stale work
    let warnedGraphqlError = false;

    // ─── DETECTION ─────────────────────────────────────────────────────────
    function getProjectPath() {
        const path = location.pathname.replace(/^\/+|\/+$/g, '');
        if (!path) return null;

        // GitLab splits project routes on `/-/`, e.g. `group/proj/-/pipelines`.
        const projectPart = path.split('/-/')[0];
        const segments = projectPart.split('/').filter(Boolean);

        if (segments.length < 2) return null;
        if (RESERVED_TOP_SEGMENTS.has(segments[0])) return null;

        return segments.join('/');
    }

    // `body[data-page]` is a Rails-rendered marker that Turbo updates on
    // SPA nav. Returns true/false when the marker is present, null when
    // it's not (e.g. very early load) — callers should fall back to
    // DOM-wait in the null case.
    function looksLikeProjectPage() {
        const page = document.body?.dataset?.page;
        if (!page) return null;
        return page.startsWith('projects:');
    }

    // ─── DOM HELPERS ───────────────────────────────────────────────────────
    function matchesAny(selectors) {
        return selectors.some(sel => document.querySelector(sel));
    }

    function waitForAny(selectors, runId, timeout = WAIT_TIMEOUT_MS) {
        return new Promise(resolve => {
            if (matchesAny(selectors)) return resolve(true);

            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                obs.disconnect();
                clearTimeout(timer);
                clearInterval(cancelPoll);
                resolve(value);
            };

            const obs = new MutationObserver(() => {
                if (matchesAny(selectors)) finish(true);
            });
            obs.observe(document.body, { childList: true, subtree: true });

            const timer = setTimeout(() => finish(false), timeout);
            const cancelPoll = setInterval(() => {
                if (runId !== currentRun) finish(false);
            }, 100);
        });
    }

    // ─── FETCH HELPERS ─────────────────────────────────────────────────────
    function csrfToken() {
        return document.querySelector('meta[name="csrf-token"]')?.content;
    }

    function parseGid(gid) {
        return gid?.match(/\d+$/)?.[0] ?? null;
    }

    // Tracks the controller in `inFlightFetches` so the nav handler can
    // abort every outstanding request at once. Callers handle AbortError
    // via their existing try/catch → return null paths.
    async function fetchWithTimeout(url, init = {}) {
        const controller = new AbortController();
        inFlightFetches.add(controller);
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            return await fetch(url, { ...init, signal: controller.signal });
        } finally {
            clearTimeout(timer);
            inFlightFetches.delete(controller);
        }
    }

    function abortInFlight() {
        for (const c of inFlightFetches) c.abort();
        inFlightFetches.clear();
    }

    // ─── API ───────────────────────────────────────────────────────────────
    // REST exposes the user who pressed play on the manual deploy, while
    // GraphQL's `pipeline.user` is the pipeline creator — a service
    // account for bot-triggered pipelines. Prefer REST when available.
    async function fetchJobUser(projectPath, jobId) {
        const encoded = encodeURIComponent(projectPath);
        try {
            const resp = await fetchWithTimeout(
                `/api/v4/projects/${encoded}/jobs/${jobId}`,
                { credentials: 'same-origin', headers: { Accept: 'application/json' } },
            );
            if (!resp.ok) return null;
            const job = await resp.json();
            const u = job?.user;
            if (!u) return null;
            return { name: u.name, username: u.username, webPath: u.web_url };
        } catch {
            return null;
        }
    }

    // MR-pipeline jobs return `refName` as `refs/merge-requests/<iid>/head`
    // (or `/merge` for merged-result pipelines). That literal ref is useless
    // in the bar — look the MR up to display the source branch instead.
    const MR_REF_RE = /^refs\/merge-requests\/(\d+)\/(?:head|merge)$/;
    async function fetchMergeRequestForRef(projectPath, refName) {
        const match = refName?.match(MR_REF_RE);
        if (!match) return null;
        const iid = match[1];
        const encoded = encodeURIComponent(projectPath);
        try {
            const resp = await fetchWithTimeout(
                `/api/v4/projects/${encoded}/merge_requests/${iid}`,
                { credentials: 'same-origin', headers: { Accept: 'application/json' } },
            );
            if (!resp.ok) return null;
            const mr = await resp.json();
            return {
                iid:          mr.iid,
                sourceBranch: mr.source_branch,
                title:        mr.title,
                webUrl:       mr.web_url,
            };
        } catch {
            return null;
        }
    }

    async function fetchLatestForEnv(projectPath, jobName) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
        const token = csrfToken();
        if (token) headers['X-CSRF-Token'] = token;

        let node = null;
        try {
            const resp = await fetchWithTimeout('/api/graphql', {
                method: 'POST',
                credentials: 'same-origin',
                headers,
                body: JSON.stringify({
                    operationName: 'getLatestSuccessJob',
                    query: JOB_QUERY,
                    variables: { fullPath: projectPath, name: jobName, statuses: ['SUCCESS'] },
                }),
            });
            if (!resp.ok) return { jobName, job: null };
            const json = await resp.json();
            if (Array.isArray(json?.errors) && json.errors.length > 0 && !warnedGraphqlError) {
                warnedGraphqlError = true;
                console.warn('[gitlab-deploy-bar] GraphQL errors:', json.errors);
            }
            node = json?.data?.project?.jobs?.nodes?.[0] ?? null;
        } catch {
            return { jobName, job: null };
        }

        if (!node) return { jobName, job: null };

        const jobId = parseGid(node.id);
        const [user, mr] = await Promise.all([
            jobId ? fetchJobUser(projectPath, jobId) : Promise.resolve(null),
            fetchMergeRequestForRef(projectPath, node.refName),
        ]);

        return {
            jobName,
            job: {
                id: jobId ?? '?',
                name: node.name,
                webUrl: node.webPath ? new URL(node.webPath, location.origin).href : null,
                ref: node.refName,
                mr,
                finishedAt: node.finishedAt,
                user: user || node.pipeline?.user || null,
            },
        };
    }

    async function fetchLatestDeploys(projectPath, runId) {
        const cached = cache.get(projectPath);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
            return cached.data;
        }

        const results = await Promise.all(
            ENVS.map(env => fetchLatestForEnv(projectPath, env.jobName))
        );
        if (runId !== currentRun) return null;

        const deploys = {};
        for (const { jobName, job } of results) {
            if (job) deploys[jobName] = job;
        }

        const data = Object.keys(deploys).length > 0
            ? { ok: true, deploys }
            : { ok: false };

        cache.set(projectPath, { at: Date.now(), data });
        return data;
    }

    // ─── FORMATTING ────────────────────────────────────────────────────────
    // Compact format ("2m ago") is intentional for bar density;
    // `Intl.RelativeTimeFormat` produces "2 minutes ago" which doesn't fit.
    function relTime(iso) {
        if (!iso) return '';
        const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 60)        return `${s}s ago`;
        if (s < 3600)      return `${Math.floor(s/60)}m ago`;
        if (s < 86400)     return `${Math.floor(s/3600)}h ago`;
        if (s < 86400*30)  return `${Math.floor(s/86400)}d ago`;
        return `${Math.floor(s/86400/30)}mo ago`;
    }

    // ─── RENDER ────────────────────────────────────────────────────────────
    function barShell(text) {
        const bar = document.createElement('div');
        bar.id = CONTAINER_ID;
        bar.style.cssText = `
            display:flex;gap:10px;padding:6px 14px;
            background:#1f2937;color:#9ca3af;
            font:500 12px/1.4 system-ui,-apple-system,sans-serif;
            border-bottom:1px solid #374151;
            align-items:center;flex-wrap:wrap;`;
        if (text) bar.textContent = text;
        return bar;
    }

    function buildBar(deploys) {
        const bar = barShell();
        bar.style.color = '#f3f4f6';

        const title = document.createElement('span');
        title.textContent = 'Latest deploys:';
        title.style.cssText = 'opacity:.75;font-weight:600;';
        bar.appendChild(title);

        for (const env of ENVS) {
            const job = deploys[env.jobName];
            const card = document.createElement('div');
            card.style.cssText = `
                display:flex;align-items:center;gap:6px;
                padding:3px 8px;background:#111827;
                border-radius:4px;border-left:3px solid ${env.color};`;

            const tag = document.createElement('strong');
            tag.textContent = env.label;
            tag.style.cssText = `color:${env.color};letter-spacing:.5px;`;
            card.appendChild(tag);

            if (job) {
                const who = document.createElement('span');
                who.textContent = job.user?.name || job.user?.username || '?';
                card.appendChild(who);

                const when = document.createElement('span');
                when.textContent = relTime(job.finishedAt);
                when.title = job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '';
                when.style.cssText = 'opacity:.6;';
                card.appendChild(when);

                const label = job.mr?.sourceBranch
                    || job.ref
                    || `#${job.id}`;
                const titleBits = [];
                if (job.mr) titleBits.push(`MR !${job.mr.iid}${job.mr.title ? ` — ${job.mr.title}` : ''}`);
                if (job.ref) titleBits.push(`ref ${job.ref}`);
                titleBits.push(`job #${job.id}`);

                let ref;
                if (job.webUrl) {
                    ref = document.createElement('a');
                    ref.href = job.webUrl;
                    ref.style.cssText = 'color:#60a5fa;text-decoration:none;';
                } else {
                    ref = document.createElement('span');
                    ref.style.cssText = 'color:#60a5fa;';
                }
                ref.textContent = label;
                ref.title = titleBits.join(' · ');
                card.appendChild(ref);
            } else {
                const none = document.createElement('span');
                none.textContent = '—';
                none.style.cssText = 'opacity:.4;';
                card.appendChild(none);
            }
            bar.appendChild(card);
        }

        return bar;
    }

    // ─── INJECT ────────────────────────────────────────────────────────────
    function removeExisting() {
        document.getElementById(CONTAINER_ID)?.remove();
    }

    async function inject() {
        const runId = ++currentRun;
        removeExisting();

        const projectPath = getProjectPath();
        if (!projectPath) return;

        // When the Rails marker explicitly says we're not on a project page
        // (e.g. a subgroup page with a 2-segment path), bail fast instead of
        // waiting 2s for DOM indicators that will never arrive.
        if (looksLikeProjectPage() === false) return;

        const gated = await waitForAny(PROJECT_INDICATORS, runId);
        if (!gated || runId !== currentRun) return;

        const target = document.querySelector('main') || document.body;
        if (!target) return;

        const placeholder = barShell('Loading latest deploys…');
        target.insertBefore(placeholder, target.firstChild);

        const result = await fetchLatestDeploys(projectPath, runId);
        if (runId !== currentRun) return;

        // Bar may have been removed by a navigation handler between awaits.
        const stillThere = document.getElementById(CONTAINER_ID);
        if (!stillThere) return;

        if (result && result.ok) {
            stillThere.replaceWith(buildBar(result.deploys));
        } else {
            stillThere.remove();
        }
    }

    // ─── SPA NAVIGATION HANDLING ───────────────────────────────────────────
    (function (h) {
        const fire = () => window.dispatchEvent(new Event('tm-locationchange'));
        const ps = h.pushState, rs = h.replaceState;
        h.pushState    = function () { const r = ps.apply(this, arguments); fire(); return r; };
        h.replaceState = function () { const r = rs.apply(this, arguments); fire(); return r; };
        window.addEventListener('popstate', fire);
    })(window.history);

    let debounce;
    const onNav = () => {
        clearTimeout(debounce);
        currentRun++;
        abortInFlight();
        removeExisting();
        debounce = setTimeout(inject, 250);
    };
    window.addEventListener('tm-locationchange', onNav);
    // GitLab uses Turbo for some partial navigations; these events fire
    // where `pushState` wouldn't, so listen directly.
    document.addEventListener('turbo:load', onNav);
    document.addEventListener('turbo:render', onNav);

    inject();
})();
