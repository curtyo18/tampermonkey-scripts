import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  accountMatchesPage,
  isAutoRunBlocked,
  runSteps,
  seedAttempts,
  setNativeValue,
  stepsForPage,
  waitForElement,
} from '../src/runner';
import {
  ATTEMPTS_WINDOW_MS,
  MAX_SUBMIT_ATTEMPTS,
  type AccountConfig,
  type RunState,
  type Step,
} from '../src/types';

const LOGIN = 'https://example.com/login';
const OTP = 'https://example.com/otp';

function step(overrides: Partial<Step> = {}): Step {
  return {
    id: 's1',
    kind: 'fill',
    selector: '#u',
    pagePattern: 'https://example.com/login*',
    ...overrides,
  };
}

function account(steps: Step[], autoSubmit = true): AccountConfig {
  return {
    id: 'a1',
    name: 'dev1 payments acc',
    steps,
    autoSubmit,
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('stepsForPage', () => {
  const flow = account([
    step({ id: 's1', selector: '#u', value: 'alice' }),
    step({ id: 's2', kind: 'click', selector: '#next' }),
    step({ id: 's3', selector: '#p', value: 'hunter2', pagePattern: 'https://example.com/otp*' }),
    step({
      id: 's4',
      kind: 'click',
      selector: '#go',
      isSubmit: true,
      pagePattern: 'https://example.com/otp*',
    }),
  ]);

  it('returns only the steps recorded on the current page', () => {
    expect(stepsForPage(flow, LOGIN).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(stepsForPage(flow, OTP).map((s) => s.id)).toEqual(['s3', 's4']);
  });

  it('returns nothing for a page outside the flow, so a successful login is silent', () => {
    expect(stepsForPage(flow, 'https://example.com/dashboard')).toEqual([]);
  });

  it('returns the first matching block again on a retry, so fills precede submit', () => {
    const retry = account([
      step({ id: 's1', selector: '#u', value: 'alice' }),
      step({ id: 's2', kind: 'click', selector: '#go', isSubmit: true }),
    ]);

    // Landing back on the login page after bad credentials must refill, not
    // resume at submit against an empty form.
    expect(stepsForPage(retry, LOGIN).map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('stops at the first page boundary rather than gathering later matching blocks', () => {
    const revisits = account([
      step({ id: 's1', selector: '#u' }),
      step({ id: 's2', selector: '#p', pagePattern: 'https://example.com/otp*' }),
      step({ id: 's3', selector: '#again' }),
    ]);

    expect(stepsForPage(revisits, LOGIN).map((s) => s.id)).toEqual(['s1']);
  });
});

describe('accountMatchesPage', () => {
  it('matches when any step belongs to the page', () => {
    const acct = account([step({ pagePattern: 'https://example.com/otp*' })]);
    expect(accountMatchesPage(acct, OTP)).toBe(true);
    expect(accountMatchesPage(acct, LOGIN)).toBe(false);
  });

  it('does not match an account with no steps', () => {
    expect(accountMatchesPage(account([]), LOGIN)).toBe(false);
  });
});

describe('setNativeValue', () => {
  it('writes through the native setter and dispatches input and change', () => {
    document.body.innerHTML = '<input id="u" type="text">';
    const el = document.querySelector<HTMLInputElement>('#u')!;
    const events: string[] = [];
    el.addEventListener('input', () => events.push('input'));
    el.addEventListener('change', () => events.push('change'));

    setNativeValue(el, 'alice');

    expect(el.value).toBe('alice');
    expect(events).toEqual(['input', 'change']);
  });

  it('does not blur, which would advance identity-first flows mid-run', () => {
    document.body.innerHTML = '<input id="u" type="text">';
    const el = document.querySelector<HTMLInputElement>('#u')!;
    const blurred = vi.fn();
    el.addEventListener('blur', blurred);

    setNativeValue(el, 'alice');

    expect(blurred).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(el);
  });
});

describe('waitForElement', () => {
  it('resolves immediately when the element already exists', async () => {
    document.body.innerHTML = '<input id="u">';
    await expect(waitForElement('#u', document, 100)).resolves.not.toBeNull();
  });

  it('resolves once the element appears later', async () => {
    const promise = waitForElement('#late', document, 1000);
    setTimeout(() => {
      document.body.innerHTML = '<input id="late">';
    }, 10);
    await expect(promise).resolves.not.toBeNull();
  });

  it('resolves null on timeout', async () => {
    await expect(waitForElement('#never', document, 20)).resolves.toBeNull();
  });

  it('resolves null rather than throwing on a malformed selector', async () => {
    await expect(waitForElement('input[name=', document, 20)).resolves.toBeNull();
  });
});

describe('runSteps', () => {
  it('fills every step in order and reports completion', async () => {
    document.body.innerHTML = '<input id="u"><input id="p" type="password">';
    const report = await runSteps(
      [
        step({ id: 's1', selector: '#u', value: 'alice' }),
        step({ id: 's2', selector: '#p', value: 'hunter2' }),
      ],
      true,
      document,
    );

    expect(report).toMatchObject({ outcome: 'completed', submitted: false });
    expect(document.querySelector<HTMLInputElement>('#u')!.value).toBe('alice');
    expect(document.querySelector<HTMLInputElement>('#p')!.value).toBe('hunter2');
  });

  it('halts before the submit step when auto-submit is off', async () => {
    document.body.innerHTML = '<input id="u"><button id="go"></button>';
    const clicked = vi.fn();
    document.querySelector('#go')!.addEventListener('click', clicked);

    const report = await runSteps(
      [
        step({ id: 's1', selector: '#u', value: 'alice' }),
        step({ id: 's2', kind: 'click', selector: '#go', isSubmit: true }),
      ],
      false,
      document,
    );

    expect(report).toMatchObject({ outcome: 'halted-before-submit', submitted: false });
    expect(clicked).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('#u')!.value).toBe('alice');
  });

  it('runs an intermediate click even when auto-submit is off', async () => {
    document.body.innerHTML = '<button id="next"></button>';
    const clicked = vi.fn();
    document.querySelector('#next')!.addEventListener('click', clicked);

    const report = await runSteps(
      [step({ id: 's1', kind: 'click', selector: '#next' })],
      false,
      document,
    );

    expect(report.outcome).toBe('completed');
    expect(report.submitted).toBe(false);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('reports submitted when the submit step fires', async () => {
    document.body.innerHTML = '<button id="go"></button>';
    const clicked = vi.fn();
    document.querySelector('#go')!.addEventListener('click', clicked);

    const report = await runSteps(
      [step({ id: 's1', kind: 'click', selector: '#go', isSubmit: true })],
      true,
      document,
    );

    expect(report).toMatchObject({ outcome: 'completed', submitted: true });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('fails with the offending step index and selector when an element is missing', async () => {
    const report = await runSteps([step({ selector: '#missing', value: 'x' })], true, document);

    expect(report.outcome).toBe('failed');
    expect(report.stepIndex).toBe(0);
    expect(report.message).toContain('#missing');
  });

  it('fails rather than typing an empty string when a fill step has no value', async () => {
    document.body.innerHTML = '<input id="u">';
    const report = await runSteps([step({ selector: '#u' })], true, document);

    expect(report.outcome).toBe('failed');
    expect(report.message).toMatch(/no value configured/i);
    expect(document.querySelector<HTMLInputElement>('#u')!.value).toBe('');
  });

  it('fails instead of throwing on a malformed selector', async () => {
    const report = await runSteps([step({ selector: 'input[name=', value: 'x' })], true, document);

    expect(report.outcome).toBe('failed');
    expect(report.message).toContain('input[name=');
  });

  it('fails instead of throwing when the target has no click method', async () => {
    document.body.innerHTML = '<svg id="icon"></svg>';
    const report = await runSteps(
      [step({ kind: 'click', selector: '#icon', isSubmit: true })],
      true,
      document,
    );

    expect(report.outcome).toBe('failed');
    expect(report.message).toMatch(/not clickable/i);
    expect(report.submitted).toBe(false);
  });

  it('fails when a fill target is not a text field', async () => {
    document.body.innerHTML = '<div id="u"></div>';
    const report = await runSteps([step({ selector: '#u', value: 'x' })], true, document);

    expect(report.outcome).toBe('failed');
    expect(report.message).toMatch(/not a text field/i);
  });

  it('stops at the failing step and does not run later steps', async () => {
    document.body.innerHTML = '<input id="p">';
    await runSteps(
      [
        step({ id: 's1', selector: '#missing', value: 'x' }),
        step({ id: 's2', selector: '#p', value: 'later' }),
      ],
      true,
      document,
    );

    expect(document.querySelector<HTMLInputElement>('#p')!.value).toBe('');
  });

  it('uses the first match when a selector is ambiguous', async () => {
    document.body.innerHTML = '<input class="f"><input class="f">';
    await runSteps([step({ selector: '.f', value: 'alice' })], true, document);

    const inputs = document.querySelectorAll<HTMLInputElement>('.f');
    expect(inputs[0].value).toBe('alice');
    expect(inputs[1].value).toBe('');
  });

  it('times out a waitFor step and reports the selector', async () => {
    const report = await runSteps(
      [step({ kind: 'waitFor', selector: '#never', timeoutMs: 20 })],
      true,
      document,
    );

    expect(report.outcome).toBe('failed');
    expect(report.message).toContain('#never');
  });

  it('falls back to the default timeout when a waitFor step sets none', async () => {
    vi.useFakeTimers();
    try {
      const pending = runSteps([step({ kind: 'waitFor', selector: '#never' })], true, document);
      await vi.advanceTimersByTimeAsync(8001);

      expect((await pending).outcome).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing and reports completion for an empty step list', async () => {
    expect(await runSteps([], true, document)).toMatchObject({
      outcome: 'completed',
      submitted: false,
    });
  });
});

describe('lockout guard', () => {
  const NOW = 1_000_000;

  function runState(overrides: Partial<RunState> = {}): RunState {
    return { accountId: 'a1', attempts: 0, updatedAt: NOW, ...overrides };
  }

  describe('isAutoRunBlocked', () => {
    it('does not block with no run state', () => {
      expect(isAutoRunBlocked(null, 'a1', NOW)).toBe(false);
    });

    it('blocks once the attempt limit is reached', () => {
      expect(isAutoRunBlocked(runState({ attempts: MAX_SUBMIT_ATTEMPTS - 1 }), 'a1', NOW)).toBe(false);
      expect(isAutoRunBlocked(runState({ attempts: MAX_SUBMIT_ATTEMPTS }), 'a1', NOW)).toBe(true);
    });

    it('does not block a different account', () => {
      expect(isAutoRunBlocked(runState({ attempts: MAX_SUBMIT_ATTEMPTS }), 'a2', NOW)).toBe(false);
    });

    it('releases once the window has passed', () => {
      const stale = runState({ attempts: MAX_SUBMIT_ATTEMPTS });
      expect(isAutoRunBlocked(stale, 'a1', NOW + ATTEMPTS_WINDOW_MS + 1)).toBe(false);
    });
  });

  describe('seedAttempts', () => {
    it('starts a manual run at zero however high the count is', () => {
      expect(seedAttempts(runState({ attempts: 99 }), 'a1', true, NOW)).toBe(0);
    });

    it('carries the count forward for an automatic run', () => {
      expect(seedAttempts(runState({ attempts: 2 }), 'a1', false, NOW)).toBe(2);
    });

    it('starts at zero for a different account', () => {
      expect(seedAttempts(runState({ attempts: 2 }), 'a2', false, NOW)).toBe(0);
    });

    it('does not re-arm the guard from a count outside the window', () => {
      // Without the freshness check the guard released, then immediately
      // re-blocked by seeding 3 and persisting 4.
      const stale = runState({ attempts: MAX_SUBMIT_ATTEMPTS });
      const later = NOW + ATTEMPTS_WINDOW_MS + 1;

      expect(isAutoRunBlocked(stale, 'a1', later)).toBe(false);
      expect(seedAttempts(stale, 'a1', false, later)).toBe(0);
    });
  });
});
