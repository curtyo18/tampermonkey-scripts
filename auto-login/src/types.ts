export const STORE_KEY = 'autoLogin.store.v1';
export const SCHEMA_VERSION = 1;

/** Default ceiling for a `waitFor` step. */
export const WAIT_TIMEOUT_MS = 8000;
/** A run cursor older than this is stale and gets discarded rather than resumed. */
export const RUN_RESUME_MAX_AGE_MS = 30_000;
/** Guards against an auto-submitting account config looping a bad credential into a lockout. */
export const MAX_SUBMIT_ATTEMPTS = 3;
/** A recording session older than this is abandoned. */
export const RECORDING_MAX_AGE_MS = 600_000;

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

export interface RecordingSession {
  accountId: string;
  startedAt: number;
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
  recording: RecordingSession | null;
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
 * the JS realm mid-await, so `runSteps` never returns at all in that case —
 * resume is carried by the persisted RunCursor, not by a return value.
 */
export type RunOutcome = 'completed' | 'halted-before-submit' | 'failed';

export interface RunReport {
  outcome: RunOutcome;
  /** The failing/halting step's index — except on 'completed', where it is steps.length. */
  stepIndex: number;
  message?: string;
  /** Whether the submit step actually fired. Drives the lockout counter. */
  submitted: boolean;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
