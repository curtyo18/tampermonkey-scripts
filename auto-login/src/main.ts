import { compilePattern } from './match';
import { pickElement } from './picker';
import { appendStep } from './steps';
import { decideForPage, runSteps, seedAttempts, stepsForPage } from './runner';
import { applyMergePlan, buildMergePlan, decodeShare, encodeShare } from './share';
import { createStorage, emptyStore } from './storage';
import { Ui } from './ui';
import {
  NAV_DEBOUNCE_MS,
  newId,
  type AccountConfig,
  type SelectorCandidate,
  type Step,
  type Store,
} from './types';

const NAV_EVENT = 'autologin-nav';
/** Marks `history` as already wrapped, so a second injection does not stack wrappers. */
const HISTORY_PATCHED = '__autoLoginHistoryPatched';

void (async function main() {
  const storage = createStorage();
  let store: Store = await storage.load();

  const ui = new Ui({
    onRun: (account) => void run(account, { manual: true }),
    onOpenPanel: () => openPanel(),
  });

  // Registered before the dormancy check so an unconfigured page is still
  // reachable — this is the only entry point on a page with no saved steps.
  GM_registerMenuCommand('Auto Login: configure this page', () => {
    ui.mount();
    openPanel();
  });

  storage.subscribe((updated) => {
    store = updated;
  });

  /**
   * Bumped on every navigation. Everything in flight compares against the value
   * it captured at the start and abandons itself once they differ.
   */
  let navGeneration = 0;
  /** The logical page an automatic run was last started for. See `PageDecision.key`. */
  let lastRunKey: string | null = null;
  /** Serialises syncs so a navigation during a long run cannot start a second one. */
  let syncing: Promise<void> = Promise.resolve();

  /**
   * Bring the UI in line with the current URL.
   *
   * Called once at load and again after every client-side navigation. An SPA
   * route change is the only "page load" some forms ever get, so evaluating
   * once at document-end leaves the script inert for the rest of the document's
   * life — which is exactly the bug this exists to prevent.
   *
   * `initial` marks the one call made for a real document load. Only that call
   * resets the lockout counter: under SPA navigation this function runs on every
   * intermediate route, and treating each of them as "the user left the login
   * page, so the login must have worked" would hand a failing auto-submit an
   * unlimited budget — the precise loop `MAX_SUBMIT_ATTEMPTS` exists to stop.
   */
  function syncToPage(opts: { initial: boolean }): Promise<void> {
    syncing = syncing.then(() => applySync(opts));
    return syncing;
  }

  async function applySync({ initial }: { initial: boolean }): Promise<void> {
    // Read, never bumped: the bump happens in the navigation listener so an
    // in-flight run learns it is stale immediately. Doing it here instead would
    // be too late — this function is queued behind that very run.
    const generation = navGeneration;
    const isStale = (): boolean => generation !== navGeneration;

    ui.clear();

    const decision = decideForPage(store, location.href, storage.lastError);

    if (decision.kind === 'dormant') {
      lastRunKey = null;
      ui.unmount();
      // Leaving the account's pages is the only reliable signal that a login
      // finished, so it is where the lockout counter resets — but only on a real
      // load, per the note above.
      if (initial && store.run) await persist({ ...store, run: null });
      return;
    }

    ui.mount();

    if (decision.kind === 'error') {
      lastRunKey = null;
      ui.toast(decision.message, 'error', 10000);
      return;
    }

    if (decision.kind === 'trigger') {
      lastRunKey = null;
      ui.renderTrigger(decision.matches, decision.blockedReason);
      return;
    }

    // Same logical page as the run we already did — a query-string or hash
    // rewrite, not a navigation. Re-running here would auto-submit repeatedly on
    // one page, which a full page load never did.
    if (decision.key === lastRunKey) {
      ui.renderTrigger([decision.account]);
      return;
    }

    lastRunKey = decision.key;
    await run(decision.account, { manual: false }, isStale);
  }

  // SPA-aware: a client-side route change fires no load event, so nothing else
  // would ever re-evaluate which account applies. Patching history is pure
  // function wrapping — no DOM, no observers — so a page that matches nothing
  // still does no work beyond this.
  (function patchHistory(history: History): void {
    // A second injection (another copy of the script, a manager re-injecting)
    // would otherwise wrap the wrapper and fire N events per navigation.
    if (Object.prototype.hasOwnProperty.call(history, HISTORY_PATCHED)) return;
    Object.defineProperty(history, HISTORY_PATCHED, { value: true });

    const fire = (): void => {
      window.dispatchEvent(new Event(NAV_EVENT));
    };
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);

    history.pushState = function (...args: Parameters<History['pushState']>) {
      const result = push(...args);
      fire();
      return result;
    };
    history.replaceState = function (...args: Parameters<History['replaceState']>) {
      const result = replace(...args);
      fire();
      return result;
    };

    window.addEventListener('popstate', fire);
    window.addEventListener('hashchange', fire);
  })(window.history);

  let navTimer: ReturnType<typeof setTimeout>;
  let currentUrl = location.href;

  window.addEventListener(NAV_EVENT, () => {
    // Gated on the URL actually changing. Host apps rewrite history on the page
    // they are already on — analytics, a `?tab=`, a scroll-restoration
    // replaceState — and treating those as navigations would abandon a
    // perfectly good run that is mid-wait.
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      // Bumped here rather than in the sync, so a run waiting on the page we
      // are leaving stops before its next fill or click, not after it.
      navGeneration++;
    }

    clearTimeout(navTimer);
    navTimer = setTimeout(() => void syncToPage({ initial: false }), NAV_DEBOUNCE_MS);
  });

  await syncToPage({ initial: true });

  async function persist(next: Store): Promise<void> {
    store = next;
    const result = await storage.save(next);
    // Without this the UI shows a phantom write: the account appears in the
    // panel, then vanishes on reload, with nothing said about why.
    if (!result.written) ui.toast(result.reason ?? 'Changes could not be saved.', 'error', 10000);
  }

  async function run(
    account: AccountConfig,
    opts: { manual: boolean },
    isStale: () => boolean = () => false,
  ): Promise<void> {
    ui.clear();

    const steps = stepsForPage(account, location.href);
    if (steps.length === 0) {
      ui.toast(`"${account.name}" has no steps recorded for this page.`, 'warn');
      ui.renderTrigger([account]);
      return;
    }

    const attempts = seedAttempts(store.run, account.id, opts.manual);

    const report = await runSteps(steps, account.autoSubmit, document, isStale);

    // The run stopped because the page moved on. Say nothing and change nothing:
    // the sync for the page we are now on decides what happens there, and a
    // toast about the previous page would only be confusing.
    if (report.outcome === 'abandoned') return;

    if (report.submitted) {
      await persist({
        ...store,
        run: { accountId: account.id, attempts: attempts + 1, updatedAt: Date.now() },
      });
      // A submit that navigates never gets here; if it does, the page stayed
      // put and the next load will decide what to do.
      return;
    }

    if (report.outcome === 'failed') {
      ui.toast(report.message ?? 'Login failed.', 'error', 10000);
      ui.renderTrigger([account]);
      return;
    }

    if (report.outcome === 'halted-before-submit') {
      ui.toast('Fields filled — auto-submit is off for this account, so finish manually.', 'warn');
      ui.renderTrigger([account]);
      return;
    }

    ui.renderTrigger([account]);
  }

  function invalidAccountIds(): Set<string> {
    return new Set(
      store.accounts
        .filter((account) => account.steps.some((s) => compilePattern(s.pagePattern) === null))
        .map((account) => account.id),
    );
  }

  function reopenPanel(): void {
    ui.clear();
    openPanel();
  }

  async function updateAccount(id: string, change: (a: AccountConfig) => AccountConfig): Promise<void> {
    await persist({
      ...store,
      accounts: store.accounts.map((a) => (a.id === id ? { ...change(a), updatedAt: Date.now() } : a)),
    });
    reopenPanel();
  }

  function openPanel(): void {
    ui.renderPanel(
      store.accounts,
      invalidAccountIds(),
      { active: storage.readOnly, reason: storage.lastError },
      {
        onDiscardUnreadableConfig: () => {
          void storage.reset(emptyStore()).then(async () => {
            store = await storage.load();
            ui.clear();
            ui.toast('Unreadable config discarded. Starting fresh.');
            openPanel();
          });
        },

        onNewAccount: () => {
          const name = prompt('Account name (e.g. "dev1 payments acc"):');
          if (!name) return;

          const account: AccountConfig = {
            id: newId(),
            name,
            steps: [],
            autoSubmit: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          void persist({ ...store, accounts: [...store.accounts, account] }).then(reopenPanel);
        },

        onRenameAccount: (account) => {
          const name = prompt('Account name:', account.name);
          if (name === null || name === '') return;
          void updateAccount(account.id, (a) => ({ ...a, name }));
        },

        onToggleAutoSubmit: (account) => {
          void updateAccount(account.id, (a) => ({ ...a, autoSubmit: !a.autoSubmit }));
        },

        onClearSteps: (account) => {
          void updateAccount(account.id, (a) => ({ ...a, steps: [] }));
        },

        onDeleteAccount: (account) => {
          void persist({
            ...store,
            accounts: store.accounts.filter((a) => a.id !== account.id),
          }).then(reopenPanel);
        },

        onAddStep: (account) => void addStepByPicking(account),

        onExport: () => encodeShare(store.accounts),

        onImport: async (text: string) => {
          let incoming: AccountConfig[];
          try {
            incoming = await decodeShare(text);
          } catch (error) {
            ui.toast((error as Error).message, 'error', 10000);
            return;
          }

          const plan = buildMergePlan(incoming, store.accounts);
          const confirmed = await ui.renderImportPreview(plan);
          if (!confirmed) return;

          await persist({ ...store, accounts: applyMergePlan(confirmed, store.accounts) });
          ui.clear();
          ui.toast(`Imported ${confirmed.filter((e) => e.action !== 'skip').length} account(s).`);
          openPanel();
        },
      },
    );
  }

  /**
   * Add one step by picking an element. The panel is torn down first so the
   * picker can reach the page underneath, then rebuilt.
   */
  async function addStepByPicking(account: AccountConfig): Promise<void> {
    ui.clear();

    const picked = await pickElement(ui.host);
    if (!picked) {
      openPanel();
      return;
    }

    const selector = chooseSelector(picked.candidates);
    if (!selector) {
      openPanel();
      return;
    }

    const pagePattern = promptForPagePattern();
    if (!pagePattern) {
      openPanel();
      return;
    }

    const isTextField =
      picked.element instanceof HTMLInputElement || picked.element instanceof HTMLTextAreaElement;

    let step: Omit<Step, 'id'>;
    if (isTextField) {
      const value = prompt(`Value to type into ${selector}:`);
      if (value === null) {
        openPanel();
        return;
      }
      step = { kind: 'fill', selector, pagePattern, value };
    } else {
      step = {
        kind: 'click',
        selector,
        pagePattern,
        isSubmit: confirm('Is this the final submit button for this login?'),
      };
    }

    await persist(appendStep(store, account.id, step));
    openPanel();
  }

  function chooseSelector(candidates: SelectorCandidate[]): string | null {
    // Only candidates that actually address the picked element are offered by
    // default — a duplicated id is unique-looking and still wrong.
    const usable = candidates.filter((c) => c.resolvesToPicked && c.matchCount === 1);
    const pool = usable.length > 0 ? usable : candidates;

    const listed = pool
      .map((c, i) => `${i + 1}. ${c.selector}  (${c.label}, matches ${c.matchCount})`)
      .join('\n');

    const warning =
      usable.length === 0
        ? '\n\nWARNING: none of these uniquely identify the element you clicked.\n'
        : '';

    const choice = prompt(`Choose a selector:${warning}\n\n${listed}\n\nEnter a number, or type a selector:`);
    if (!choice) return null;

    const index = Number(choice) - 1;
    return Number.isInteger(index) && pool[index] ? pool[index].selector : choice;
  }

  function promptForPagePattern(): string | null {
    const suggested = `${location.origin}${location.pathname}*`;
    const pattern = prompt(
      'Which pages does this step belong to?\n\n' +
        'Glob by default (* and ? are wildcards); wrap in slashes for a regex.',
      suggested,
    );
    if (!pattern) return null;

    if (compilePattern(pattern) === null) {
      ui.toast('That pattern is not valid — the step was not added.', 'error');
      return null;
    }
    return pattern;
  }
})();
