import { describe, it, expect } from 'vitest';
import { compilePattern, matchesPattern } from '../src/match';

describe('matchesPattern — glob form', () => {
  it('matches an exact URL', () => {
    expect(matchesPattern('https://example.com/login', 'https://example.com/login')).toBe(true);
  });

  it('treats * as a multi-character wildcard', () => {
    expect(matchesPattern('https://example.com/*', 'https://example.com/auth/login')).toBe(true);
  });

  it('treats ? as a single-character wildcard', () => {
    expect(matchesPattern('https://dev?.example.com/*', 'https://dev1.example.com/login')).toBe(true);
    expect(matchesPattern('https://dev?.example.com/*', 'https://dev12.example.com/login')).toBe(false);
  });

  it('is anchored at both ends', () => {
    expect(matchesPattern('https://example.com', 'https://example.com/login')).toBe(false);
  });

  it('includes the scheme in the comparison', () => {
    expect(matchesPattern('https://example.com/*', 'http://example.com/login')).toBe(false);
  });

  it('escapes regex metacharacters in the literal parts', () => {
    expect(matchesPattern('https://example.com/a.b', 'https://example.com/axb')).toBe(false);
    expect(matchesPattern('https://example.com/a.b', 'https://example.com/a.b')).toBe(true);
  });

  it('matches nothing for an empty pattern', () => {
    expect(matchesPattern('', 'https://example.com/login')).toBe(false);
  });

  it('matches any URL for a bare *', () => {
    expect(matchesPattern('*', 'https://example.com/login')).toBe(true);
  });
});

describe('matchesPattern — regex form', () => {
  it('treats /body/flags as a regular expression', () => {
    expect(matchesPattern('/^https:\\/\\/dev\\d+\\.example\\.com/', 'https://dev42.example.com/login')).toBe(true);
  });

  it('honours flags', () => {
    expect(matchesPattern('/EXAMPLE\\.COM/i', 'https://example.com/login')).toBe(true);
    expect(matchesPattern('/EXAMPLE\\.COM/', 'https://example.com/login')).toBe(false);
  });

  it('is not implicitly anchored', () => {
    expect(matchesPattern('/example\\.com/', 'https://example.com/login')).toBe(true);
  });

  it('returns false for a malformed regex instead of throwing', () => {
    expect(() => matchesPattern('/[unclosed/', 'https://example.com')).not.toThrow();
    expect(matchesPattern('/[unclosed/', 'https://example.com')).toBe(false);
  });

  it('rejects an empty body, which would otherwise match every URL', () => {
    expect(compilePattern('//')).toBeNull();
    expect(matchesPattern('//', 'https://example.com/login')).toBe(false);
  });

  it('rejects an unknown flag rather than silently degrading to a glob', () => {
    expect(compilePattern('/^https/gx')).toBeNull();
  });

  it('keeps literal slashes inside the body', () => {
    expect(matchesPattern('/example\\.com\\/auth/', 'https://example.com/auth/login')).toBe(true);
  });

  it('is stateless across calls even with the g flag', () => {
    const url = 'https://example.com/login';
    const results = [0, 1, 2].map(() => matchesPattern('/example\\.com/g', url));
    expect(results).toEqual([true, true, true]);
  });
});

describe('compilePattern', () => {
  it('returns null for a malformed regex so callers can flag it', () => {
    expect(compilePattern('/[unclosed/')).toBeNull();
  });

  it('returns a RegExp for a valid glob', () => {
    expect(compilePattern('https://example.com/*')).toBeInstanceOf(RegExp);
  });
});
