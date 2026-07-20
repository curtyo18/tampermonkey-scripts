import { describe, it, expect, beforeEach } from 'vitest';
import { generateCandidates, isUnstableId } from '../src/selector';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => setBody(''));

describe('isUnstableId', () => {
  it('rejects React useId values', () => {
    expect(isUnstableId(':r0:')).toBe(true);
    expect(isUnstableId(':r1a:')).toBe(true);
  });

  it('rejects long hex hashes', () => {
    expect(isUnstableId('a3f9c2b1d4e5f6a7')).toBe(true);
  });

  it('rejects ids containing long digit runs', () => {
    expect(isUnstableId('input-12345')).toBe(true);
  });

  it('accepts human-authored ids', () => {
    expect(isUnstableId('username')).toBe(false);
    expect(isUnstableId('login-form-password')).toBe(false);
  });
});

describe('generateCandidates', () => {
  it('ranks a stable id first', () => {
    setBody('<input id="username" name="user" type="text">');
    const el = document.querySelector('#username')!;
    expect(generateCandidates(el, document)[0].selector).toBe('#username');
  });

  it('skips a framework-generated id and falls through to the name attribute', () => {
    setBody('<input id=":r0:" name="user" type="text">');
    const el = document.querySelector('input')!;
    const selectors = generateCandidates(el, document).map((c) => c.selector);
    expect(selectors).not.toContain('#:r0:');
    expect(selectors[0]).toBe('input[name="user"]');
  });

  it('prefers a test attribute over aria-label', () => {
    setBody('<input data-testid="user-field" aria-label="Username" type="text">');
    const el = document.querySelector('input')!;
    const selectors = generateCandidates(el, document).map((c) => c.selector);
    expect(selectors.indexOf('[data-testid="user-field"]')).toBeLessThan(
      selectors.indexOf('[aria-label="Username"]'),
    );
  });

  it('offers input[type="password"] only when it is unique in the document', () => {
    setBody('<input type="password">');
    const unique = generateCandidates(document.querySelector('input')!, document);
    expect(unique.map((c) => c.selector)).toContain('input[type="password"]');

    setBody('<input type="password"><input type="password">');
    const ambiguous = generateCandidates(document.querySelector('input')!, document);
    expect(ambiguous.map((c) => c.selector)).not.toContain('input[type="password"]');
  });

  it('always produces at least a structural fallback', () => {
    setBody('<form><div><input type="text"></div></form>');
    const el = document.querySelector('input')!;
    const candidates = generateCandidates(el, document);
    expect(candidates.length).toBeGreaterThan(0);
    expect(document.querySelector(candidates[candidates.length - 1].selector)).toBe(el);
  });

  it('annotates each candidate with how many elements it matches', () => {
    setBody('<input class="f" type="text"><input class="f" type="text">');
    const el = document.querySelector('input')!;
    for (const candidate of generateCandidates(el, document)) {
      expect(candidate.matchCount).toBe(document.querySelectorAll(candidate.selector).length);
    }
  });

  it('does not offer a duplicated id as if it uniquely identified the element', () => {
    setBody('<input id="username" class="a"><input id="username" class="b">');
    const second = document.querySelectorAll('input')[1];
    const candidates = generateCandidates(second, document);

    // #username matches the FIRST input, so nothing may claim it resolves to
    // the picked one — otherwise the password lands in the wrong field.
    const byId = candidates.find((c) => c.selector === '#username');
    expect(byId?.resolvesToPicked).toBe(false);
    expect(candidates[0].resolvesToPicked).toBe(true);
    expect(document.querySelector(candidates[0].selector)).toBe(second);
  });

  it('floats a candidate that uniquely resolves to the picked element to the top', () => {
    setBody('<div id="app"><input name="user"></div><div id="app"><input name="user" class="b"></div>');
    const second = document.querySelectorAll('input')[1];
    const candidates = generateCandidates(second, document);

    expect(candidates[0].resolvesToPicked).toBe(true);
    expect(candidates[0].matchCount).toBe(1);
  });

  it('survives an attribute value that is not valid inside a CSS string', () => {
    setBody('<input type="text">');
    const el = document.querySelector('input')!;
    el.setAttribute('aria-label', 'line one\nline two');

    expect(() => generateCandidates(el, document)).not.toThrow();
    const candidates = generateCandidates(el, document);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(() => document.querySelector(candidate.selector)).not.toThrow();
    }
  });

  it('does not throw when the picked element is the document element', () => {
    expect(() => generateCandidates(document.documentElement, document)).not.toThrow();
    const candidates = generateCandidates(document.documentElement, document);
    expect(candidates[0].selector).toBe('html');
    expect(candidates[0].resolvesToPicked).toBe(true);
  });

  it('disambiguates identical siblings with nth-of-type', () => {
    setBody('<form><input type="text"><input type="text"><input type="text"></form>');
    const third = document.querySelectorAll('input')[2];
    const candidates = generateCandidates(third, document);

    expect(candidates[0].selector).toContain(':nth-of-type(3)');
    expect(document.querySelector(candidates[0].selector)).toBe(third);
  });

  it('escapes an id that is not a bare CSS identifier', () => {
    setBody('<input id="user.name" type="text">');
    const el = document.querySelector('input')!;
    const candidates = generateCandidates(el, document);

    expect(candidates[0].label).toBe('id');
    expect(candidates[0].matchCount).toBe(1);
    expect(document.querySelector(candidates[0].selector)).toBe(el);
  });

  it('every returned candidate is valid CSS and its matchCount is truthful', () => {
    setBody('<form><div><input id="user.name" name="u" placeholder="Email" type="text"></div></form>');
    const el = document.querySelector('input')!;

    for (const candidate of generateCandidates(el, document)) {
      expect(document.querySelectorAll(candidate.selector).length).toBe(candidate.matchCount);
      expect(candidate.resolvesToPicked).toBe(document.querySelector(candidate.selector) === el);
    }
  });
});

describe('isUnstableId — hash forms seen in the wild', () => {
  it('rejects a prefixed hash, not just a bare one', () => {
    expect(isUnstableId('field-a3f9c2b1d4e5')).toBe(true);
    expect(isUnstableId('css-1a2b3c4d5e6f')).toBe(true);
  });

  it('still accepts hyphenated human names that merely contain hex letters', () => {
    expect(isUnstableId('login-form')).toBe(false);
    expect(isUnstableId('email-address')).toBe(false);
  });
});
