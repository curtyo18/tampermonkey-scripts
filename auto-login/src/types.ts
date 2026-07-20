export const STORE_KEY = 'autoLogin.store.v1';
export const SCHEMA_VERSION = 1;

/** Default ceiling for a `waitFor` step, and for the first step of a page block. */
export const WAIT_TIMEOUT_MS = 8000;
/** A single SPA navigation often writes history several times; settle before re-evaluating. */
export const NAV_DEBOUNCE_MS = 300;
/** Consecutive automatic submits are only counted together inside this window. */
export const ATTEMPTS_WINDOW_MS = 120_000;
/** Guards against an auto-submitting account config looping a bad credential into a lockout. */
export const MAX_SUBMIT_ATTEMPTS = 3;

export type StepKind = 'fill' | 'click' | 'waitFor';

export interface Step {
  id: string;
  kind: StepKind;
  selector: string;
  /**
   * URL pattern of the page this step was recorded on. Glob by default;
   * `/pattern/flags` is treated as a regex. Steps are grouped by page at run
   * time, which is what makes multi-page flows work — see docs/adr/0004.
   */
  pagePattern: string;
  /** `fill` only. */
  value?: string;
  /** Marks the terminal login action. At most one step per account config. */
  isSubmit?: boolean;
  /** `waitFor` only. Defaults to WAIT_TIMEOUT_MS. */
  timeoutMs?: number;
}

export interface AccountConfig {
  id: string;
  /** Free text, e.g. "dev1 payments acc". */
  name: string;
  steps: Step[];
  autoSubmit: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Tracks consecutive automatic submits for one account so a misconfigured
 * config cannot loop bad credentials into a lockout. Deliberately NOT a step
 * cursor: a run's position is derived by matching the current URL against each
 * step's pagePattern, so there is nothing to keep in sync across navigations.
 */
export interface RunState {
  accountId: string;
  attempts: number;
  updatedAt: number;
}

export interface Store {
  schemaVersion: number;
  accounts: AccountConfig[];
  run: RunState | null;
}

export interface SaveResult {
  written: boolean;
  /** Why the write was suppressed, when it was. */
  reason?: string;
}

export interface StorageAdapter {
  load(): Promise<Store>;
  /** Suppressed while the store is read-only — check `written` before claiming success. */
  save(store: Store): Promise<SaveResult>;
  /** Discard an unreadable store and resume writing. The user's explicit escape hatch. */
  reset(store: Store): Promise<SaveResult>;
  subscribe(onRemoteChange: (store: Store) => void): void;
}

export interface SelectorCandidate {
  selector: string;
  /** Human-readable reason this candidate was proposed, e.g. "id" or "name attribute". */
  label: string;
  matchCount: number;
  /**
   * Whether this selector actually resolves to the element the user clicked.
   * Uniqueness alone is not enough — a duplicated id matches exactly one
   * element and can still be the wrong one.
   */
  resolvesToPicked: boolean;
}

/**
 * There is deliberately no 'suspended' outcome. A step that navigates destroys
 * the JS realm mid-await, so `runSteps` never returns at all in that case.
 * Position in a flow is re-derived from the URL on the next load, never
 * carried across — see docs/adr/0004.
 */
/**
 * 'abandoned' means the page moved on mid-run and the remaining steps were
 * deliberately not executed. It is not a failure and must not be reported as
 * one: the sync for the new page has already decided what happens there.
 */
export type RunOutcome = 'completed' | 'halted-before-submit' | 'failed' | 'abandoned';

export interface RunReport {
  outcome: RunOutcome;
  /** The failing/halting step's index — except on 'completed', where it is steps.length. */
  stepIndex: number;
  message?: string;
  /** Whether the submit step actually fired. Drives the lockout counter. */
  submitted: boolean;
}

/**
 * What should happen on the page currently being looked at. Deliberately a
 * plain value with no DOM in it: the decision is the part worth testing, and
 * keeping it separate from applying the decision is what makes that possible.
 */
export type PageDecision =
  | { kind: 'dormant' }
  | { kind: 'error'; message: string }
  | { kind: 'trigger'; matches: AccountConfig[]; blockedReason?: string }
  | {
      kind: 'run';
      account: AccountConfig;
      steps: Step[];
      /**
       * Identifies the logical page, as opposed to the URL. A host app that
       * rewrites the query string or hash without changing which steps apply
       * keeps the same key, and an auto-run is not repeated for it.
       */
      key: string;
    };

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
