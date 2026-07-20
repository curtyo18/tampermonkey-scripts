import { describe, it, expect } from 'vitest';
import {
  activeRecordingAccount,
  appendStep,
  isRecordingStale,
  startRecording,
  stopRecording,
} from '../src/recording';
import { RECORDING_MAX_AGE_MS, SCHEMA_VERSION, type Store } from '../src/types';

const PAGE = 'https://example.com/login*';

function store(overrides: Partial<Store> = {}): Store {
  return {
    schemaVersion: SCHEMA_VERSION,
    accounts: [
      {
        id: 'a1',
        name: 'dev1 payments acc',
        steps: [],
        autoSubmit: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    recording: null,
    run: null,
    ...overrides,
  };
}

describe('appendStep', () => {
  it('appends a step with a generated id', () => {
    const next = appendStep(store(), 'a1', {
      kind: 'fill',
      selector: '#u',
      pagePattern: PAGE,
      value: 'alice',
    });

    expect(next.accounts[0].steps).toHaveLength(1);
    expect(next.accounts[0].steps[0].id).toBeTruthy();
    expect(next.accounts[0].steps[0].pagePattern).toBe(PAGE);
  });

  it('leaves other accounts untouched', () => {
    const next = appendStep(store(), 'missing', {
      kind: 'click',
      selector: '#go',
      pagePattern: PAGE,
    });

    expect(next.accounts[0].steps).toHaveLength(0);
  });

  it('does not mutate the store it was given', () => {
    const base = store();
    appendStep(base, 'a1', { kind: 'fill', selector: '#u', pagePattern: PAGE, value: 'x' });
    expect(base.accounts[0].steps).toHaveLength(0);
  });

  it('clears a previous submit flag when a new submit step is added', () => {
    let next = appendStep(store(), 'a1', {
      kind: 'click',
      selector: '#first',
      pagePattern: PAGE,
      isSubmit: true,
    });
    next = appendStep(next, 'a1', {
      kind: 'click',
      selector: '#second',
      pagePattern: PAGE,
      isSubmit: true,
    });

    const flagged = next.accounts[0].steps.filter((s) => s.isSubmit);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].selector).toBe('#second');
  });

  it('does not disturb the submit flag when adding a non-submit step', () => {
    let next = appendStep(store(), 'a1', {
      kind: 'click',
      selector: '#go',
      pagePattern: PAGE,
      isSubmit: true,
    });
    next = appendStep(next, 'a1', {
      kind: 'fill',
      selector: '#u',
      pagePattern: PAGE,
      value: 'alice',
    });

    expect(next.accounts[0].steps.filter((s) => s.isSubmit)).toHaveLength(1);
  });
});

describe('recording sessions', () => {
  it('starts and stops', () => {
    const started = startRecording(store(), 'a1');
    expect(started.recording?.accountId).toBe('a1');
    expect(stopRecording(started).recording).toBeNull();
  });

  it('treats an old session as stale', () => {
    const session = { accountId: 'a1', startedAt: 0 };
    expect(isRecordingStale(session, RECORDING_MAX_AGE_MS + 1)).toBe(true);
    expect(isRecordingStale(session, RECORDING_MAX_AGE_MS - 1)).toBe(false);
  });

  it('returns null for a stale session', () => {
    const base = store({ recording: { accountId: 'a1', startedAt: 0 } });
    expect(activeRecordingAccount(base, RECORDING_MAX_AGE_MS + 1)).toBeNull();
  });

  it('returns null when the session points at a deleted account', () => {
    const base = store({ accounts: [], recording: { accountId: 'a1', startedAt: Date.now() } });
    expect(activeRecordingAccount(base)).toBeNull();
  });

  it('returns null when there is no session at all', () => {
    expect(activeRecordingAccount(store())).toBeNull();
  });

  it('returns the account for a live session', () => {
    const base = store({ recording: { accountId: 'a1', startedAt: Date.now() } });
    expect(activeRecordingAccount(base)?.id).toBe('a1');
  });
});
