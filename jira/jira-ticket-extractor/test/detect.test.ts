import { describe, it, expect, afterEach } from 'vitest';
import { getIssueKey, detectFlavor } from '../src/detect.js';

function setLocation(url: string): void {
  // jsdom's default document URL is about:blank and it blocks cross-origin
  // history.replaceState, so redefine window.location with a URL instead.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: new URL(url),
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  setLocation('http://localhost/');
});

describe('getIssueKey', () => {
  it('reads key from /browse/ path', () => {
    setLocation('http://localhost/browse/PROJ-123');
    expect(getIssueKey()).toBe('PROJ-123');
  });

  it('reads key from selectedIssue query param', () => {
    setLocation('http://localhost/jira/software/projects/AB/boards/1?selectedIssue=AB-9');
    expect(getIssueKey()).toBe('AB-9');
  });

  it('reads key from a data-issue-key attribute in the DOM', () => {
    setLocation('http://localhost/whatever');
    document.body.innerHTML = '<div data-issue-key="XY-42"></div>';
    expect(getIssueKey()).toBe('XY-42');
  });

  it('returns null when no key is present', () => {
    setLocation('http://localhost/dashboard');
    expect(getIssueKey()).toBeNull();
  });
});

describe('detectFlavor', () => {
  it('returns cloud for an atlassian.net host', () => {
    setLocation('http://x.atlassian.net/browse/A-1');
    expect(detectFlavor()).toBe('cloud');
  });

  it('returns cloud for a custom domain with the #jira-frontend root', () => {
    setLocation('http://jira.acme.com/browse/A-1');
    document.body.innerHTML = '<div id="jira-frontend"></div>';
    expect(detectFlavor()).toBe('cloud');
  });

  it('returns server otherwise', () => {
    setLocation('http://jira.acme.internal/browse/A-1');
    expect(detectFlavor()).toBe('server');
  });
});
