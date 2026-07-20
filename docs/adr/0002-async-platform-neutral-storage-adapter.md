# 0002. Storage is an async, platform-neutral adapter over GM storage

Date: 2026-07-20
Status: accepted

## Context

Every other userscript in this repo declares `@grant none`. Auto Login cannot: it is injected on every origin and must read one shared configuration set regardless of which site the user is on. `localStorage` is partitioned per origin, so a config saved on site A would be invisible on site B. Only Tampermonkey's GM storage is genuinely global, which forces `@grant GM_getValue / GM_setValue / GM_registerMenuCommand`.

Separately, this userscript is a cheap trial of an idea that may later become a Manifest V3 Chrome extension. `GM_getValue` is synchronous; `chrome.storage.local` is promise-based and cannot be made synchronous. A storage module with a sync surface would therefore push a rewrite into every call site at port time — the classic case where the cheap thing today is the expensive thing later.

## Decision

`src/storage.ts` is the only module in the codebase permitted to reference a `GM_*` API, and it exposes a deliberately narrow interface — `load()`, `save()`, `subscribe()` — that is **async even though the underlying GM calls are synchronous**. `GM_registerMenuCommand` is called exactly once, from `main.ts`. All other modules are plain DOM and TypeScript.

No other concessions are made for the hypothetical extension: no messaging abstraction, no permissions layer, no background-worker indirection.

## Consequences

Auto Login deviates from the repo's `@grant none` convention, and the deviation is load-bearing rather than incidental — it cannot be reverted without abandoning cross-origin config.

Porting to an extension becomes a single-file swap for storage plus one call site for the menu command; `match.ts`, `selector.ts`, `runner.ts`, `share.ts` and `ui.ts` — and the unit tests covering them — move across unchanged.

The cost is `await` on call sites that do not currently need it, and a slightly less direct read of what is really a synchronous operation. Anyone tempted to "simplify" this back to a sync interface should read this record first.
