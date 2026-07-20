# Auto Login

A floating one-click login button for pages you configure. All configuration
happens through the injected UI — you never edit the script.

## ⚠️ Development and test accounts only

Credentials are stored **unencrypted** in Tampermonkey's storage, and exported
share strings contain them in **fully recoverable** form. This is a deliberate
trade-off so logging in stays one click — see
[`docs/adr/0003`](../docs/adr/0003-credentials-stored-and-shared-in-plaintext.md).

Do not use this with production accounts. Do not paste a share string into a
ticket, a chat channel, or a gist.

## Install

Install `auto-login.user.js` in Tampermonkey.

The script declares `@match *://*/*` because the pages it acts on live in your
browser storage, not in the header — it cannot know them at install time. On any
page where no saved step matches, it does one storage read and stops: no UI, no
DOM changes, no observers. See
[`docs/adr/0001`](../docs/adr/0001-auto-login-injects-on-every-page.md).

## Usage

1. On a login page, open the Tampermonkey menu → **Auto Login: configure this page**.
2. **New account** — give it a friendly name, e.g. `dev1 payments acc`.
3. **Add step** — click the field you want filled, choose a selector from the
   ranked candidates, confirm which pages the step belongs to, and type the
   value. Repeat for each field.
4. For the login button, add a step and answer **yes** to "is this the final
   submit button?".
5. Reload. The trigger button appears bottom-right. Click it to log in;
   right-click it to reopen the panel.

With exactly one account matching the page and no lockout in effect, the run
starts automatically on load.

### Page patterns

Each step records which pages it belongs to. Globs by default — `*` matches any
run of characters, `?` matches one:

    https://dev1.example.com/login*

Wrap in slashes for a regular expression:

    /^https:\/\/dev\d+\.example\.com\/login/

An account applies to a page when any of its steps does.

### Multi-page logins

Flows spanning pages (email → Next → password → Sign in) work: record the steps
on each page as you go, and each step keeps that page's pattern. On every load
the script runs the block of steps belonging to the current page.

Position is derived by matching, not remembered — so a successful login simply
lands somewhere no step matches and nothing happens, and landing back on the
login page after a bad password refills the fields before submitting again.
See [`docs/adr/0004`](../docs/adr/0004-page-scoped-steps-instead-of-a-run-cursor.md).

### Auto-submit

On by default, toggled per account. Turn it off and a run fills every field but
stops just before the submit step — useful when an MFA prompt follows, or while
you are still checking the selectors are right.

After three consecutive automatic submits without leaving the account's pages,
automatic runs are paused and the button turns amber. Clicking it still works:
the guard exists to stop a misconfigured account looping bad credentials into a
lockout, not to refuse a human who wants to retry.

### Sharing a config

**Export share string** copies your whole config as one line beginning `AL1:`.
It contains credentials, so the button confirms first.

**Import share string** decodes and shows a preview: which accounts are new,
which collide with ones you already have, and what each would replace. Choose
skip / overwrite / keep both per row. Nothing is written until you apply, and
every incoming account is structurally validated before it is offered.

### If the config becomes unreadable

The panel says so and refuses to write, leaving the existing data untouched, and
offers **Discard unreadable config and start fresh** as the way out.

## Development

    npm install
    npm test          # vitest: match, storage, selector, runner, share, recording, picker
    npm run typecheck
    npm run build     # bundles src/ into auto-login.user.js

`src/storage.ts` is the only module that touches a `GM_*` API, behind an async
interface, so a Chrome-extension port is a one-file swap —
[`docs/adr/0002`](../docs/adr/0002-async-platform-neutral-storage-adapter.md).
