# GitLab Deploy Bar

A Tampermonkey userscript that prepends a compact bar to every GitLab
project page showing the latest **successful** deploy job per
environment — who ran it, when, and the ref that shipped. Click the ref
to jump straight to the job.

![Deploy bar shown at the top of a GitLab project page](./docsExample.png)

## Features

- One-line summary of Dev / Staging / Prod deploy state at the top of
  every project page.
- Works on any GitLab host (gitlab.com, self-hosted, rebranded) —
  auto-detects via GitLab's own DOM markers.
- Picks up the **human** who pressed play on a manual deploy, not the
  bot that triggered the pipeline.
- SPA-aware: updates as you navigate between projects. In-flight API
  calls are cancelled on navigation so the bar never shows stale data.
- 2-minute per-project cache keeps it light on GitLab's API.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your
   browser.
2. Open [`gitlab-deploy-bar.user.js`](./gitlab-deploy-bar.user.js) in
   raw view — Tampermonkey will prompt to install. Alternatively, copy
   the file contents into a new userscript.

No host configuration is needed. You will likely want to edit the job
names — see below.

## Configuration

Environments and job names are defined inline at the top of the script:

```js
const ENVS = [
    { jobName: 'deploy-dev',     label: 'DEV',     color: '#3b82f6' },
    { jobName: 'deploy-staging', label: 'STAGING', color: '#f59e0b' },
    { jobName: 'deploy-prod',    label: 'PROD',    color: '#ef4444' },
];
```

`jobName` must match your CI job names exactly. `label` and `color`
control how each environment is rendered in the bar.

The script queries GitLab's GraphQL API for the most recent `SUCCESS`
job with each name (`kind: BUILD`), and falls back to the REST jobs
endpoint to resolve the user who pressed play on manual deploys (older
GitLab GraphQL doesn't expose `user` on `CiJob`).

## How it works

- **GitLab detection** — structural signals (`body[data-page]`, the
  `/-/manifest.json` link tag) rather than the `application-name` meta,
  which is removed on some self-hosted / rebranded instances.
- **Project detection** — URL-based. Pulls the project path from
  `location.pathname` up to the `/-/` split and filters out reserved
  top-level segments (`admin`, `dashboard`, `groups`, etc.). If
  `body[data-page]` is present and doesn't start with `projects:` (e.g.
  a subgroup or user page whose URL happens to look project-shaped),
  it bails immediately; otherwise it waits for a project-scoped DOM
  signal (`body[data-project-id]`, `.js-project-path`, etc.) before
  rendering.
- **Caching** — per-project-path results cached for 2 minutes to avoid
  thrashing the API on rapid SPA navigation.
- **SPA navigation** — hooks `pushState` / `replaceState` / `popstate`
  and Turbo's `turbo:load` / `turbo:render` events, debounced 250 ms.
  A `currentRun` counter cancels stale render paths, and every
  outstanding `fetch` is tracked so it can be aborted the moment the
  user navigates away.

## Pages it runs on

- Project root (`/group/subgroup/project`).
- Any project sub-page under `/-/` (pipelines, merge requests, jobs,
  pipeline detail, MR detail, etc.).
- Skipped: dashboard, explore, admin, groups, user profile, snippets,
  and anything else that isn't a project.

## Permissions

The script uses `@grant none` — no `GM_*` APIs, no cross-origin calls.
It talks to the GitLab instance you're already logged into, reusing
your existing session cookies.
