/**
 * `/pattern/flags` — the escape hatch for users who want a real regex.
 * Flags are captured loosely and validated by RegExp itself; an allow-list
 * here would silently reject flags added to the language later.
 */
const REGEX_FORM = /^\/(.*)\/([a-z]*)$/;

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a URL pattern to a RegExp. Returns null when the pattern is a
 * malformed regex, so the panel can flag that account config as invalid
 * rather than the matcher throwing on every page load.
 */
export function compilePattern(pattern: string): RegExp | null {
  const asRegex = REGEX_FORM.exec(pattern);
  if (asRegex) {
    const [, body, flags] = asRegex;

    // An empty body compiles to /(?:)/, which matches every URL — that would
    // put a button offering saved credentials on every site the user visits.
    if (body === '') return null;

    // Returning null on a bad flag matters: falling through to the glob branch
    // would compile to something that can never match, while the panel still
    // reported the account config as valid.
    try {
      return new RegExp(body, flags);
    } catch {
      return null;
    }
  }

  // Glob: escape everything, then re-open the two wildcards.
  const body = escapeLiteral(pattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  try {
    return new RegExp(`^${body}$`);
  } catch {
    return null;
  }
}

export function matchesPattern(pattern: string, url: string): boolean {
  const re = compilePattern(pattern);
  return re ? re.test(url) : false;
}
