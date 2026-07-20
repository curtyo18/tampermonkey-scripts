// ==UserScript==
// @name         Auto Login
// @namespace    https://github.com/curtyo18/tampermonkey-scripts
// @version      0.1.0
// @description  One-click credential fill for login pages you configure through an injected UI. Dev/test accounts only.
// @author       Curt Radford
// @match        *://*/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/auto-login/auto-login.user.js
// @downloadURL  https://raw.githubusercontent.com/curtyo18/tampermonkey-scripts/master/auto-login/auto-login.user.js
// ==/UserScript==
"use strict";
(() => {
  // src/match.ts
  var REGEX_FORM = /^\/(.*)\/([a-z]*)$/;
  function escapeLiteral(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function compilePattern(pattern) {
    const asRegex = REGEX_FORM.exec(pattern);
    if (asRegex) {
      const [, body2, flags] = asRegex;
      if (body2 === "") return null;
      try {
        return new RegExp(body2, flags);
      } catch {
        return null;
      }
    }
    const body = escapeLiteral(pattern).replace(/\\\*/g, ".*").replace(/\\\?/g, ".");
    try {
      return new RegExp(`^${body}$`);
    } catch {
      return null;
    }
  }
  function matchesPattern(pattern, url) {
    const re = compilePattern(pattern);
    return re ? re.test(url) : false;
  }

  // src/selector.ts
  var TEST_ATTRS = ["data-testid", "data-test", "data-qa", "data-cy"];
  var UNIQUE_TYPE_HINTS = ["password", "email"];
  function isUnstableId(id) {
    if (id === "") return true;
    if (/^:[a-z0-9]+:$/i.test(id)) return true;
    if (/(^|[-_])[a-f0-9]{8,}($|[-_])/i.test(id)) return true;
    if (/\d{4,}/.test(id)) return true;
    return false;
  }
  function escapeAttributeValue(value) {
    return value.replace(/["\\]/g, "\\$&");
  }
  function isUniqueId(id, doc) {
    try {
      return doc.querySelectorAll(`#${CSS.escape(id)}`).length === 1;
    } catch {
      return false;
    }
  }
  function structuralPath(el, doc) {
    if (el === doc.documentElement) return "html";
    const parts = [];
    let node = el;
    while (node && node !== doc.documentElement) {
      if (node.id && !isUnstableId(node.id) && isUniqueId(node.id, doc)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(node.tagName.toLowerCase());
        break;
      }
      const current = node;
      const tag = current.tagName.toLowerCase();
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(current) + 1})` : tag);
      node = parent;
    }
    return parts.join(" > ");
  }
  function measure(selector, label, el, doc) {
    let matches;
    try {
      matches = doc.querySelectorAll(selector);
    } catch {
      return null;
    }
    return {
      selector,
      label,
      matchCount: matches.length,
      resolvesToPicked: matches[0] === el
    };
  }
  function generateCandidates(el, doc) {
    const proposed = [];
    const tag = el.tagName.toLowerCase();
    if (el.id && !isUnstableId(el.id)) {
      proposed.push({ selector: `#${CSS.escape(el.id)}`, label: "id" });
    }
    const name = el.getAttribute("name");
    if (name) {
      proposed.push({
        selector: `${tag}[name="${escapeAttributeValue(name)}"]`,
        label: "name attribute"
      });
    }
    for (const attr of TEST_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) {
        proposed.push({
          selector: `[${attr}="${escapeAttributeValue(value)}"]`,
          label: `${attr} attribute`
        });
      }
    }
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) {
      proposed.push({
        selector: `[aria-label="${escapeAttributeValue(ariaLabel)}"]`,
        label: "aria-label"
      });
    }
    const type = el.getAttribute("type");
    if (type && UNIQUE_TYPE_HINTS.includes(type)) {
      const selector = `${tag}[type="${type}"]`;
      if (doc.querySelectorAll(selector).length === 1) {
        proposed.push({ selector, label: `only ${type} field on the page` });
      }
    }
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) {
      proposed.push({
        selector: `[placeholder="${escapeAttributeValue(placeholder)}"]`,
        label: "placeholder"
      });
    }
    proposed.push({ selector: structuralPath(el, doc), label: "structural path" });
    const seen = /* @__PURE__ */ new Set();
    const measured = [];
    for (const candidate of proposed) {
      if (seen.has(candidate.selector)) continue;
      seen.add(candidate.selector);
      const result = measure(candidate.selector, candidate.label, el, doc);
      if (result) measured.push(result);
    }
    const exact = measured.filter((c) => c.resolvesToPicked && c.matchCount === 1);
    const rest = measured.filter((c) => !(c.resolvesToPicked && c.matchCount === 1));
    return [...exact, ...rest];
  }

  // src/picker.ts
  var HIGHLIGHT_ID = "auto-login-picker-highlight";
  function pickElement(host) {
    return new Promise((resolve) => {
      const highlight = document.createElement("div");
      highlight.id = HIGHLIGHT_ID;
      Object.assign(highlight.style, {
        position: "fixed",
        pointerEvents: "none",
        zIndex: "2147483646",
        border: "2px solid #4f9cf9",
        background: "rgba(79, 156, 249, 0.15)",
        borderRadius: "2px",
        transition: "all 60ms ease-out"
      });
      document.body.appendChild(highlight);
      const previousCursor = document.documentElement.style.cursor;
      document.documentElement.style.cursor = "crosshair";
      function target(event) {
        const el = event.target;
        if (!el || el === host || host.contains(el) || el === highlight) return null;
        return el;
      }
      function onMove(event) {
        const el = target(event);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        Object.assign(highlight.style, {
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`
        });
      }
      function finish(result) {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKey, true);
        document.documentElement.style.cursor = previousCursor;
        highlight.remove();
        resolve(result);
      }
      function onClick(event) {
        const el = target(event);
        if (!el) return;
        event.preventDefault();
        event.stopPropagation();
        let candidates = [];
        try {
          candidates = generateCandidates(el, document);
        } catch {
          finish(null);
          return;
        }
        finish({ element: el, candidates });
      }
      function onKey(event) {
        if (event.key !== "Escape") return;
        event.preventDefault();
        finish(null);
      }
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
    });
  }

  // src/types.ts
  var STORE_KEY = "autoLogin.store.v1";
  var SCHEMA_VERSION = 1;
  var WAIT_TIMEOUT_MS = 8e3;
  var ATTEMPTS_WINDOW_MS = 12e4;
  var MAX_SUBMIT_ATTEMPTS = 3;
  function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // src/steps.ts
  function appendStep(store, accountId, step) {
    return {
      ...store,
      accounts: store.accounts.map((account) => {
        if (account.id !== accountId) return account;
        const existing = step.isSubmit ? account.steps.map((s) => s.isSubmit ? { ...s, isSubmit: false } : s) : account.steps;
        return {
          ...account,
          steps: [...existing, { ...step, id: newId() }],
          updatedAt: Date.now()
        };
      })
    };
  }

  // src/runner.ts
  function isFresh(run, accountId, now) {
    return !!run && run.accountId === accountId && now - run.updatedAt <= ATTEMPTS_WINDOW_MS;
  }
  function isAutoRunBlocked(run, accountId, now = Date.now()) {
    return isFresh(run, accountId, now) && run.attempts >= MAX_SUBMIT_ATTEMPTS;
  }
  function seedAttempts(run, accountId, manual, now = Date.now()) {
    if (manual) return 0;
    return isFresh(run, accountId, now) ? run.attempts : 0;
  }
  function stepsForPage(account, url) {
    const start = account.steps.findIndex((step) => matchesPattern(step.pagePattern, url));
    if (start === -1) return [];
    const group = [];
    for (let i = start; i < account.steps.length; i++) {
      if (!matchesPattern(account.steps[i].pagePattern, url)) break;
      group.push(account.steps[i]);
    }
    return group;
  }
  function accountMatchesPage(account, url) {
    return account.steps.some((step) => matchesPattern(step.pagePattern, url));
  }
  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function waitForElement(selector, doc, timeoutMs) {
    let existing;
    try {
      existing = doc.querySelector(selector);
    } catch {
      return Promise.resolve(null);
    }
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const found = doc.querySelector(selector);
        if (!found) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve(found);
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
      observer.observe(doc.documentElement, { childList: true, subtree: true });
    });
  }
  function isTextField(el) {
    const tag = el.tagName.toLowerCase();
    return (tag === "input" || tag === "textarea") && "value" in el;
  }
  async function runSteps(steps, autoSubmit, doc) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const where = `Step ${i + 1} (${step.kind})`;
      if (step.isSubmit && !autoSubmit) {
        return { outcome: "halted-before-submit", stepIndex: i, submitted: false };
      }
      try {
        if (step.kind === "waitFor") {
          const found = await waitForElement(step.selector, doc, step.timeoutMs ?? WAIT_TIMEOUT_MS);
          if (!found) {
            return {
              outcome: "failed",
              stepIndex: i,
              message: `${where}: timed out waiting for ${step.selector}`,
              submitted: false
            };
          }
          continue;
        }
        const el = doc.querySelector(step.selector);
        if (!el) {
          return {
            outcome: "failed",
            stepIndex: i,
            message: `${where}: nothing matched ${step.selector}`,
            submitted: false
          };
        }
        if (step.kind === "fill") {
          if (!isTextField(el)) {
            return {
              outcome: "failed",
              stepIndex: i,
              message: `${where}: ${step.selector} is not a text field`,
              submitted: false
            };
          }
          if (step.value === void 0) {
            return {
              outcome: "failed",
              stepIndex: i,
              message: `${where}: no value configured for ${step.selector}`,
              submitted: false
            };
          }
          setNativeValue(el, step.value);
          continue;
        }
        const clickable = el;
        if (typeof clickable.click !== "function") {
          return {
            outcome: "failed",
            stepIndex: i,
            message: `${where}: ${step.selector} is not clickable`,
            submitted: false
          };
        }
        clickable.click();
        if (step.isSubmit) {
          return { outcome: "completed", stepIndex: i + 1, submitted: true };
        }
      } catch (error) {
        return {
          outcome: "failed",
          stepIndex: i,
          message: `${where}: ${step.selector} \u2014 ${error.message}`,
          submitted: false
        };
      }
    }
    return { outcome: "completed", stepIndex: steps.length, submitted: false };
  }

  // src/storage.ts
  var STEP_KINDS = ["fill", "click", "waitFor"];
  function emptyStore() {
    return { schemaVersion: SCHEMA_VERSION, accounts: [], run: null };
  }
  function serialiseStore(store) {
    return JSON.stringify(store);
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function isStep(value) {
    if (!isRecord(value)) return false;
    return typeof value.id === "string" && typeof value.selector === "string" && typeof value.pagePattern === "string" && STEP_KINDS.includes(value.kind);
  }
  function isAccount(value) {
    if (!isRecord(value)) return false;
    return typeof value.id === "string" && typeof value.name === "string" && typeof value.autoSubmit === "boolean" && Array.isArray(value.steps) && value.steps.every(isStep);
  }
  function isRunState(value) {
    return isRecord(value) && typeof value.accountId === "string" && Number.isInteger(value.attempts) && typeof value.updatedAt === "number";
  }
  function corrupt() {
    return {
      store: emptyStore(),
      readOnly: true,
      error: "Saved config could not be read and has been left untouched."
    };
  }
  function newerVersion() {
    return {
      store: emptyStore(),
      readOnly: true,
      error: "Config was written by a newer version of Auto Login and will not be modified."
    };
  }
  function parseStore(raw) {
    if (raw === void 0 || raw === "") {
      return { store: emptyStore(), readOnly: false, error: null };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return corrupt();
    }
    if (!isRecord(parsed)) return corrupt();
    if (typeof parsed.schemaVersion !== "number") return corrupt();
    if (parsed.schemaVersion > SCHEMA_VERSION) return newerVersion();
    if (parsed.accounts !== void 0 && !Array.isArray(parsed.accounts)) return corrupt();
    return {
      store: {
        schemaVersion: SCHEMA_VERSION,
        accounts: (parsed.accounts ?? []).filter(isAccount),
        // A bad run state is transient, not user data worth preserving — drop
        // it rather than locking the whole store read-only.
        run: isRunState(parsed.run) ? parsed.run : null
      },
      readOnly: false,
      error: null
    };
  }
  function createStorage() {
    const adapter = {
      readOnly: false,
      lastError: null,
      async load() {
        const result = parseStore(GM_getValue(STORE_KEY));
        adapter.readOnly = result.readOnly;
        adapter.lastError = result.error;
        return result.store;
      },
      async save(store) {
        if (adapter.readOnly) {
          return { written: false, reason: adapter.lastError ?? "Config is read-only." };
        }
        try {
          GM_setValue(STORE_KEY, serialiseStore(store));
        } catch (error) {
          return { written: false, reason: `Changes could not be saved: ${error.message}` };
        }
        return { written: true };
      },
      /**
       * Clears the read-only flag on purpose. Reached only from the panel's
       * "discard unreadable config" action, after the user has been shown what
       * is wrong — without it, a corrupt store is an inescapable dead end.
       */
      async reset(store) {
        adapter.readOnly = false;
        adapter.lastError = null;
        GM_setValue(STORE_KEY, serialiseStore(store));
        return { written: true };
      },
      subscribe(onRemoteChange) {
        GM_addValueChangeListener(STORE_KEY, (_key, _old, newValue, remote) => {
          if (!remote) return;
          const result = parseStore(newValue);
          adapter.readOnly = result.readOnly;
          adapter.lastError = result.error;
          if (result.readOnly) return;
          onRemoteChange(result.store);
        });
      }
    };
    return adapter;
  }

  // src/share.ts
  var SHARE_PREFIX = "AL1:";
  var SHARE_PREFIX_RAW = "AL1U:";
  function toBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromBase64Url(text) {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - padded.length % 4) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }
  function toStream(bytes) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    });
  }
  async function collect(stream) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
  async function deflate(bytes) {
    return collect(toStream(bytes).pipeThrough(new CompressionStream("deflate-raw")));
  }
  async function inflate(bytes) {
    return collect(toStream(bytes).pipeThrough(new DecompressionStream("deflate-raw")));
  }
  async function encodeShare(accounts) {
    const json = new TextEncoder().encode(JSON.stringify(accounts));
    if (typeof CompressionStream === "undefined") {
      return SHARE_PREFIX_RAW + toBase64Url(json);
    }
    return SHARE_PREFIX + toBase64Url(await deflate(json));
  }
  async function decodeShare(text) {
    const trimmed = text.trim();
    const compressed = trimmed.startsWith(SHARE_PREFIX);
    const raw = trimmed.startsWith(SHARE_PREFIX_RAW);
    if (!compressed && !raw) {
      throw new Error("That is not an Auto Login share string.");
    }
    try {
      const body = trimmed.slice((raw ? SHARE_PREFIX_RAW : SHARE_PREFIX).length);
      const bytes = fromBase64Url(body);
      const json = new TextDecoder().decode(raw ? bytes : await inflate(bytes));
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      if (!parsed.every(isAccount)) throw new Error("malformed account");
      return parsed;
    } catch {
      throw new Error("That share string could not be decoded \u2014 it may be truncated or malformed.");
    }
  }
  function buildMergePlan(incoming, existing) {
    return incoming.map((account) => {
      const byId = existing.find((e) => e.id === account.id);
      if (byId) return { incoming: account, status: "conflict-id", existing: byId, action: "keep-both" };
      const byName = existing.find((e) => e.name === account.name);
      if (byName) return { incoming: account, status: "conflict-name", existing: byName, action: "keep-both" };
      return { incoming: account, status: "new", existing: null, action: "overwrite" };
    });
  }
  function applyMergePlan(plan, existing) {
    const result = [...existing];
    for (const entry of plan) {
      if (entry.action === "skip") continue;
      if (entry.action === "keep-both") {
        result.push({
          ...entry.incoming,
          id: newId(),
          name: `${entry.incoming.name} (imported)`,
          updatedAt: Date.now()
        });
        continue;
      }
      const index = entry.existing ? result.findIndex((a) => a.id === entry.existing.id) : -1;
      if (index >= 0) result[index] = { ...entry.incoming, updatedAt: Date.now() };
      else result.push(entry.incoming);
    }
    return result;
  }

  // src/ui.ts
  var HOST_ID = "auto-login-host";
  var STYLES = `
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
  var Ui = class {
    constructor(callbacks) {
      this.callbacks = callbacks;
      /** Resolver of a modal currently awaiting an answer, so `clear()` can settle it. */
      this.settlePending = null;
      this.host = document.createElement("div");
      this.host.id = HOST_ID;
      this.host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
      this.root = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = STYLES;
      this.root.appendChild(style);
      this.layer = document.createElement("div");
      this.root.appendChild(this.layer);
    }
    mount() {
      if (!this.host.isConnected) document.body.appendChild(this.host);
    }
    clear() {
      this.settlePending?.(null);
      this.settlePending = null;
      this.layer.replaceChildren();
    }
    toast(message, kind = "info", ms = 6e3) {
      const el = document.createElement("div");
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
    renderTrigger(matches, blockedReason) {
      const button = document.createElement("button");
      button.className = blockedReason ? "trigger blocked" : "trigger";
      button.textContent = matches.length === 1 ? `Log in \u2014 ${matches[0].name}` : `Log in (${matches.length})`;
      button.title = blockedReason ?? "Click to log in \xB7 right-click to manage accounts";
      button.addEventListener("click", () => {
        if (matches.length === 1) {
          this.callbacks.onRun(matches[0]);
          return;
        }
        this.renderChooser(matches);
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.callbacks.onOpenPanel();
      });
      this.layer.appendChild(button);
    }
    renderChooser(matches) {
      this.layer.querySelector(".chooser")?.remove();
      const list = document.createElement("div");
      list.className = "chooser";
      for (const account of matches) {
        const item = document.createElement("button");
        item.textContent = account.name;
        item.addEventListener("click", () => {
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
    renderPanel(accounts, invalidIds, readOnly, cb) {
      this.layer.querySelector(".backdrop")?.remove();
      const backdrop = document.createElement("div");
      backdrop.className = "backdrop";
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) backdrop.remove();
      });
      const panel = document.createElement("div");
      panel.className = "panel";
      const header = document.createElement("header");
      header.textContent = "Auto Login";
      const close = document.createElement("button");
      close.className = "btn";
      close.textContent = "Close";
      close.addEventListener("click", () => backdrop.remove());
      header.appendChild(close);
      panel.appendChild(header);
      const body = document.createElement("div");
      body.className = "body";
      const warning = document.createElement("div");
      warning.className = "warning";
      warning.textContent = "Credentials are stored unencrypted in your browser. Use this for development and test accounts only.";
      body.appendChild(warning);
      if (readOnly.active) {
        body.appendChild(this.buildReadOnlyBanner(readOnly, cb));
      }
      const heading = document.createElement("h3");
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
    buildReadOnlyBanner(readOnly, cb) {
      const banner = document.createElement("div");
      banner.className = "warning error";
      banner.textContent = `${readOnly.reason ?? "Your saved config could not be read."} Changes cannot be saved until this is resolved. Your existing data has been left untouched.`;
      const discard = document.createElement("button");
      discard.className = "btn danger";
      discard.textContent = "Discard unreadable config and start fresh";
      discard.addEventListener("click", () => {
        if (confirm("Permanently discard the unreadable config and start with no accounts?")) {
          cb.onDiscardUnreadableConfig();
        }
      });
      banner.appendChild(discard);
      return banner;
    }
    buildAccountRow(account, invalid, cb) {
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = account.name;
      if (account.steps.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No steps yet \u2014 use Add step on the page you want to log in to.";
        name.appendChild(empty);
      } else {
        const meta = document.createElement("div");
        meta.className = "meta";
        const pages = [...new Set(account.steps.map((s) => s.pagePattern))];
        meta.textContent = `${account.steps.length} step${account.steps.length === 1 ? "" : "s"} \xB7 ${pages.join(" , ")}`;
        name.appendChild(meta);
      }
      if (invalid) {
        const flag = document.createElement("div");
        flag.className = "invalid";
        flag.textContent = "Invalid page pattern \u2014 this account will never match.";
        name.appendChild(flag);
      }
      const autoSubmit = document.createElement("button");
      autoSubmit.className = "btn";
      autoSubmit.textContent = account.autoSubmit ? "Auto-submit: on" : "Auto-submit: off";
      autoSubmit.addEventListener("click", () => cb.onToggleAutoSubmit(account));
      const addStep = document.createElement("button");
      addStep.className = "btn";
      addStep.textContent = "Add step";
      addStep.addEventListener("click", () => cb.onAddStep(account));
      const rename = document.createElement("button");
      rename.className = "btn";
      rename.textContent = "Rename";
      rename.addEventListener("click", () => cb.onRenameAccount(account));
      const clear = document.createElement("button");
      clear.className = "btn danger";
      clear.textContent = "Clear steps";
      clear.addEventListener("click", () => {
        if (confirm(`Remove all ${account.steps.length} step(s) from "${account.name}"?`)) {
          cb.onClearSteps(account);
        }
      });
      const remove = document.createElement("button");
      remove.className = "btn danger";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => {
        if (confirm(`Delete "${account.name}"?`)) cb.onDeleteAccount(account);
      });
      row.append(name, autoSubmit, addStep, rename, clear, remove);
      return row;
    }
    buildPanelActions(cb) {
      const actions = document.createElement("div");
      actions.className = "row";
      const add = document.createElement("button");
      add.className = "btn";
      add.textContent = "New account";
      add.addEventListener("click", () => cb.onNewAccount());
      const exportBtn = document.createElement("button");
      exportBtn.className = "btn";
      exportBtn.textContent = "Export share string";
      exportBtn.addEventListener("click", () => {
        const confirmed = confirm(
          "This share string contains your saved passwords in a fully recoverable form.\n\nAnyone you send it to can read them. Do not paste it into tickets, chat channels or gists.\n\nCopy it anyway?"
        );
        if (!confirmed) return;
        void cb.onExport().then((text) => navigator.clipboard.writeText(text)).then(
          () => this.toast("Share string copied. It contains credentials \u2014 send it carefully.", "warn", 9e3)
        ).catch(() => this.toast("Could not copy the share string to the clipboard.", "error"));
      });
      const importBtn = document.createElement("button");
      importBtn.className = "btn";
      importBtn.textContent = "Import share string";
      importBtn.addEventListener("click", () => {
        const text = prompt("Paste the share string:");
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
    renderImportPreview(plan) {
      return new Promise((resolve) => {
        const settle = (value) => {
          this.settlePending = null;
          resolve(value);
        };
        this.settlePending = settle;
        this.layer.querySelector(".backdrop")?.remove();
        const backdrop = document.createElement("div");
        backdrop.className = "backdrop";
        const panel = document.createElement("div");
        panel.className = "panel";
        const header = document.createElement("header");
        header.textContent = `Import ${plan.length} account${plan.length === 1 ? "" : "s"}`;
        panel.appendChild(header);
        const body = document.createElement("div");
        body.className = "body";
        const table = document.createElement("table");
        table.className = "plan";
        const head = document.createElement("thead");
        const headRow = document.createElement("tr");
        for (const label of ["Incoming", "Status", "Replaces", "Action"]) {
          const th = document.createElement("th");
          th.textContent = label;
          headRow.appendChild(th);
        }
        head.appendChild(headRow);
        table.appendChild(head);
        const tbody = document.createElement("tbody");
        for (const entry of plan) {
          tbody.appendChild(this.buildPlanRow(entry));
        }
        table.appendChild(tbody);
        body.appendChild(table);
        const actions = document.createElement("div");
        actions.className = "row";
        const cancel = document.createElement("button");
        cancel.className = "btn";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => {
          backdrop.remove();
          settle(null);
        });
        const apply = document.createElement("button");
        apply.className = "btn";
        apply.textContent = "Apply";
        apply.addEventListener("click", () => {
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
    buildPlanRow(entry) {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = entry.incoming.name;
      const status = document.createElement("td");
      status.className = entry.status === "new" ? "status-new" : "status-conflict";
      status.textContent = entry.status === "new" ? "New" : entry.status === "conflict-id" ? "Same account" : "Same name";
      const replaces = document.createElement("td");
      replaces.textContent = entry.existing ? entry.existing.name : "\u2014";
      const action = document.createElement("td");
      const select = document.createElement("select");
      const options = [
        ["skip", "Skip"],
        ["overwrite", "Overwrite"],
        ["keep-both", "Keep both"]
      ];
      for (const [value, label] of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = entry.action === value;
        select.appendChild(option);
      }
      select.addEventListener("change", () => {
        entry.action = select.value;
      });
      action.appendChild(select);
      tr.append(name, status, replaces, action);
      return tr;
    }
  };

  // src/main.ts
  void (async function main() {
    const storage = createStorage();
    let store = await storage.load();
    const url = location.href;
    const matches = store.accounts.filter((account) => accountMatchesPage(account, url));
    const ui = new Ui({
      onRun: (account) => void run(account, { manual: true }),
      onOpenPanel: () => openPanel()
    });
    GM_registerMenuCommand("Auto Login: configure this page", () => {
      ui.mount();
      openPanel();
    });
    storage.subscribe((updated) => {
      store = updated;
    });
    if (matches.length === 0 && !storage.lastError) {
      if (store.run) void persist({ ...store, run: null });
      return;
    }
    ui.mount();
    if (storage.lastError) {
      ui.toast(storage.lastError, "error", 1e4);
      return;
    }
    const blocked = matches.length === 1 && isAutoRunBlocked(store.run, matches[0].id);
    if (matches.length === 1 && !blocked) {
      void run(matches[0], { manual: false });
    } else {
      ui.renderTrigger(
        matches,
        blocked ? `Automatic login paused after ${MAX_SUBMIT_ATTEMPTS} attempts \u2014 click to try again.` : void 0
      );
    }
    async function persist(next) {
      store = next;
      const result = await storage.save(next);
      if (!result.written) ui.toast(result.reason ?? "Changes could not be saved.", "error", 1e4);
    }
    async function run(account, opts) {
      ui.clear();
      const steps = stepsForPage(account, location.href);
      if (steps.length === 0) {
        ui.toast(`"${account.name}" has no steps recorded for this page.`, "warn");
        ui.renderTrigger([account]);
        return;
      }
      const attempts = seedAttempts(store.run, account.id, opts.manual);
      const report = await runSteps(steps, account.autoSubmit, document);
      if (report.submitted) {
        await persist({
          ...store,
          run: { accountId: account.id, attempts: attempts + 1, updatedAt: Date.now() }
        });
        return;
      }
      if (report.outcome === "failed") {
        ui.toast(report.message ?? "Login failed.", "error", 1e4);
        ui.renderTrigger([account]);
        return;
      }
      if (report.outcome === "halted-before-submit") {
        ui.toast("Fields filled \u2014 auto-submit is off for this account, so finish manually.", "warn");
        ui.renderTrigger([account]);
        return;
      }
      ui.renderTrigger([account]);
    }
    function invalidAccountIds() {
      return new Set(
        store.accounts.filter((account) => account.steps.some((s) => compilePattern(s.pagePattern) === null)).map((account) => account.id)
      );
    }
    function reopenPanel() {
      ui.clear();
      openPanel();
    }
    async function updateAccount(id, change) {
      await persist({
        ...store,
        accounts: store.accounts.map((a) => a.id === id ? { ...change(a), updatedAt: Date.now() } : a)
      });
      reopenPanel();
    }
    function openPanel() {
      ui.renderPanel(
        store.accounts,
        invalidAccountIds(),
        { active: storage.readOnly, reason: storage.lastError },
        {
          onDiscardUnreadableConfig: () => {
            void storage.reset(emptyStore()).then(async () => {
              store = await storage.load();
              ui.clear();
              ui.toast("Unreadable config discarded. Starting fresh.");
              openPanel();
            });
          },
          onNewAccount: () => {
            const name = prompt('Account name (e.g. "dev1 payments acc"):');
            if (!name) return;
            const account = {
              id: newId(),
              name,
              steps: [],
              autoSubmit: true,
              createdAt: Date.now(),
              updatedAt: Date.now()
            };
            void persist({ ...store, accounts: [...store.accounts, account] }).then(reopenPanel);
          },
          onRenameAccount: (account) => {
            const name = prompt("Account name:", account.name);
            if (name === null || name === "") return;
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
              accounts: store.accounts.filter((a) => a.id !== account.id)
            }).then(reopenPanel);
          },
          onAddStep: (account) => void addStepByPicking(account),
          onExport: () => encodeShare(store.accounts),
          onImport: async (text) => {
            let incoming;
            try {
              incoming = await decodeShare(text);
            } catch (error) {
              ui.toast(error.message, "error", 1e4);
              return;
            }
            const plan = buildMergePlan(incoming, store.accounts);
            const confirmed = await ui.renderImportPreview(plan);
            if (!confirmed) return;
            await persist({ ...store, accounts: applyMergePlan(confirmed, store.accounts) });
            ui.clear();
            ui.toast(`Imported ${confirmed.filter((e) => e.action !== "skip").length} account(s).`);
            openPanel();
          }
        }
      );
    }
    async function addStepByPicking(account) {
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
      const isTextField2 = picked.element instanceof HTMLInputElement || picked.element instanceof HTMLTextAreaElement;
      let step;
      if (isTextField2) {
        const value = prompt(`Value to type into ${selector}:`);
        if (value === null) {
          openPanel();
          return;
        }
        step = { kind: "fill", selector, pagePattern, value };
      } else {
        step = {
          kind: "click",
          selector,
          pagePattern,
          isSubmit: confirm("Is this the final submit button for this login?")
        };
      }
      await persist(appendStep(store, account.id, step));
      openPanel();
    }
    function chooseSelector(candidates) {
      const usable = candidates.filter((c) => c.resolvesToPicked && c.matchCount === 1);
      const pool = usable.length > 0 ? usable : candidates;
      const listed = pool.map((c, i) => `${i + 1}. ${c.selector}  (${c.label}, matches ${c.matchCount})`).join("\n");
      const warning = usable.length === 0 ? "\n\nWARNING: none of these uniquely identify the element you clicked.\n" : "";
      const choice = prompt(`Choose a selector:${warning}

${listed}

Enter a number, or type a selector:`);
      if (!choice) return null;
      const index = Number(choice) - 1;
      return Number.isInteger(index) && pool[index] ? pool[index].selector : choice;
    }
    function promptForPagePattern() {
      const suggested = `${location.origin}${location.pathname}*`;
      const pattern = prompt(
        "Which pages does this step belong to?\n\nGlob by default (* and ? are wildcards); wrap in slashes for a regex.",
        suggested
      );
      if (!pattern) return null;
      if (compilePattern(pattern) === null) {
        ui.toast("That pattern is not valid \u2014 the step was not added.", "error");
        return null;
      }
      return pattern;
    }
  })();
})();
