import { isJira, detectFlavor, getIssueKey, getBaseUrl } from './detect.js';
import { fetchIssue } from './api.js';
import { fromApi } from './extract.js';
import { fromDom } from './scrape.js';
import { toMarkdown } from './format.js';
import { createTrigger, showPanel } from './ui.js';
import type { TriggerHandle } from './ui.js';

if (isJira()) {
  const trigger: TriggerHandle = createTrigger(onExtract);

  async function onExtract(): Promise<void> {
    const key = getIssueKey();
    if (!key) return;
    const flavor = detectFlavor();
    const base = getBaseUrl();

    try {
      const raw = await fetchIssue(key, flavor);
      const ticket = fromApi(raw, flavor, base);
      showPanel(toMarkdown(ticket), 'api');
    } catch (err) {
      console.warn('[jira-extractor] API fetch failed, falling back to DOM:', err);
      const ticket = fromDom();
      if (!ticket || !ticket.summary) {
        showPanel("Couldn't read this ticket (API blocked and DOM scrape empty).", 'dom');
        return;
      }
      showPanel(toMarkdown(ticket), 'dom');
    }
  }

  function sync(): void {
    if (getIssueKey()) trigger.show();
    else trigger.hide();
  }

  // SPA-aware: Jira swaps issues without a full reload. Patch history + listen.
  (function patchHistory(h: History) {
    const fire = (): void => { window.dispatchEvent(new Event('jte-nav')); };
    const ps = h.pushState.bind(h);
    const rs = h.replaceState.bind(h);
    h.pushState = function (...a: Parameters<typeof h.pushState>) { const r = ps(...a); fire(); return r; };
    h.replaceState = function (...a: Parameters<typeof h.replaceState>) { const r = rs(...a); fire(); return r; };
    window.addEventListener('popstate', fire);
  })(window.history);

  let debounce: ReturnType<typeof setTimeout>;
  function onNav(): void {
    clearTimeout(debounce);
    debounce = setTimeout(sync, 300);
  }
  window.addEventListener('jte-nav', onNav);

  sync();
}
