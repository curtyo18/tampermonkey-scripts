import { matchesPattern } from './match';
import {
  ATTEMPTS_WINDOW_MS,
  MAX_SUBMIT_ATTEMPTS,
  WAIT_TIMEOUT_MS,
  type AccountConfig,
  type PageDecision,
  type RunReport,
  type RunState,
  type Step,
  type Store,
} from './types';

/**
 * A run state stops counting once it is outside the window — otherwise a
 * count from an abandoned attempt an hour ago still suppresses today's.
 */
function isFresh(run: RunState | null, accountId: string, now: number): run is RunState {
  return !!run && run.accountId === accountId && now - run.updatedAt <= ATTEMPTS_WINDOW_MS;
}

/** Whether the lockout guard should suppress an AUTOMATIC run of this account. */
export function isAutoRunBlocked(run: RunState | null, accountId: string, now = Date.now()): boolean {
  return isFresh(run, accountId, now) && run.attempts >= MAX_SUBMIT_ATTEMPTS;
}

/**
 * The attempt count a new run starts from.
 *
 * A manual click always starts at zero: the guard exists to stop an automatic
 * loop, not to refuse a human who has decided to retry. Reads the same freshness
 * rule as `isAutoRunBlocked`, so a released guard does not immediately re-arm
 * from a stale count.
 */
export function seedAttempts(
  run: RunState | null,
  accountId: string,
  manual: boolean,
  now = Date.now(),
): number {
  if (manual) return 0;
  return isFresh(run, accountId, now) ? run.attempts : 0;
}

/**
 * The steps belonging to the page at `url`: the first maximal contiguous run of
 * steps whose pagePattern matches.
 *
 * "First" is what makes a retry work. Landing back on the login page after bad
 * credentials matches that page's block again, so the fields are refilled
 * before submit fires — the previous step-cursor design resumed at the submit
 * step and clicked it against an empty form.
 *
 * An empty result means this page is not part of the flow, which is also how a
 * successful login reads: the post-login page matches no block, so nothing runs
 * and nothing is reported as broken.
 */
export function stepsForPage(account: AccountConfig, url: string): Step[] {
  const start = account.steps.findIndex((step) => matchesPattern(step.pagePattern, url));
  if (start === -1) return [];

  const group: Step[] = [];
  for (let i = start; i < account.steps.length; i++) {
    if (!matchesPattern(account.steps[i].pagePattern, url)) break;
    group.push(account.steps[i]);
  }
  return group;
}

/** True when any of the account's steps belong to the page at `url`. */
export function accountMatchesPage(account: AccountConfig, url: string): boolean {
  return account.steps.some((step) => matchesPattern(step.pagePattern, url));
}

/**
 * Decide what should happen on the page at `url`, given everything known about
 * it. Pure: no DOM, no clock beyond the injected `now`, no storage.
 *
 * This exists as its own function because it is the part with the branches
 * worth testing, and it used to be welded to `location`, `document` and the UI
 * inside the entry IIFE where none of it could be reached by a test.
 *
 * An unreadable store is deliberately NOT dormant — it yields zero matches,
 * which would otherwise be indistinguishable from an unconfigured page.
 */
export function decideForPage(
  store: Store,
  url: string,
  storageError: string | null,
  now = Date.now(),
): PageDecision {
  const matches = store.accounts.filter((account) => accountMatchesPage(account, url));

  if (matches.length === 0 && !storageError) return { kind: 'dormant' };
  if (storageError) return { kind: 'error', message: storageError };

  if (matches.length !== 1) return { kind: 'trigger', matches };

  const account = matches[0];
  if (isAutoRunBlocked(store.run, account.id, now)) {
    return {
      kind: 'trigger',
      matches,
      blockedReason: `Automatic login paused after ${MAX_SUBMIT_ATTEMPTS} attempts — click to try again.`,
    };
  }

  const steps = stepsForPage(account, url);
  return { kind: 'run', account, steps, key: `${account.id}:${steps.map((s) => s.id).join(',')}` };
}

/**
 * Assigning `el.value` directly is swallowed by React: its value tracker sees
 * no change and reverts the field on the next render. Writing through the
 * native setter bypasses the tracker, and the dispatched events are what
 * React, Angular and Vue actually listen to.
 *
 * The setter is read off the element's own prototype rather than a global
 * constructor, so an element from another document still works and a
 * subclassed input does not get the wrong one.
 *
 * Deliberately does NOT blur afterwards: identity-first flows (Okta, Microsoft)
 * advance the screen on username blur, which would tear the form down before
 * the password step runs. Blur would also make the browser fire a second,
 * native `change` on top of the one dispatched here.
 */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;

  el.focus();
  if (setter) setter.call(el, value);
  else el.value = value;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * `isStale` is what stops this resolving onto the wrong page. The observer
 * watches the whole subtree, so an SPA rendering its *next* route is itself a
 * childList mutation — without this check a wait started on the login page
 * happily resolves against a same-named field on the page after it, and the
 * caller then types credentials into it.
 */
