import { newId, type Step, type Store } from './types';

/**
 * Append a step to an account. Persisted immediately by the caller so a
 * navigation mid-configuration loses nothing.
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
