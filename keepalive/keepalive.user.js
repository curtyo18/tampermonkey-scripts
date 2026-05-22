// ==UserScript==
// @name         Keepalive
// @namespace    https://github.com/curtyo18/tampermonkey-scripts
// @version      1.0.4
// @description  Keeps any website session alive via event dispatch, fetch ping, and/or element click
// @author       Curt Radford
// @match        https://example.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.0.4';

  // ── CONFIG ──────────────────────────────────────────────────────────────────
  // This is the only block you need to edit.
  //
  // • Set enabled: false to disable a technique entirely.
  // • iframeId / selector / url of null means "not configured" — the technique
  //   will use a safe default or skip itself silently.
  // Object.freeze is shallow — nested objects remain mutable, but that's fine here.
  // The freeze signals intent: treat CONFIG as read-only in implementation code.
  const CONFIG = Object.freeze({

    // Fires synthetic DOM events to reset client-side inactivity timers.
    eventDispatch: {
      enabled: true,
      intervalMs: 10_000,
      iframeId: null,    // null = top window + body only
                         // set to an iframe's id attribute to also target that frame
    },

    // Periodically fetches a URL to keep the server-side session alive.
    fetchPing: {
      enabled: true,
      intervalMs: 120_000,   // aim for ≤50% of your server's session TTL
      url: null,             // null = window.location.href
                             // override with a known-safe endpoint if needed
    },

    // Periodically clicks a CSS-selected element.
    elementClick: {
      enabled: true,
      intervalMs: 30_000,
      selector: null,    // null = disabled; set to a CSS selector string to activate
    },

  });

  // ── ACTIVITY EVENTS ─────────────────────────────────────────────────────────
  const ACTIVITY_EVENTS = [
    'mousemove', 'keydown', 'wheel', 'DOMMouseScroll', 'mousewheel',
    'mousedown', 'touchstart', 'touchmove',
    'MSPointerDown', 'MSPointerMove',
    'visibilitychange', 'focus', 'click',
  ];

  // ── STATUS BADGE ────────────────────────────────────────────────────────────
  function createBadge() {
    const el = document.createElement('div');
    el.id = '__keepalive-badge__';
    Object.assign(el.style, {
      position:     'fixed',
      top:          '0',
      right:        '0',
      zIndex:       '2147483647',
      padding:      '2px 6px',
      background:   'rgba(0,0,0,0.65)',
      color:        '#0f0',
      fontFamily:   'monospace',
      fontSize:     '11px',
      pointerEvents: 'none',
    });
    el.textContent = `[Keepalive v${VERSION}] starting…`;
    document.body.appendChild(el);
    return el;
  }

  function updateBadge(badge, action) {
    badge.textContent = `[Keepalive v${VERSION}] ${action} @ ${new Date().toLocaleTimeString()}`;
  }

  // ── TECHNIQUE 1: EVENT DISPATCH ─────────────────────────────────────────────
  function runEventDispatch(cfg, badge) {
    if (!cfg.enabled) return;

    const targets = [window, document.body];

    if (cfg.iframeId) {
      try {
        const iframe = document.getElementById(cfg.iframeId);
        if (iframe) {
          targets.push(iframe.contentWindow);
          targets.push(iframe.contentDocument.body);
        }
      } catch (_) {
        // cross-origin or missing iframe — skip silently
      }
    }

    setInterval(() => {
      try {
        ACTIVITY_EVENTS.forEach(name => {
          targets.forEach(t => t?.dispatchEvent(new Event(name, { bubbles: true })));
        });
        updateBadge(badge, 'event dispatch');
      } catch (err) {
        console.error('[Keepalive] T1 error:', err);
      }
    }, cfg.intervalMs);
  }

  // ── TECHNIQUE 2: FETCH PING ──────────────────────────────────────────────────
  function runFetchPing(cfg, badge) {
    if (!cfg.enabled || typeof window.fetch !== 'function') return;

    const url = cfg.url ?? window.location.href;

    setInterval(() => {
      window.fetch(url)
        .then(() => updateBadge(badge, 'fetch ping'))
        .catch(err => console.error('[Keepalive] T2 error:', err));
    }, cfg.intervalMs);
  }

  // ── TECHNIQUE 3: ELEMENT CLICK ───────────────────────────────────────────────
  function runElementClick(cfg, badge) {
    if (!cfg.enabled || !cfg.selector) return;

    setInterval(() => {
      try {
        const el = document.querySelector(cfg.selector);
        if (el) {
          el.click();
          updateBadge(badge, 'element click');
        }
      } catch (err) {
        console.error('[Keepalive] T3 error:', err);
      }
    }, cfg.intervalMs);
  }

  // ── INIT ─────────────────────────────────────────────────────────────────────
  const badge = createBadge();
  runEventDispatch(CONFIG.eventDispatch, badge);
  runFetchPing(CONFIG.fetchPing, badge);
  runElementClick(CONFIG.elementClick, badge);

})();
