import { generateCandidates } from './selector';
import type { SelectorCandidate } from './types';

const HIGHLIGHT_ID = 'auto-login-picker-highlight';

export interface PickResult {
  element: Element;
  candidates: SelectorCandidate[];
}

/**
 * Put the page into element-picking mode. Resolves with the picked element and
 * its ranked selector candidates, or null if the user pressed Escape.
 *
 * Click is captured at the capture phase and cancelled, so picking the login
 * button does not submit the form.
 */
export function pickElement(host: HTMLElement): Promise<PickResult | null> {
  return new Promise((resolve) => {
    const highlight = document.createElement('div');
    highlight.id = HIGHLIGHT_ID;
    Object.assign(highlight.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483646',
      border: '2px solid #4f9cf9',
      background: 'rgba(79, 156, 249, 0.15)',
      borderRadius: '2px',
      transition: 'all 60ms ease-out',
    });
    document.body.appendChild(highlight);

    const previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'crosshair';

    function target(event: Event): Element | null {
      const el = event.target as Element | null;
      if (!el || el === host || host.contains(el) || el === highlight) return null;
      return el;
    }

    function onMove(event: MouseEvent): void {
      const el = target(event);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      Object.assign(highlight.style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }

    function finish(result: PickResult | null): void {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.style.cursor = previousCursor;
      highlight.remove();
      resolve(result);
    }

    function onClick(event: MouseEvent): void {
      const el = target(event);
      if (!el) return;

      // Capture phase + both cancels: picking the submit button must not
      // actually submit the form, and picking a link must not navigate.
      event.preventDefault();
      event.stopPropagation();

      let candidates: SelectorCandidate[] = [];
      try {
        candidates = generateCandidates(el, document);
      } catch {
        // Never leave the promise unsettled — the caller awaits this, and an
        // unsettled promise strands the whole step-adding flow with no error.
        finish(null);
        return;
      }

      finish({ element: el, candidates });
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finish(null);
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  });
}
