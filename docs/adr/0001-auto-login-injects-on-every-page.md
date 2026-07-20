# 0001. Auto Login injects on every page and gates itself at runtime

Date: 2026-07-20
Status: accepted

## Context

Tampermonkey evaluates `@match` before a script runs, so the set of sites a script is injected on is fixed at install time. Auto Login's whole premise is that you add sites through its own injected UI, which means the list of configured sites lives in storage and is not knowable at injection time. The two are in direct conflict.

The alternative was to keep a real `@match` list in the header that the user hand-edits in the Tampermonkey editor whenever they add a site. That keeps the script off every unrelated page, but makes adding a site a two-place operation and makes the injected configuration UI unable to do the one thing it exists for.

This is hard to reverse because the dormancy contract, the menu-command entry point, and the storage-driven matcher are all built on the assumption that the script is present everywhere.

## Decision

Ship with `@match *://*/*` plus `@noframes`. On every page the script performs a single storage read and, if no saved step's page pattern matches the URL, it does nothing further — no DOM insertion, no observers, no UI. Unconfigured pages are reached through a Tampermonkey menu command rather than by editing the header.

`@noframes` is part of the decision rather than an afterthought: without it an attacker who knows a victim's login URL could embed it in a hidden iframe and have the script auto-fill and auto-submit credentials into it on their timing, and an ad-heavy page would multiply the dormant-path storage read by the number of subframes. The cost is that a login form hosted inside an iframe cannot be automated.

## Consequences

The script is evaluated on every page the user visits, so its dormant path is performance-critical and must stay a single storage read. `gitlab-deploy-bar` and `jira-ticket-extractor` in this repo already take the same approach, so the cost is understood.

In exchange, the injected UI is fully self-sufficient: a site can be added, recorded and run without ever opening the Tampermonkey editor. It also means the script cannot be audited by reading its `@match` line — what it actually acts on is only visible in the user's own storage.
