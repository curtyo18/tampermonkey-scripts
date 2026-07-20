import {
  RECORDING_MAX_AGE_MS,
  newId,
  type AccountConfig,
  type RecordingSession,
  type Step,
  type Store,
} from './types';

export function startRecording(store: Store, accountId: string): Store {
  return { ...store, recording: { accountId, startedAt: Date.now() } };
}

export function stopRecording(store: Store): Store {
  return { ...store, recording: null };
}

export function isRecordingStale(session: RecordingSession, now = Date.now()): boolean {
  return now - session.startedAt > RECORDING_MAX_AGE_MS;
}

/**
 * The account config being recorded into, or null if the session is missing,
 * stale, or points at an account that has since been deleted.
 */
export function activeRecordingAccount(store: Store, now = Date.now()): AccountConfig | null {
  if (!store.recording || isRecordingStale(store.recording, now)) return null;
  return store.accounts.find((a) => a.id === store.recording!.accountId) ?? null;
}

/**
 * Append a step to an account. Persisted immediately by the caller so a
 * navigation mid-recording loses nothing.
 *
 * Setting `isSubmit` clears it everywhere else in the same account: "at most
 * one submit step" is an invariant the type cannot express, and two flagged
 * steps would burn MAX_SUBMIT_ATTEMPTS at double rate, tripping the lockout
 * guard after a single real run.
 */
export function appendStep(store: Store, accountId: string, step: Omit<Step, 'id'>): Store {
  return {
    ...store,
    accounts: store.accounts.map((account) => {
      if (account.id !== accountId) return account;

      const existing = step.isSubmit
        ? account.steps.map((s) => (s.isSubmit ? { ...s, isSubmit: false } : s))
        : account.steps;

      return {
        ...account,
        steps: [...existing, { ...step, id: newId() }],
        updatedAt: Date.now(),
      };
    }),
  };
}
