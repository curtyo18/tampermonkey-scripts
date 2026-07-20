import { describe, it, expect, beforeEach } from 'vitest';
import { createStorage, emptyStore, parseStore, serialiseStore } from '../src/storage';
import { SCHEMA_VERSION, STORE_KEY, type Store } from '../src/types';

type ChangeListener = (
  key: string,
  oldValue: string | undefined,
  newValue: string | undefined,
  remote: boolean,
) => void;

/** Stands in for Tampermonkey's global GM_* functions — four assignments, no framework. */
function installFakeGm(): { values: Map<string, string>; fire: (raw: string | undefined, remote?: boolean) => void } {
  const values = new Map<string, string>();
  const listeners: ChangeListener[] = [];
  const globals = globalThis as Record<string, unknown>;

  globals.GM_getValue = (key: string) => values.get(key);
  globals.GM_setValue = (key: string, value: string) => void values.set(key, value);
  globals.GM_addValueChangeListener = (_key: string, fn: ChangeListener) => void listeners.push(fn);

  return {
    values,
    fire: (raw, remote = true) => listeners.forEach((fn) => fn(STORE_KEY, undefined, raw, remote)),
  };
}

function validStore(): Store {
  return {
    schemaVersion: SCHEMA_VERSION,
    accounts: [
      {
        id: 'a1',
        name: 'dev1 payments acc',
        steps: [
          {
            id: 's1',
            kind: 'fill',
            selector: '#user',
            pagePattern: 'https://example.com/login*',
            value: 'alice',
          },
        ],
        autoSubmit: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    recording: null,
    run: null,
  };
}

describe('parseStore', () => {
  it('returns an empty store when nothing is saved yet', () => {
    const result = parseStore(undefined);
    expect(result.store).toEqual(emptyStore());
    expect(result.readOnly).toBe(false);
    expect(result.error).toBeNull();
  });

  it('round-trips a valid store', () => {
    const store = validStore();
    const result = parseStore(serialiseStore(store));
    expect(result.store).toEqual(store);
    expect(result.error).toBeNull();
  });

  it('reports an error and yields an empty store for unparseable JSON', () => {
    const result = parseStore('{not json');
    expect(result.store).toEqual(emptyStore());
    expect(result.error).toMatch(/could not be read/i);
    expect(result.readOnly).toBe(true);
  });

  it('marks a newer schema version read-only so it is never clobbered', () => {
    const future = { ...validStore(), schemaVersion: SCHEMA_VERSION + 1 };
    const result = parseStore(JSON.stringify(future));
    expect(result.readOnly).toBe(true);
    expect(result.error).toMatch(/newer version/i);
  });

  it('drops accounts that are structurally invalid rather than failing wholesale', () => {
    const mixed = { ...validStore(), accounts: [...validStore().accounts, { id: 'bad' }] };
    const result = parseStore(JSON.stringify(mixed));
    expect(result.store.accounts).toHaveLength(1);
    expect(result.store.accounts[0].id).toBe('a1');
  });

  it('defaults missing top-level fields', () => {
    const result = parseStore(JSON.stringify({ schemaVersion: SCHEMA_VERSION }));
    expect(result.store.accounts).toEqual([]);
    expect(result.store.recording).toBeNull();
    expect(result.store.run).toBeNull();
  });

  it('does not throw on a JSON null', () => {
    expect(() => parseStore('null')).not.toThrow();
    expect(parseStore('null').readOnly).toBe(true);
  });

  it.each(['null', '"hello"', '42', '[]'])(
    'treats the non-object root %s as corrupt rather than empty',
    (raw) => {
      const result = parseStore(raw);
      expect(result.readOnly).toBe(true);
      expect(result.error).toMatch(/could not be read/i);
    },
  );

  it('treats a missing schemaVersion as corrupt', () => {
    const result = parseStore(JSON.stringify({ accounts: [] }));
    expect(result.readOnly).toBe(true);
  });

  it('treats a non-numeric schemaVersion as corrupt rather than slipping past the version gate', () => {
    const result = parseStore(JSON.stringify({ schemaVersion: '2', accounts: [] }));
    expect(result.readOnly).toBe(true);
  });

  it('treats a non-array accounts field as corrupt, not as an empty config', () => {
    const result = parseStore(JSON.stringify({ schemaVersion: SCHEMA_VERSION, accounts: 'oops' }));
    expect(result.readOnly).toBe(true);
  });

  it('drops an account whose steps are structurally invalid', () => {
    const bad = validStore();
    bad.accounts[0].steps = [{ id: 's1', selector: 123 } as never];
    expect(parseStore(JSON.stringify(bad)).store.accounts).toHaveLength(0);
  });

  it('drops an unusable run state without locking the store read-only', () => {
    const bad = { ...validStore(), run: { accountId: 'a1', attempts: 'abc' } };
    const result = parseStore(JSON.stringify(bad));
    expect(result.store.run).toBeNull();
    expect(result.readOnly).toBe(false);
    expect(result.store.accounts).toHaveLength(1);
  });

  it('drops an unusable recording session', () => {
    const bad = { ...validStore(), recording: { accountId: 42 } };
    expect(parseStore(JSON.stringify(bad)).store.recording).toBeNull();
  });
});

describe('createStorage', () => {
  let gm: ReturnType<typeof installFakeGm>;

  beforeEach(() => {
    gm = installFakeGm();
  });

  it('round-trips a store through GM storage', async () => {
    const storage = createStorage();
    await storage.save(validStore());
    expect(await storage.load()).toEqual(validStore());
  });

  it('loads an empty store when the key is unset', async () => {
    expect(await createStorage().load()).toEqual(emptyStore());
  });

  it('suppresses writes once a corrupt store has been loaded', async () => {
    gm.values.set(STORE_KEY, '{not json');
    const storage = createStorage();
    await storage.load();

    expect(storage.readOnly).toBe(true);

    const result = await storage.save(validStore());
    expect(result.written).toBe(false);
    expect(result.reason).toMatch(/could not be read/i);
    expect(gm.values.get(STORE_KEY)).toBe('{not json');
  });

  it('reports a successful write', async () => {
    expect(await createStorage().save(validStore())).toEqual({ written: true });
  });

  it('reset discards an unreadable store and resumes writing', async () => {
    gm.values.set(STORE_KEY, '{not json');
    const storage = createStorage();
    await storage.load();

    expect((await storage.reset(emptyStore())).written).toBe(true);
    expect(storage.readOnly).toBe(false);
    expect(await storage.load()).toEqual(emptyStore());

    // Writing works again afterwards — the dead end is genuinely escaped.
    expect((await storage.save(validStore())).written).toBe(true);
  });

  it('notifies the subscriber on a remote change', async () => {
    const storage = createStorage();
    let seen: Store | null = null;
    storage.subscribe((s) => {
      seen = s;
    });

    gm.fire(serialiseStore(validStore()));

    expect(seen).toEqual(validStore());
  });

  it('ignores a local change', async () => {
    const storage = createStorage();
    let calls = 0;
    storage.subscribe(() => {
      calls += 1;
    });

    gm.fire(serialiseStore(validStore()), false);

    expect(calls).toBe(0);
  });

  it('goes read-only and withholds the store when another tab writes a newer schema', async () => {
    const storage = createStorage();
    let calls = 0;
    storage.subscribe(() => {
      calls += 1;
    });

    gm.fire(JSON.stringify({ ...validStore(), schemaVersion: SCHEMA_VERSION + 1 }));

    expect(calls).toBe(0);
    expect(storage.readOnly).toBe(true);

    // The newer config must survive: this tab may no longer write over it.
    gm.values.set(STORE_KEY, 'newer-config');
    await storage.save(validStore());
    expect(gm.values.get(STORE_KEY)).toBe('newer-config');
  });
});
