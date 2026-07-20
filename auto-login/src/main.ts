import { compilePattern } from './match';
import { pickElement } from './picker';
import { appendStep } from './steps';
import {
  accountMatchesPage,
  isAutoRunBlocked,
  runSteps,
  seedAttempts,
  stepsForPage,
} from './runner';
import { applyMergePlan, buildMergePlan, decodeShare, encodeShare } from './share';
import { createStorage, emptyStore } from './storage';
import { Ui } from './ui';
import {
  MAX_SUBMIT_ATTEMPTS,
  newId,
  type AccountConfig,
  type SelectorCandidate,
  type Step,
  type Store,
} from './types';

void (async function main() {
  const storage = createStorage();
  let store: Store = await storage.load();

  const url = location.href;
  const matches = store.accounts.filter((account) => accountMatchesPage(account, url));

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

  // Dormant: nothing on this page, so touch no DOM at all. An unreadable store
  // is deliberately NOT dormant — it yields zero matches, which would otherwise
  // be indistinguishable from an unconfigured page.
  if (matches.length === 0 && !storage.lastError) {
    // Leaving the account's pages is the only reliable signal that a login
    // finished, so it is where the lockout counter resets.
    if (store.run) void persist({ ...store, run: null });
    return;
  }

  ui.mount();

  if (storage.lastError) {
    ui.toast(storage.lastError, 'error', 10000);
    return;
  }

  const blocked = matches.length === 1 && isAutoRunBlocked(store.run, matches[0].id);
  if (matches.length === 1 && !blocked) {
    void run(matches[0], { manual: false });
  } else {
    ui.renderTrigger(
      matches,
      blocked
        ? `Automatic login paused after ${MAX_SUBMIT_ATTEMPTS} attempts — click to try again.`
        : undefined,
    );
  }

  async function persist(next: Store): Promise<void> {
    store = next;
    const result = await storage.save(next);
    // Without this the UI shows a phantom write: the account appears in the
    // panel, then vanishes on reload, with nothing said about why.
    if (!result.written) ui.toast(result.reason ?? 'Changes could not be saved.', 'error', 10000);
  }

  async function run(account: AccountConfig, opts: { manual: boolean }): Promise<void> {
    ui.clear();

    const steps = stepsForPage(account, location.href);
    if (steps.length === 0) {
      ui.toast(`"${account.name}" has no steps recorded for this page.`, 'warn');
      ui.renderTrigger([account]);
      return;
    }

    const attempts = seedAttempts(store.run, account.id, opts.manual);

    const report = await runSteps(steps, account.autoSubmit, document);

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
