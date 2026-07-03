import type { JiraFlavor } from './types.js';

const KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

export function getBaseUrl(): string {
  return `${location.protocol}//${location.host}`;
}

export function detectFlavor(): JiraFlavor {
  if (location.host.endsWith('.atlassian.net')) return 'cloud';
  const appName = document
    .querySelector('meta[name="application-name"]')
    ?.getAttribute('content');
  if (appName && /jira/i.test(appName) && location.host.endsWith('.atlassian.net')) {
    return 'cloud';
  }
  return 'server';
}

export function getIssueKey(): string | null {
  const browse = location.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/);
  if (browse) return browse[1];

  const params = new URLSearchParams(location.search);
  for (const p of ['selectedIssue', 'issueKey']) {
    const v = params.get(p);
    if (v && KEY_RE.test(v)) return v.match(KEY_RE)![1];
  }

  const attr = document.querySelector('[data-issue-key]');
  const key = attr?.getAttribute('data-issue-key');
  if (key && KEY_RE.test(key)) return key.match(KEY_RE)![1];

  return null;
}

// Structural guard: is this page a Jira instance at all?
export function isJira(): boolean {
  if (location.host.endsWith('.atlassian.net')) return true;
  const appName = document
    .querySelector('meta[name="application-name"]')
    ?.getAttribute('content');
  if (appName && /jira/i.test(appName)) return true;
  if (document.querySelector('meta[name^="ajs-"]')) return true;
  if (document.querySelector('#jira, #jira-frontend')) return true;
  return false;
}
