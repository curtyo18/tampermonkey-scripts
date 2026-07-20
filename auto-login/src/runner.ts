import { matchesPattern } from './match';
import { WAIT_TIMEOUT_MS, type AccountConfig, type RunReport, type Step } from './types';

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

export function waitForElement(
  selector: string,
  doc: Document,
  timeoutMs: number,
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
): Promise<RunReport> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const where = `Step ${i + 1} (${step.kind})`;

    if (step.isSubmit && !autoSubmit) {
      return { outcome: 'halted-before-submit', stepIndex: i, submitted: false };
    }

    try {
      if (step.kind === 'waitFor') {
        const found = await waitForElement(step.selector, doc, step.timeoutMs ?? WAIT_TIMEOUT_MS);
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

      const el = doc.querySelector(step.selector);
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
