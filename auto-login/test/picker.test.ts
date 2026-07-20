import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pickElement } from '../src/picker';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<input id="u" type="text"><button id="go">Go</button>';
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

function clickOn(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('pickElement', () => {
  it('resolves with the clicked element and its candidates', async () => {
    const pending = pickElement(host);
    clickOn(document.querySelector('#u')!);

    const result = await pending;
    expect(result!.element).toBe(document.querySelector('#u'));
    expect(result!.candidates.length).toBeGreaterThan(0);
  });

  it('cancels the click so picking a submit button does not submit', async () => {
    const pending = pickElement(host);
    const button = document.querySelector('#go')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);

    await pending;
    expect(event.defaultPrevented).toBe(true);
  });

  it('resolves null on Escape', async () => {
    const pending = pickElement(host);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(await pending).toBeNull();
  });

  it('ignores clicks inside the host so the panel stays usable', async () => {
    const pending = pickElement(host);
    const inner = document.createElement('button');
    host.appendChild(inner);

    clickOn(inner);
    clickOn(document.querySelector('#u')!);

    expect((await pending)!.element).toBe(document.querySelector('#u'));
  });

  it('removes its listeners and highlight once settled', async () => {
    const pending = pickElement(host);
    expect(document.querySelector('#auto-login-picker-highlight')).not.toBeNull();

    clickOn(document.querySelector('#u')!);
    await pending;

    expect(document.querySelector('#auto-login-picker-highlight')).toBeNull();

    // A later click must not settle anything or throw.
    const stray = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('#go')!.dispatchEvent(stray);
    expect(stray.defaultPrevented).toBe(false);
  });

  it('restores the previous cursor', async () => {
    document.documentElement.style.cursor = 'auto';
    const pending = pickElement(host);
    expect(document.documentElement.style.cursor).toBe('crosshair');

    clickOn(document.querySelector('#u')!);
    await pending;

    expect(document.documentElement.style.cursor).toBe('auto');
  });
});
