import type { MergeAction, MergePlanEntry } from './share';
import type { AccountConfig } from './types';

const HOST_ID = 'auto-login-host';

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }

  .trigger {
    position: fixed; right: 20px; bottom: 20px; z-index: 1;
    display: flex; align-items: center; gap: 8px;
    padding: 10px 16px; border: 1px solid #2f3846; border-radius: 8px;
    background: #171c24; color: #e6edf3; font-size: 13px; font-weight: 500;
    cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.45);
  }
  .trigger:hover { background: #1e242e; border-color: #4f9cf9; }
  .trigger.blocked { border-color: #d29922; color: #e3b341; }

  .chooser {
    position: fixed; right: 20px; bottom: 68px; z-index: 1;
    min-width: 240px; max-height: 320px; overflow-y: auto;
    background: #171c24; border: 1px solid #2f3846; border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,.45);
  }
  .chooser button {
    display: block; width: 100%; text-align: left;
    padding: 10px 14px; border: 0; background: transparent;
    color: #e6edf3; font-size: 13px; cursor: pointer;
  }
  .chooser button:hover { background: #1e242e; }

  .toast {
    position: fixed; right: 20px; bottom: 68px; z-index: 2;
    max-width: 380px; padding: 10px 14px;
    background: #171c24; border: 1px solid #2f3846; border-left: 3px solid #4f9cf9;
    border-radius: 6px; color: #e6edf3; font-size: 12px; line-height: 1.5;
  }
  .toast.error { border-left-color: #f85149; }
  .toast.warn  { border-left-color: #d29922; }

  .backdrop {
    position: fixed; inset: 0; z-index: 3;
    background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center;
  }
  .panel {
    width: min(760px, 92vw); max-height: 86vh; overflow-y: auto;
    background: #12161c; border: 1px solid #2f3846; border-radius: 10px; color: #e6edf3;
  }
  .panel header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid #2f3846; font-size: 14px; font-weight: 600;
  }
  .panel .body { padding: 14px 18px; }
  .panel h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #8b949e; }

  .row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 0; border-bottom: 1px solid #1e242e; font-size: 13px;
  }
  .row .name { flex: 1; min-width: 0; }
  .row .meta { color: #8b949e; font-size: 11px; font-family: ui-monospace, monospace; word-break: break-all; }
  .row .invalid { color: #f85149; font-size: 11px; }
  .row .empty { color: #8b949e; font-size: 12px; font-style: italic; }

  .btn {
    padding: 6px 12px; border: 1px solid #2f3846; border-radius: 6px;
    background: #171c24; color: #e6edf3; font-size: 12px; cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover { background: #1e242e; border-color: #4f9cf9; }
  .btn.danger:hover { border-color: #f85149; color: #f85149; }

  select {
    padding: 5px 8px; border: 1px solid #2f3846; border-radius: 6px;
    background: #0d1117; color: #e6edf3; font-size: 12px;
  }

  .warning {
    padding: 10px 12px; margin-bottom: 12px;
    border: 1px solid #d29922; border-radius: 6px;
    background: rgba(210,153,34,.1); color: #e3b341; font-size: 12px; line-height: 1.5;
  }
  .warning.error { border-color: #f85149; background: rgba(248,81,73,.1); color: #f85149; }
  .warning .btn { display: block; margin-top: 10px; }

  .plan { width: 100%; border-collapse: collapse; font-size: 12px; }
  .plan th, .plan td { padding: 7px 8px; text-align: left; border-bottom: 1px solid #1e242e; }
  .plan th { color: #8b949e; font-weight: 500; }
  .plan .status-new { color: #3fb950; }
  .plan .status-conflict { color: #d29922; }
`;

export interface TriggerCallbacks {
  onRun(account: AccountConfig): void;
  onOpenPanel(): void;
}

export interface PanelCallbacks {
  onRenameAccount(account: AccountConfig): void;
  onDeleteAccount(account: AccountConfig): void;
  onToggleAutoSubmit(account: AccountConfig): void;
  onAddStep(account: AccountConfig): void;
  onClearSteps(account: AccountConfig): void;
  onNewAccount(): void;
  onExport(): Promise<string>;
  onImport(shareString: string): Promise<void>;
  onDiscardUnreadableConfig(): void;
}

export interface ReadOnlyState {
  active: boolean;
  reason: string | null;
}

export class Ui {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly layer: HTMLDivElement;
  /** Resolver of a modal currently awaiting an answer, so `clear()` can settle it. */
  private settlePending: ((value: MergePlanEntry[] | null) => void) | null = null;

  constructor(private readonly callbacks: TriggerCallbacks) {
    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    // Above anything the host page can reasonably claim, and zero-sized so it
    // never intercepts a click meant for the page underneath.
    this.host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';

    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    this.root.appendChild(style);

    this.layer = document.createElement('div');
    this.root.appendChild(this.layer);
  }

  mount(): void {
    if (!this.host.isConnected) document.body.appendChild(this.host);
  }

  /**
   * Detach the host entirely. `clear()` empties the layer but leaves the host
   * in the document; navigating an SPA onto a page this script has nothing to
   * do with should leave no trace of it at all.
   */
  unmount(): void {
    this.clear();
    this.host.remove();
  }

  clear(): void {
    // Settle anything awaiting a dialog we are about to destroy. Without this
    // an open import preview leaves its caller awaiting a promise whose only
    // resolvers were listeners on the removed backdrop.
    this.settlePending?.(null);
    this.settlePending = null;
    this.layer.replaceChildren();
  }

  toast(message: string, kind: 'info' | 'warn' | 'error' = 'info', ms = 6000): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  /**
   * The trigger button for the accounts that apply to this page. One match runs
   * directly; several open a chooser. Right-click opens the panel, which is the
   * only way in on a page where the menu command is inconvenient.
   *
   * `blockedReason` marks an account whose automatic runs have been suppressed
   * by the lockout guard — the button still works, because a human choosing to
   * retry is not the failure mode being guarded against.
   */
  renderTrigger(matches: AccountConfig[], blockedReason?: string): void {
    const button = document.createElement('button');
    button.className = blockedReason ? 'trigger blocked' : 'trigger';
    button.textContent = matches.length === 1 ? `Log in — ${matches[0].name}` : `Log in (${matches.length})`;
    button.title = blockedReason ?? 'Click to log in · right-click to manage accounts';

    button.addEventListener('click', () => {
      if (matches.length === 1) {
        this.callbacks.onRun(matches[0]);
        return;
      }
      this.renderChooser(matches);
    });

    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.callbacks.onOpenPanel();
    });

    this.layer.appendChild(button);
  }

  private renderChooser(matches: AccountConfig[]): void {
    this.layer.querySelector('.chooser')?.remove();

    const list = document.createElement('div');
    list.className = 'chooser';

    for (const account of matches) {
      const item = document.createElement('button');
      item.textContent = account.name;
      item.addEventListener('click', () => {
        list.remove();
        this.callbacks.onRun(account);
      });
      list.appendChild(item);
    }

    this.layer.appendChild(list);
  }

  /**
   * The management panel. `invalidIds` are accounts carrying a step whose page
   * pattern failed to compile — flagged inline, because such an account can
   * never match anything and would otherwise just appear to do nothing.
   */
  renderPanel(
    accounts: AccountConfig[],
    invalidIds: Set<string>,
    readOnly: ReadOnlyState,
    cb: PanelCallbacks,
  ): void {
    // One panel at a time — opening a second stacks a full-screen backdrop over
    // a stale copy of the first.
    this.layer.querySelector('.backdrop')?.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) backdrop.remove();
    });

    const panel = document.createElement('div');
    panel.className = 'panel';

    const header = document.createElement('header');
    header.textContent = 'Auto Login';
    const close = document.createElement('button');
    close.className = 'btn';
    close.textContent = 'Close';
    close.addEventListener('click', () => backdrop.remove());
    header.appendChild(close);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'body';

    const warning = document.createElement('div');
    warning.className = 'warning';
    warning.textContent =
      'Credentials are stored unencrypted in your browser. Use this for development and test accounts only.';
    body.appendChild(warning);

    if (readOnly.active) {
      body.appendChild(this.buildReadOnlyBanner(readOnly, cb));
    }

    const heading = document.createElement('h3');
    heading.textContent = `Accounts (${accounts.length})`;
    body.appendChild(heading);

    for (const account of [...accounts].sort((a, b) => a.name.localeCompare(b.name))) {
      body.appendChild(this.buildAccountRow(account, invalidIds.has(account.id), cb));
    }

    body.appendChild(this.buildPanelActions(cb));
    panel.appendChild(body);
    backdrop.appendChild(panel);
    this.layer.appendChild(backdrop);
  }

  private buildReadOnlyBanner(readOnly: ReadOnlyState, cb: PanelCallbacks): HTMLElement {
    const banner = document.createElement('div');
    banner.className = 'warning error';
    banner.textContent =
      `${readOnly.reason ?? 'Your saved config could not be read.'} ` +
      'Changes cannot be saved until this is resolved. Your existing data has been left untouched.';

    const discard = document.createElement('button');
    discard.className = 'btn danger';
    discard.textContent = 'Discard unreadable config and start fresh';
    discard.addEventListener('click', () => {
      if (confirm('Permanently discard the unreadable config and start with no accounts?')) {
        cb.onDiscardUnreadableConfig();
      }
    });

    banner.appendChild(discard);
    return banner;
  }

  private buildAccountRow(
    account: AccountConfig,
    invalid: boolean,
    cb: PanelCallbacks,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = account.name;

    if (account.steps.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No steps yet — use Add step on the page you want to log in to.';
      name.appendChild(empty);
    } else {
      const meta = document.createElement('div');
      meta.className = 'meta';
      const pages = [...new Set(account.steps.map((s) => s.pagePattern))];
      meta.textContent = `${account.steps.length} step${account.steps.length === 1 ? '' : 's'} · ${pages.join(' , ')}`;
      name.appendChild(meta);
    }

    if (invalid) {
      const flag = document.createElement('div');
      flag.className = 'invalid';
      flag.textContent = 'Invalid page pattern — this account will never match.';
      name.appendChild(flag);
    }

    const autoSubmit = document.createElement('button');
    autoSubmit.className = 'btn';
    autoSubmit.textContent = account.autoSubmit ? 'Auto-submit: on' : 'Auto-submit: off';
    autoSubmit.addEventListener('click', () => cb.onToggleAutoSubmit(account));

    const addStep = document.createElement('button');
    addStep.className = 'btn';
    addStep.textContent = 'Add step';
    addStep.addEventListener('click', () => cb.onAddStep(account));

    const rename = document.createElement('button');
    rename.className = 'btn';
    rename.textContent = 'Rename';
    rename.addEventListener('click', () => cb.onRenameAccount(account));

    const clear = document.createElement('button');
    clear.className = 'btn danger';
    clear.textContent = 'Clear steps';
    clear.addEventListener('click', () => {
      if (confirm(`Remove all ${account.steps.length} step(s) from "${account.name}"?`)) {
        cb.onClearSteps(account);
      }
    });

    const remove = document.createElement('button');
    remove.className = 'btn danger';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      if (confirm(`Delete "${account.name}"?`)) cb.onDeleteAccount(account);
    });

    row.append(name, autoSubmit, addStep, rename, clear, remove);
    return row;
  }

  private buildPanelActions(cb: PanelCallbacks): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'row';

    const add = document.createElement('button');
    add.className = 'btn';
    add.textContent = 'New account';
    add.addEventListener('click', () => cb.onNewAccount());

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn';
    exportBtn.textContent = 'Export share string';
    exportBtn.addEventListener('click', () => {
      const confirmed = confirm(
        'This share string contains your saved passwords in a fully recoverable form.\n\n' +
          'Anyone you send it to can read them. Do not paste it into tickets, chat channels or gists.\n\n' +
          'Copy it anyway?',
      );
      if (!confirmed) return;

      void cb
        .onExport()
        .then((text) => navigator.clipboard.writeText(text))
        .then(() =>
          this.toast('Share string copied. It contains credentials — send it carefully.', 'warn', 9000),
        )
        .catch(() => this.toast('Could not copy the share string to the clipboard.', 'error'));
    });

    const importBtn = document.createElement('button');
    importBtn.className = 'btn';
    importBtn.textContent = 'Import share string';
    importBtn.addEventListener('click', () => {
      const text = prompt('Paste the share string:');
      if (text) void cb.onImport(text);
    });

    actions.append(add, exportBtn, importBtn);
    return actions;
  }

  /**
   * Show what an import would do and let the user decide per row. Resolves with
   * the confirmed plan, or null if cancelled. Nothing is written until this
   * resolves — decoding never mutates the store.
   */
  renderImportPreview(plan: MergePlanEntry[]): Promise<MergePlanEntry[] | null> {
    return new Promise((resolve) => {
      const settle = (value: MergePlanEntry[] | null): void => {
        this.settlePending = null;
        resolve(value);
      };
      this.settlePending = settle;

      this.layer.querySelector('.backdrop')?.remove();

      const backdrop = document.createElement('div');
      backdrop.className = 'backdrop';

      const panel = document.createElement('div');
      panel.className = 'panel';

      const header = document.createElement('header');
      header.textContent = `Import ${plan.length} account${plan.length === 1 ? '' : 's'}`;
      panel.appendChild(header);

      const body = document.createElement('div');
      body.className = 'body';

      const table = document.createElement('table');
      table.className = 'plan';

      const head = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const label of ['Incoming', 'Status', 'Replaces', 'Action']) {
        const th = document.createElement('th');
        th.textContent = label;
        headRow.appendChild(th);
      }
      head.appendChild(headRow);
      table.appendChild(head);

      const tbody = document.createElement('tbody');
      for (const entry of plan) {
        tbody.appendChild(this.buildPlanRow(entry));
      }
      table.appendChild(tbody);
      body.appendChild(table);

      const actions = document.createElement('div');
      actions.className = 'row';

      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        backdrop.remove();
        settle(null);
      });

      const apply = document.createElement('button');
      apply.className = 'btn';
      apply.textContent = 'Apply';
      apply.addEventListener('click', () => {
        backdrop.remove();
        settle(plan);
      });

      actions.append(cancel, apply);
      body.appendChild(actions);

      panel.appendChild(body);
      backdrop.appendChild(panel);
      this.layer.appendChild(backdrop);
    });
  }

  private buildPlanRow(entry: MergePlanEntry): HTMLElement {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.textContent = entry.incoming.name;

    const status = document.createElement('td');
    status.className = entry.status === 'new' ? 'status-new' : 'status-conflict';
    status.textContent =
      entry.status === 'new' ? 'New' : entry.status === 'conflict-id' ? 'Same account' : 'Same name';

    const replaces = document.createElement('td');
    replaces.textContent = entry.existing ? entry.existing.name : '—';

    const action = document.createElement('td');
    const select = document.createElement('select');
    const options: Array<[MergeAction, string]> = [
      ['skip', 'Skip'],
      ['overwrite', 'Overwrite'],
      ['keep-both', 'Keep both'],
    ];

    for (const [value, label] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = entry.action === value;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      entry.action = select.value as MergeAction;
    });
    action.appendChild(select);

    tr.append(name, status, replaces, action);
    return tr;
  }
}
