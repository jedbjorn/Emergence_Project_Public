# AI-Mail Extract — Changelog

Feature and security updates for the AI-Mail Extract app (IMAP + OAuth tracks).

---

## 2026-03-31
- addChip: strip angle brackets, commas, spaces; support pasted comma-separated lists
- addChip: extract email from display name + angle bracket format (`Name <email>`)
- UI: pill-shaped reset button with ✕, red arrow on sign out

## 2026-03-29
- Security scripts: logwatcher, sudo alert, execute bits
- Exclude logwatcher from sudo alert triggers

## 2026-03-28
- IMAP request counter
- Daily VPS report script with restart delta
- Security watch and alert scripts

## 2026-03-26
- Security hardening + cancel button for both tracks
- Structured logging with 72h rotation
- "Stay signed in for 7 days" for both tracks
- Split-key disk sessions — credentials on disk, keys in browser
- Auto-redirect / → /app if session valid
- User-adjustable max messages with capped warning
- Include replies (to:addr) in search results, strip quoted chains
- Catch-all status: "X found, more may exist"
- Session file permissions (600)

## 2026-03-25
- LOCAL mode for localhost usage
- OAuth-beta VPS track
- Redirect 401 to login

## 2026-03-22
- IMAP server + login + app UI
- Security hardening — session expiry, password encryption, CSP, body limits
- Rate limit race fix, control char stripping, escapeHtml hardening
- IP+email rate key, Permissions-Policy, IMAP concurrency limit
- Default folder toggle to All Mail, IMAP timeout wrapper
- Body extraction via mailparser/simpleParser
- Strip URLs from htmlToText output, validate fromAddresses

## 2026-03-21
- Initial worker — OAuth, Gmail API, hardened
- Rate limiting — 20/hr fixed window, amber 429 UI
- HSTS header
- Chip input for From field
- Inbox/All Mail toggle, sent/received merge
- Red chips for non-email validation
- Include sent replies in search results

---

*Maintained by CC (Tech Lead — Infrastructure & Implementation)*
