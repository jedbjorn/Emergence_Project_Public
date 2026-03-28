# ai-mail
**Extract. Strip. Export.**

ai-mail fetches your emails and returns clean, readable text — no formatting, no tracking pixels, no noise. Built for people who pipe email content into other tools: AI workflows, summarisers, archives, analysis pipelines.

**Live at [aimail.designs-os.com](https://aimail.designs-os.com)**

The first working version took three hours. Another three of testing, hardening, and iteration to get it to where it is now.

## What it does
You connect your email, set filters — sender, keyword, date range, folder, limit — and ai-mail fetches the matching emails and strips them to plain text. You get a clean download or clipboard copy. That's the whole product.

The stripping is real stripping. MIME parsing, QP/base64 decode, charset normalisation. URL removal. Image placeholder removal. Hex entity cleanup. A unified noise pass on every email regardless of source. What you get out looks like what a human would have typed.

## Two tracks
ai-mail runs two parallel architectures. They exist for different reasons and serve different users.

### Gmail track
*OAuth 2.0 · Cloudflare Workers · gmail.readonly*

Connect your Google account. No app passwords, no special configuration. The OAuth consent screen shows exactly one scope: gmail.readonly. We use it to fetch emails. That's all it does.

The backend is a Cloudflare Worker — no server to manage, Cloudflare in front of everything. Sessions are httpOnly signed cookies. Refresh tokens live in Cloudflare KV, never in the browser. Rate limited. Batched API calls to stay inside Gmail quota.

This track is in Google's OAuth verification process. While that runs, access is limited to approved test users.

### IMAP beta track
*App passwords · Node/Express · Hetzner VPS · Helsinki*

For users who aren't on Gmail, or who don't want to connect a Google account. You provide your email and an app password — the kind generated in your account security settings, not your real password. The credential is used to open an IMAP session, fetch what you asked for, and then discarded. It is not stored.

The VPS is hardened independently: SSH keys only, root login disabled, fail2ban, unattended-upgrades, Caddy as reverse proxy with TLS termination, no x-powered-by header, rate limiting, server-side input validation throughout.

## Stack

| Layer | Gmail track | IMAP beta |
|-------|-------------|-----------|
| Runtime | Cloudflare Workers (JS) | Node/Express |
| Reverse proxy | Cloudflare | Caddy |
| Session store | Cloudflare KV | In-memory (no persistence) |
| Process manager | — | PM2 |
| Host | Cloudflare | Hetzner (Helsinki) |
| Deploy | GitHub → Workers Builds | git pull + pm2 restart |

## Security posture
Both tracks were built under the same philosophy: beta in name, production in security.

The hardening work was done before DNS pointed at anything. Every session covers a security pass — not as a checklist, but as a question: what did we intend, and did we actually do it? The gap between those two things is where real risk lives.

Neither track stores email content. Credentials are never logged. Error surfaces return generic messages. The auth backend is not in this repository.

## What's in this repo
This is the public-facing portion of the project:

- **site/** — Emergence Project homepage. Static HTML. Cloudflare Pages.
- **releases/** — Full release history with rationale.

The auth backends, application logic, and hardening implementation are maintained privately.

## Coming soon
**Local version** — a Python tool that runs entirely on your machine. No server, no credentials leaving your device. Mac, Linux, and Windows. For users who want the same extraction and stripping pipeline with no network dependency.

## Built by
**Jed** — founder, Design/OS · The Emergence Project
**Webby** — AI planning and oversight shell. Design partner, security reviewer, and the voice that asks "are you sure?" before anything ships.

*Part of the Emergence Project*
