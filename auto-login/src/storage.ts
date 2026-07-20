import {
  SCHEMA_VERSION,
  STORE_KEY,
  type AccountConfig,
  type RecordingSession,
  type RunCursor,
  type SaveResult,
  type StepKind,
  type StorageAdapter,
  type Store,
} from './types';

export interface ParseResult {
  store: Store;
  /** True when the store must not be written back — corrupt, or written by a newer version. */
  readOnly: boolean;
  error: string | null;
}

const STEP_KINDS: StepKind[] = ['fill', 'click', 'waitFor'];

export function emptyStore(): Store {
  return { schemaVersion: SCHEMA_VERSION, accounts: [], recording: null, run: null };
}

export function serialiseStore(store: Store): string {
  return JSON.stringify(store);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStep(value: unknown): boolean {
  if (!isRecord(value)) return false;
  // selector must be a string: querySelector(123) throws SyntaxError, and
  // querySelector(undefined) silently matches nothing under the type selector
  // "undefined" — both surface as baffling failures deep inside a run.
  return (
    typeof value.id === 'string' &&
    typeof value.selector === 'string' &&
    STEP_KINDS.includes(value.kind as StepKind)
  );
}

/**
 * Structural gate for one account config. Exported because share strings are
 * the only genuinely untrusted input in the product — a teammate's paste must
 * clear the same bar as anything read back from storage.
 */
export function isAccount(value: unknown): value is AccountConfig {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.pattern === 'string' &&
    typeof value.autoSubmit === 'boolean' &&
    Array.isArray(value.steps) &&
    value.steps.every(isStep)
  );
}

function isRecordingSession(value: unknown): value is RecordingSession {
  return isRecord(value) && typeof value.accountId === 'string' && typeof value.startedAt === 'number';
}

function isRunCursor(value: unknown): value is RunCursor {
  return (
    isRecord(value) &&
    typeof value.accountId === 'string' &&
    Number.isInteger(value.stepIndex) &&
    typeof value.startedAt === 'number' &&
    typeof value.attempts === 'number'
  );
}

function corrupt(): ParseResult {
  return {
    store: emptyStore(),
    readOnly: true,
    error: 'Saved config could not be read and has been left untouched.',
  };
}

function newerVersion(): ParseResult {
  return {
    store: emptyStore(),
    readOnly: true,
    error: 'Config was written by a newer version of Auto Login and will not be modified.',
  };
}

export function parseStore(raw: string | undefined): ParseResult {
  if (raw === undefined || raw === '') {
    return { store: emptyStore(), readOnly: false, error: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return corrupt();
  }

  // Anything that is not a plain object is corruption, not an empty config.
  // Treating it as empty would let the next write silently replace a store we
  // simply failed to understand.
  if (!isRecord(parsed)) return corrupt();

  // Every store written under STORE_KEY carries a numeric schemaVersion, so a
  // missing or non-numeric one means the blob is not ours. Demanding a number
  // also closes the gap where `schemaVersion: "2"` slipped past the newer-
  // version gate below and got clobbered.
  if (typeof parsed.schemaVersion !== 'number') return corrupt();
  if (parsed.schemaVersion > SCHEMA_VERSION) return newerVersion();
  if (parsed.accounts !== undefined && !Array.isArray(parsed.accounts)) return corrupt();

  return {
    store: {
      schemaVersion: SCHEMA_VERSION,
      accounts: (parsed.accounts ?? []).filter(isAccount),
      // A bad cursor or session is transient state, not user data worth
      // preserving — drop it rather than locking the whole store read-only.
      recording: isRecordingSession(parsed.recording) ? parsed.recording : null,
      run: isRunCursor(parsed.run) ? parsed.run : null,
    },
    readOnly: false,
    error: null,
  };
}

/**
 * The only place in the codebase that touches a GM_* API — see docs/adr/0002.
 * Async despite GM being synchronous, so a chrome.storage.local adapter can
 * drop in without rewriting every call site.
 */
export function createStorage(): StorageAdapter & { readOnly: boolean; lastError: string | null } {
  const adapter = {
    readOnly: false,
    lastError: null as string | null,

    async load(): Promise<Store> {
      // One-arg form: the two-arg overload never returns undefined.
      const result = parseStore(GM_getValue(STORE_KEY));
      adapter.readOnly = result.readOnly;
      adapter.lastError = result.error;
      return result.store;
    },

    async save(store: Store): Promise<SaveResult> {
      if (adapter.readOnly) {
        return { written: false, reason: adapter.lastError ?? 'Config is read-only.' };
      }
      GM_setValue(STORE_KEY, serialiseStore(store));
      return { written: true };
    },

    /**
     * Clears the read-only flag on purpose. Reached only from the panel's
     * "discard unreadable config" action, after the user has been shown what
     * is wrong — without it, a corrupt store is an inescapable dead end.
     */
    async reset(store: Store): Promise<SaveResult> {
      adapter.readOnly = false;
      adapter.lastError = null;
      GM_setValue(STORE_KEY, serialiseStore(store));
      return { written: true };
    },

    subscribe(onRemoteChange: (store: Store) => void): void {
      GM_addValueChangeListener(STORE_KEY, (_key, _old, newValue, remote) => {
        if (!remote) return;

        const result = parseStore(newValue);
        adapter.readOnly = result.readOnly;
        adapter.lastError = result.error;

        // Never hand back a store we have just judged unusable. Adopting the
        // empty parse of a newer-schema write from a synced device would let
        // this tab overwrite that device's config on the next save.
        if (result.readOnly) return;
        onRemoteChange(result.store);
      });
    },
  };

  return adapter;
}
