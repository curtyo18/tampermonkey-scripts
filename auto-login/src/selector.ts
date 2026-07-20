import type { SelectorCandidate } from './types';

const TEST_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy'];
const UNIQUE_TYPE_HINTS = ['password', 'email'];

/**
 * Framework-generated ids change on every render, so a selector built from one
 * works exactly once — and the failure lands much later, when a saved account
 * config quietly stops filling a field.
 *
 * The checks are deliberately trigger-happy. Wrongly accepting an unstable id
 * corrupts a config silently; wrongly rejecting a stable one just falls through
 * to a slightly less pretty selector. When in doubt, reject.
 */
export function isUnstableId(id: string): boolean {
  if (id === '') return true;
  // React's useId: ":r0:", ":r1a:".
  if (/^:[a-z0-9]+:$/i.test(id)) return true;
  // Hashes from CSS-in-JS and bundlers, whole or as a prefixed/suffixed token.
  // Deliberately not anchored to the whole string: "field-a3f9c2b1d4e5" is the
  // dominant real-world form and a fully anchored check misses every one.
  if (/(^|[-_])[a-f0-9]{8,}($|[-_])/i.test(id)) return true;
  // Long digit runs are almost always generated indices or timestamps.
  if (/\d{4,}/.test(id)) return true;
  return false;
}

/**
 * Escapes an attribute VALUE for use inside a quoted CSS attribute selector.
 * Identifiers go through `CSS.escape` instead — the two are not
 * interchangeable, and using this one on an identifier produces a selector
 * that parses but matches nothing.
 */
function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function isUniqueId(id: string, doc: Document): boolean {
  try {
    return doc.querySelectorAll(`#${CSS.escape(id)}`).length === 1;
  } catch {
    return false;
  }
}

function structuralPath(el: Element, doc: Document): string {
  if (el === doc.documentElement) return 'html';

  const parts: string[] = [];
  let node: Element | null = el;

  while (node && node !== doc.documentElement) {
    // Anchoring on an id is only worth it if the id is actually unique —
    // otherwise the path is no better than the duplicate it is built on.
    if (node.id && !isUnstableId(node.id) && isUniqueId(node.id, doc)) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }

    const parent: Element | null = node.parentElement;
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

  return parts.join(' > ');
}

/**
 * Measure a proposed selector against the document. Returns null when the
 * selector is not valid CSS — an attribute value containing a newline, or an
 * empty structural path, would otherwise throw out of `generateCandidates`
 * and take every other candidate down with it.
 */
function measure(
  selector: string,
  label: string,
  el: Element,
  doc: Document,
): SelectorCandidate | null {
  let matches: NodeListOf<Element>;
  try {
    matches = doc.querySelectorAll(selector);
  } catch {
    return null;
  }

  return {
    selector,
    label,
    matchCount: matches.length,
    resolvesToPicked: matches[0] === el,
  };
}

/**
 * Propose selectors for a picked element in descending order of expected
 * stability. This function proposes, it does not decide — the picker shows the
 * list with match counts and lets the user choose or hand-edit.
 *
 * Candidates that uniquely resolve to the picked element are floated to the
 * top regardless of category. A duplicated `id` is the motivating case: it is
 * the most stable-looking selector available and can still address the wrong
 * field, which would type a password into someone else's input forever.
 */
export function generateCandidates(el: Element, doc: Document): SelectorCandidate[] {
  const proposed: Array<{ selector: string; label: string }> = [];
  const tag = el.tagName.toLowerCase();

  if (el.id && !isUnstableId(el.id)) {
    proposed.push({ selector: `#${CSS.escape(el.id)}`, label: 'id' });
  }

  const name = el.getAttribute('name');
  if (name) {
    proposed.push({
      selector: `${tag}[name="${escapeAttributeValue(name)}"]`,
      label: 'name attribute',
    });
  }

  for (const attr of TEST_ATTRS) {
    const value = el.getAttribute(attr);
    if (value) {
      proposed.push({
        selector: `[${attr}="${escapeAttributeValue(value)}"]`,
        label: `${attr} attribute`,
      });
    }
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    proposed.push({
      selector: `[aria-label="${escapeAttributeValue(ariaLabel)}"]`,
      label: 'aria-label',
    });
  }

  const type = el.getAttribute('type');
  if (type && UNIQUE_TYPE_HINTS.includes(type)) {
    const selector = `${tag}[type="${type}"]`;
    if (doc.querySelectorAll(selector).length === 1) {
      proposed.push({ selector, label: `only ${type} field on the page` });
    }
  }

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) {
    proposed.push({
      selector: `[placeholder="${escapeAttributeValue(placeholder)}"]`,
      label: 'placeholder',
    });
  }

  proposed.push({ selector: structuralPath(el, doc), label: 'structural path' });

  const seen = new Set<string>();
  const measured: SelectorCandidate[] = [];

  for (const candidate of proposed) {
    if (seen.has(candidate.selector)) continue;
    seen.add(candidate.selector);

    const result = measure(candidate.selector, candidate.label, el, doc);
    if (result) measured.push(result);
  }

  // Stable partition, so ranking within each group stays as proposed.
  const exact = measured.filter((c) => c.resolvesToPicked && c.matchCount === 1);
  const rest = measured.filter((c) => !(c.resolvesToPicked && c.matchCount === 1));
  return [...exact, ...rest];
}
