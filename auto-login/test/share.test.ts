import { describe, it, expect } from 'vitest';
import { applyMergePlan, buildMergePlan, decodeShare, encodeShare } from '../src/share';
import type { AccountConfig } from '../src/types';

function account(id: string, name: string): AccountConfig {
  return {
    id,
    name,
    steps: [
      {
        id: 's1',
        kind: 'fill',
        selector: '#u',
        pagePattern: 'https://example.com/login*',
        value: 'alice',
      },
    ],
    autoSubmit: true,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('encodeShare / decodeShare', () => {
  it('round-trips a config set', async () => {
    const accounts = [account('a1', 'dev1 payments acc'), account('a2', 'dev1 addressbook acc')];
    const decoded = await decodeShare(await encodeShare(accounts));
    expect(decoded).toEqual(accounts);
  });

  it('produces a single line with a recognisable prefix', async () => {
    const text = await encodeShare([account('a1', 'dev1 payments acc')]);
    expect(text).toMatch(/^AL1U?:/);
    expect(text).not.toContain('\n');
  });

  it('rejects a string with no known prefix', async () => {
    await expect(decodeShare('not-a-share-string')).rejects.toThrow(/not an Auto Login/i);
  });

  it('rejects a truncated payload without writing anything', async () => {
    const text = await encodeShare([account('a1', 'dev1 payments acc')]);
    await expect(decodeShare(text.slice(0, text.length - 8))).rejects.toThrow(/could not be decoded/i);
  });

  it('rejects a payload whose accounts are structurally invalid', async () => {
    const hostile = await encodeShare([{ id: 'x', name: 'nope' } as unknown as AccountConfig]);
    await expect(decodeShare(hostile)).rejects.toThrow(/could not be decoded/i);
  });

  it('rejects a payload that decodes to something other than an array', async () => {
    const notArray = await encodeShare({ id: 'x' } as unknown as AccountConfig[]);
    await expect(decodeShare(notArray)).rejects.toThrow(/could not be decoded/i);
  });
});

describe('buildMergePlan', () => {
  it('classifies an unseen account as new', () => {
    const plan = buildMergePlan([account('a1', 'dev1 payments acc')], []);
    expect(plan[0].status).toBe('new');
    expect(plan[0].action).toBe('overwrite');
    expect(plan[0].existing).toBeNull();
  });

  it('classifies a matching id as conflict-id', () => {
    const existing = [account('a1', 'renamed locally')];
    const plan = buildMergePlan([account('a1', 'dev1 payments acc')], existing);
    expect(plan[0].status).toBe('conflict-id');
    expect(plan[0].existing).toEqual(existing[0]);
  });

  it('classifies a matching name under a different id as conflict-name', () => {
    const plan = buildMergePlan([account('a2', 'dev1 payments acc')], [account('a1', 'dev1 payments acc')]);
    expect(plan[0].status).toBe('conflict-name');
  });

  it('defaults conflicting rows to keep-both so nothing is lost by accident', () => {
    const plan = buildMergePlan([account('a1', 'dev1 payments acc')], [account('a1', 'local')]);
    expect(plan[0].action).toBe('keep-both');
  });
});

describe('applyMergePlan', () => {
  it('leaves existing accounts untouched for skipped rows', () => {
    const existing = [account('a1', 'local')];
    const plan = buildMergePlan([account('a1', 'incoming')], existing);
    plan[0].action = 'skip';
    expect(applyMergePlan(plan, existing)).toEqual(existing);
  });

  it('replaces the existing account on overwrite', () => {
    const existing = [account('a1', 'local')];
    const plan = buildMergePlan([account('a1', 'incoming')], existing);
    plan[0].action = 'overwrite';
    const merged = applyMergePlan(plan, existing);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('incoming');
  });

  it('adds a suffixed copy under a fresh id on keep-both', () => {
    const existing = [account('a1', 'local')];
    const plan = buildMergePlan([account('a1', 'incoming')], existing);
    plan[0].action = 'keep-both';
    const merged = applyMergePlan(plan, existing);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(existing[0]);
    expect(merged[1].name).toBe('incoming (imported)');
    expect(merged[1].id).not.toBe('a1');
  });

  it('appends new accounts', () => {
    const plan = buildMergePlan([account('a2', 'second')], [account('a1', 'first')]);
    const merged = applyMergePlan(plan, [account('a1', 'first')]);
    expect(merged.map((a) => a.name)).toEqual(['first', 'second']);
  });

  it('does not mutate the array it was given', () => {
    const existing = [account('a1', 'local')];
    const plan = buildMergePlan([account('a2', 'incoming')], existing);
    applyMergePlan(plan, existing);
    expect(existing).toHaveLength(1);
  });
});
