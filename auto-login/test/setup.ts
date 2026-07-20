// jsdom 24 does not implement the `CSS` global, so `CSS.escape` is undefined
// under test. Every browser this userscript targets has had it since 2016, so
// the right move is to polyfill the test environment rather than hand-roll an
// escape in src/ and ship a worse implementation than the platform's.
//
// This is the canonical CSSOM algorithm rather than an approximation: an
// approximation would let tests pass against behaviour no real browser has.
function cssEscape(value: string): string {
  const str = String(value);
  const length = str.length;
  let result = '';
  let index = -1;
  const firstCodeUnit = str.charCodeAt(0);

  while (++index < length) {
    const codeUnit = str.charCodeAt(index);

    // Replace NULL with the replacement character.
    if (codeUnit === 0x0000) {
      result += '�';
      continue;
    }

    if (
      // Control characters and DEL.
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      // A leading digit, or a digit following a leading hyphen.
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
    ) {
      result += `\\${codeUnit.toString(16)} `;
      continue;
    }

    // A lone leading hyphen.
    if (index === 0 && length === 1 && codeUnit === 0x002d) {
      result += `\\${str.charAt(index)}`;
      continue;
    }

    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += str.charAt(index);
      continue;
    }

    result += `\\${str.charAt(index)}`;
  }

  return result;
}

if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
  (globalThis as { CSS?: unknown }).CSS = { escape: cssEscape };
}
