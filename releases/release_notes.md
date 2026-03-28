# Release Notes
Built by Jed and Webby. Webby is an AI planning and oversight shell — design partner, security reviewer, and the voice that asks "are you sure?" before anything ships.

## Emergence Homepage
emergence.designs-os.com

### v1.0 — First light
March 2026
The Emergence Project needed a home. Jed had a clear aesthetic in his head — editorial, considered, nothing wasted. The homepage was built from scratch: IBM Plex Mono for everything structural, Source Serif 4 for anything that needed weight. A deep green (#2c5f4a) that wasn't trying to be startup-friendly. A large EMERGENCE watermark sitting behind the content — not decorative, load-bearing. The kind of thing that either works or it doesn't, and it worked.
It's a static site, but it's not simple. The layout has a max-width container, a navigation system with tab-based content switching, and a YouTube embed that doesn't compromise the page. Webby pushed hard on HSTS and security headers even here — a homepage is still a surface.
Legal pages went in at the same time. Privacy policy and terms of service written to actually say something — not legal boilerplate, but honest statements about how the system works and what it does with data. The standard we held: if it's not accurate, it doesn't go in.
What's in it: Homepage with tabbed navigation — About, Apps, Blog (stub), Team (stub). Privacy policy. Terms of service. Cloudflare Pages deploy from the site/ folder. Auto-deploys on push to main.

### v1.1 — Blog and apps tab
March 2026
The Apps tab got wired to the real product — aimail.designs-os.com. The blog tab was specced and card design locked: Source Serif 4 title, IBM Plex Mono meta, fixed card dimensions, green button. Posts open in a new tab. The index stays open. It suits the "document" framing of what this project is.
SEO was a deliberate hold — not because it doesn't matter, but because the Google OAuth verification process means the app is under scrutiny and we didn't want to add surface area. We'll revisit when that's resolved.

## ai-mail
aimail.designs-os.com (OAuth / Gmail) · aimail.designs-os.com/beta (IMAP)

### v0.1 — The thing that works
March 2026
This started as a Python script Jed had been running locally — IMAP-based, a thousand lines, good for one person on one machine. The question was: can this be a real product?
Webby's first call was to kill IMAP for the public track. Not because it's wrong, but because the maintenance surface on app passwords across every provider is unsustainable for a small team. Gmail API instead — OAuth-native, free, and gmail.readonly scope is exactly as narrow as it sounds. The user grants read access. We use it to fetch emails. That's the whole model.
The stack decision followed: Cloudflare Workers. No server to manage, no infrastructure to harden at the host layer, Cloudflare in front of everything. The tradeoff — IMAP is impossible in a Worker runtime — was worth it for the private Gmail track.
What shipped: Full Gmail OAuth flow. httpOnly session cookie, HMAC-SHA256 signed. Refresh token stored in Cloudflare KV — never in the browser, never in the response. gmail.readonly scope only. Batched Gmail API calls — 15 per batch, 200ms between — well inside quota. Rate limiting: 20 fetches per hour per user. Security headers: CSP, HSTS, X-Frame-Options, Permissions-Policy. Input validation on all query parameters. XSS protection on all DOM construction. Download and copy functions. Folder selection.
Webby caught SESSION_SECRET in the early draft — named, defined, documented in the environment, and completely unused. The cookie signing it was supposed to back wasn't wired. That's the kind of gap that looks fine on a read and fails on a probe. It's also the reason every security pass here starts with "what did we intend, and did we actually do it?"

### v1.1 — From address filtering and mode controls
March 2026
Three features, all driven by how people actually use an email stripper in practice.
From address chips — Filter by sender. You type an address, hit enter, it becomes a chip. Multiple chips combine as OR. The backend validates every address server-side — the frontend chip UI is UX, not security.
Sent and received merge — v0.1 fetched one folder at a time. v1.1 fetches sent and received in parallel and merges into a single chronological result. Jed asked for it; Webby asked what the deduplication logic should be when an email appears in both. Message-ID is the answer.
Mode toggle — Headers, snippet, or full body. Headers for triage. Snippet for a fast read. Full for extraction. The toggle controls what hits the output, not just what gets displayed — the download reflects the mode.
Per-session AES-GCM encryption was added this version for cached content. The encryption key is session-scoped and lives only in KV alongside the session. It doesn't survive logout.

### v1.2 — IMAP beta track
March 2026
The Gmail track requires Google OAuth verification — a process that involves privacy policy review, domain verification, a demo video, and a waiting period. While that runs, we needed a path for users who aren't on Gmail or who don't want to connect a Google account.
The answer was a second track: IMAP, running on a hardened Hetzner VPS in Helsinki. Different architecture entirely — Node/Express behind Caddy, PM2 for process management, TLS termination at the reverse proxy. The IMAP credentials are never stored. They're used to open a session, fetch what's requested, and discarded. The session model holds a token, not the password.
Webby and Jed went through three rounds of security passes on the VPS before DNS pointed at it. Host hardening first — SSH keys only, root disabled, fail2ban, unattended-upgrades. Then application hardening — no x-powered-by, rate limiting by IP+email composite key, fromAddresses server-side validation, proper error surfaces. The posture was: beta in name, production in security. Users are putting email credentials into this.
Body extraction was the hardest technical problem. The naive IMAP approach returns raw MIME — boundaries, encoded parts, charset markers. It looks like content but it isn't. Webby and Jed rebuilt extraction around mailparser/simpleParser — proper MIME parsing, QP/base64 decode, charset normalization. For emails where the plain text part is a summary and the HTML part is the real content (PayPal does this), the system compares lengths and takes whichever is longer. A unified cleanText function strips URLs, image placeholders, hex entities, and excessive whitespace as a final pass on all output regardless of source.
What shipped: Full IMAP beta at aimail.designs-os.com. Login portal with app password instructions. Server-side session management. Full body extraction with noise stripping. All features from the OAuth track mirrored. PM2-managed process with deploy alias for one-command updates. GDPR-compliant privacy policy updated to name the VPS host and explain the IMAP credential model.

This project is maintained by Jed. Webby handles planning, hardening, and oversight. Questions and issues welcome.
