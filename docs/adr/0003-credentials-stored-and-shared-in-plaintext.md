# 0003. Credentials are stored and shared in plaintext

Date: 2026-07-20
Status: accepted

## Context

Auto Login exists to make logging into development environments a single click. Any encryption-at-rest scheme worth the name needs a secret the script does not hold — in practice a master passphrase typed at least once per browser session. That reintroduces exactly the typing the script was built to remove, and for dev-tier accounts it buys protection against a threat (someone with read access to the user's browser profile) who already has far better options available to them.

The share-string feature sharpens the same question. A config can be exported as one compressed line and pasted to a teammate. Compression and base64 are encodings, not encryption; anyone holding the string can recover the credentials. The alternative considered was a recipe-only export that strips every `fill` value and shares just selectors and flow structure — safer, but it stops the string from being a way to move a full config between the user's own machines.

Both choices are hard to reverse: encrypting later is a storage migration plus a UX change, and any share string already in circulation stays readable forever.

## Decision

Credentials are stored in plaintext in GM storage. Share strings always carry the full config **including credentials**, gated behind an explicit confirmation that names this fact, with a plain-language warning line prepended to the copied text so the recipient understands what they were handed.

Auto Login is therefore scoped to **non-production, development and test accounts only**, stated at the top of its README.

## Consequences

One-click login actually stays one click, and a full config moves between machines and teammates as a single paste.

In exchange, a share string is credential material: pasting one into a ticket, a chat channel or a public gist is a credential leak, and it cannot be walked back by deleting the message. Anyone using this script with a production account is misusing it, and no technical control in the script prevents them.

Because this repo is public, the committed `auto-login.user.js` must never contain site names, URLs or credentials — every site-specific detail lives only in the user's browser storage.
