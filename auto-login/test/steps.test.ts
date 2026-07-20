import { describe, it, expect } from 'vitest';
import { appendStep } from '../src/steps';
import { SCHEMA_VERSION, type Store } from '../src/types';

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
