# CONTEXT

Canonical vocabulary for this repo. Term → meaning only; no implementation detail.

## General

- **Userscript** — a single `*.user.js` file installed into Tampermonkey. Some are hand-written; some are built from `src/*.ts` by an esbuild step.
- **Dormant** — a script that has been injected into a page but has deliberately done no DOM work and rendered no UI, because the page is not in its scope.

## Auto Login

- **Account config** — one saved, named login recipe: a friendly name and an ordered list of steps. Example name: `dev1 payments acc`. An account applies to a page when any of its steps does. Account configs are a flat list; any grouping is a naming convention, not a structure.
- **URL pattern** — the string a step matches pages against. A glob by default (`*` and `?` wildcards); treated as a regular expression when written as `/…/flags`.
- **Step** — one action within an account config. Exactly one of: `fill` (put a value into an element), `click` (activate an element), `waitFor` (block until an element exists).
- **Submit step** — the step flagged as the one that actually logs you in. The terminal action of a flow, distinguished from intermediate `click` steps such as "Next".
- **Auto-submit** — per-account setting controlling whether a run executes the submit step or halts just before it.
- **Trigger button** — the floating control anchored bottom-right of a matched page that starts a run.
- **Panel** — the injected management UI for creating, editing, reordering, and deleting account configs.
- **Picker** — the mode where clicking an element on the page captures a selector for it instead of activating it.
- **Selector candidate** — one of several selector strings the picker proposes for a picked element, ranked by expected stability and annotated with how many elements it currently matches.
- **Recording session** — persisted state marking that steps are actively being captured into a given account config. Survives page navigation so multi-page flows can be recorded in one pass.
- **Step block** — the steps of one account config that belong to a single page: the first contiguous run whose page patterns match the current URL.
- **Share string** — the entire set of account configs encoded as one compact, copy-pasteable line of text. Always carries credentials in recoverable form, so it is sensitive material.
- **Import preview** — the confirmation screen listing every incoming account config from a share string and whether it is new or collides with an existing one, before anything is written.

### Superseded

- **Run cursor** — *removed.* Position in a flow is derived by matching the current URL against each step's page pattern, not remembered across navigations. See [[0004-page-scoped-steps-instead-of-a-run-cursor]].
