# 0004. Page-scoped steps instead of a run cursor

Date: 2026-07-20
Status: accepted

Supersedes the "navigation-spanning runs" section of
`.local/specs/2026-07-20-auto-login-design.md`.

## Context

Multi-page login flows (email → Next → password → Sign in) mean a run cannot complete in one document: the click that advances the flow destroys the JavaScript realm mid-execution. The original design handled this with a persisted `RunCursor` holding a step index, resumed on the next page load if the URL still matched and the cursor was under 30 seconds old.

Implementing it exposed that the cursor rests on a distinction the script cannot make. After a submit click navigates, nothing observable separates "the login succeeded" from "the login page re-rendered with an error". Both are just: the page navigated. Three separate defects followed from that single ambiguity, and none of them was fixable locally:

- **A successful login reported an error.** On a realistic pattern like `https://example.com/*`, the post-login `/dashboard` still matched, so the cursor looked resumable. The run resumed at the submit step, found no button, and raised a failure toast after every successful login.
- **A retry submitted an empty form.** Resuming at the recorded step index skipped the `fill` steps, so re-landing on the login page clicked submit against blank fields — burning the attempt budget on submissions that could never succeed.
- **The lockout guard did not guard.** When a submit did *not* navigate — bad credentials, SPA re-rendering in place, the exact case `MAX_SUBMIT_ATTEMPTS` exists for — the loop ran to completion and returned `completed`. The caller cleared the cursor on success, destroying the attempt count. The counter never reached 2.

The alternative considered was dropping cross-navigation resume entirely and requiring a button click per page. That removes every defect above and is by some margin the simplest option, but it makes SSO flows visibly worse to use.

## Decision

Each `Step` records the URL pattern of the page it was recorded on. At run time the steps belonging to the current page are derived by matching that pattern against the current URL — the first maximal contiguous block wins — and a run executes only that block. There is no step cursor and no resume index.

`RunCursor` is replaced by `RunState`, which carries only an account id and a consecutive-automatic-submit count, used solely for the lockout guard. A manual click of the trigger button resets that count: the danger being guarded against is an automatic loop, not a human deciding to try again.

`AccountConfig.pattern` is removed. An account applies to a page when any of its steps does.

## Consequences

The three defects vanish structurally rather than being patched. A successful login lands on a page matching no block, so nothing runs and nothing is reported. A retry re-matches the login page's block from the top, refilling before submit. The submit count lives on the account and survives the success path, so the guard works on the non-navigating path it was written for.

Position in the flow is now derived from observable state (the URL) rather than remembered across a realm boundary, so there is nothing to keep in sync and nothing to expire — the 30-second staleness window is gone.

The cost is that step ordering alone no longer describes a flow: two steps are on the same page only if their patterns agree, so the recorder must capture a pattern per step, and hand-editing a pattern can silently split or merge blocks. A flow that legitimately revisits the same URL twice with different steps cannot be expressed, because the first matching block always wins — an acceptable limit for login flows, and the reason the block is taken as contiguous rather than as every matching step.