export function waitForElement(
  selector: string,
  doc: Document,
  timeoutMs: number,
  isStale: () => boolean = () => false,
): Promise<Element | null> {
  let existing: Element | null;
  try {
    existing = doc.querySelector(selector);
  } catch {
    return Promise.resolve(null);
  }
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (isStale()) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(null);
        return;
      }

      const found = doc.querySelector(selector);
      if (!found) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve(found);
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);

    // No `attributes: true`: on a busy SPA that fires this callback on every
    // attribute mutation anywhere in the document, and an element appearing is
    // a childList change by definition.
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  });
}

function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  const tag = el.tagName.toLowerCase();
  return (tag === 'input' || tag === 'textarea') && 'value' in el;
}

/**
 * Execute one page's steps. There is no resume index: the caller passes the
 * steps belonging to the current page, and a navigation simply ends this run —
 * the next page load starts a fresh one for whatever block matches there.
 */
export async function runSteps(
  steps: Step[],
  autoSubmit: boolean,
  doc: Document,
  isStale: () => boolean = () => false,
): Promise<RunReport> {
  const abandoned = (i: number): RunReport => ({
    outcome: 'abandoned',
    stepIndex: i,
    submitted: false,
  });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const where = `Step ${i + 1} (${step.kind})`;

    // Checked at the top of every iteration, and again immediately before each
    // action below. A single check around the loop would gate only the report,
    // leaving the fill and the submit themselves free to land on a page the
    // user has already navigated to.
    if (isStale()) return abandoned(i);

    if (step.isSubmit && !autoSubmit) {
      return { outcome: 'halted-before-submit', stepIndex: i, submitted: false };
    }

    try {
      if (step.kind === 'waitFor') {
        const found = await waitForElement(
          step.selector,
          doc,
          step.timeoutMs ?? WAIT_TIMEOUT_MS,
          isStale,
        );
        if (isStale()) return abandoned(i);
        if (!found) {
          return {
            outcome: 'failed',
            stepIndex: i,
            message: `${where}: timed out waiting for ${step.selector}`,
            submitted: false,
          };
        }
        continue;
      }

      // Only the first step waits. A page block becomes current the moment its
      // pattern matches, which on an SPA route change is before the framework
      // has rendered the form — so the opening step has to tolerate an empty
      // DOM. Later steps run against a page that has already proven itself
      // present, and keeping them instant is what makes a mistyped selector
      // report in the same breath instead of after a timeout.
      //
      // The plain query runs first regardless so an invalid selector still
      // throws SyntaxError into the catch below, rather than being flattened
      // into a "nothing matched" after the full timeout.
      let el = doc.querySelector(step.selector);
      if (!el && i === 0) {
        el = await waitForElement(step.selector, doc, WAIT_TIMEOUT_MS, isStale);
        // The wait is the long one — seconds during which the route can change
        // underneath an element that has only just appeared.
        if (isStale()) return abandoned(i);
      }

      if (!el) {
        return {
          outcome: 'failed',
          stepIndex: i,
          message: `${where}: nothing matched ${step.selector}`,
          submitted: false,
        };
      }

      if (step.kind === 'fill') {
        if (!isTextField(el)) {
          return {
            outcome: 'failed',
            stepIndex: i,
            message: `${where}: ${step.selector} is not a text field`,
            submitted: false,
          };
        }
        if (step.value === undefined) {
          return {
            outcome: 'failed',
            stepIndex: i,
            message: `${where}: no value configured for ${step.selector}`,
            submitted: false,
          };
        }
        if (isStale()) return abandoned(i);
        setNativeValue(el, step.value);
        continue;
      }

      // click. Duck-typed rather than `instanceof HTMLElement`, which fails
      // across documents — and an icon-only submit button often resolves to an
      // inner <svg>, where click() does not exist at all.
      const clickable = el as Partial<HTMLElement>;
      if (typeof clickable.click !== 'function') {
        return {
          outcome: 'failed',
          stepIndex: i,
          message: `${where}: ${step.selector} is not clickable`,
          submitted: false,
        };
      }
      if (isStale()) return abandoned(i);
      clickable.click();

      if (step.isSubmit) {
        // Report immediately: a submit that navigates never reaches the end of
        // this loop, so the caller has to learn about it here.
        return { outcome: 'completed', stepIndex: i + 1, submitted: true };
      }
    } catch (error) {
      // Selectors are hand-editable free text, so querySelector can throw
      // SyntaxError. Without this the rejection escapes an un-awaited caller,
      // leaving no toast and a torn-down UI.
      return {
        outcome: 'failed',
        stepIndex: i,
        message: `${where}: ${step.selector} — ${(error as Error).message}`,
        submitted: false,
      };
    }
  }

  return { outcome: 'completed', stepIndex: steps.length, submitted: false };
}
