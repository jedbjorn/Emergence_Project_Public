'use strict';

const crypto         = require('crypto');
const express        = require('express');
const { ImapFlow }   = require('imapflow');
const { v4: uuidv4 } = require('uuid');
const { simpleParser } = require('mailparser');
const path           = require('path');

const app   = express();
const PORT  = process.env.PORT || 3000;
const LOCAL = true;

app.disable('x-powered-by');

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const SESSION_COOKIE    = 'sid';
const RATE_LIMIT        = 30;
const RATE_WINDOW_MS    = 60 * 60 * 1000;
const IMAP_HOST         = 'imap.gmail.com';
const IMAP_PORT         = 993;
const MAX_MESSAGES      = 200;
const ATTEMPT_RESET_MS  = 24 * 60 * 60 * 1000;
const BASE_DELAY_MS     = 5000;
const SESSION_TTL_MS      = 2 * 60 * 60 * 1000;   // 2 hours of inactivity
const SESSION_MAX_AGE_MS  = 28_800_000;            // 8 hours hard cap
const SWEEP_INTERVAL_MS   = 15 * 60 * 1000;        // 15 minutes
const IMAP_TIMEOUT_MS     = 60_000;                 // 60 seconds

const SESSION_ENC_KEY = crypto.randomBytes(32);

// ── STORES ────────────────────────────────────────────────────────────────────
const sessions      = new Map();   // sid  → session object
const loginAttempts = new Map();   // ip|email → { count, lastAttempt }
const imapSemaphores = new Map();  // sid → { active, queue }

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ limit: '20kb', extended: false }));

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

// ── REQUEST COUNTER (disabled in local mode) ─────────────────────────────────
// ── HELPERS ───────────────────────────────────────────────────────────────────

function parseCookies(req) {
  const out = {};
  const rc  = req.headers.cookie;
  if (!rc) return out;
  rc.split(';').forEach(pair => {
    const [k, ...v] = pair.split('=');
    out[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return out;
}

function getSession(req) {
  const { [SESSION_COOKIE]: sid } = parseCookies(req);
  if (!sid) return [null, null];
  const session = sessions.get(sid);
  if (!session) return [null, null];
  return [sid, session];
}

function makeClient(email, password) {
  return new ImapFlow({
    host:   IMAP_HOST,
    port:   IMAP_PORT,
    secure: true,
    auth:   { user: email, pass: password },
    logger: false,   // suppress — creds appear in debug output
  });
}

function encryptPassword(plain) {
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_ENC_KEY, iv);
  const ct  = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('hex'), ct: ct.toString('hex'), tag: tag.toString('hex') };
}

function decryptPassword(enc) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm', SESSION_ENC_KEY, Buffer.from(enc.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'hex'));
  return decipher.update(enc.ct, 'hex', 'utf8') + decipher.final('utf8');
}

function getSessionPassword(session) {
  return decryptPassword(session.encPassword);
}

function withImapTimeout(fn, client) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { client.close(); } catch (_) {}
      reject(new Error('IMAP_TIMEOUT'));
    }, IMAP_TIMEOUT_MS);
    fn().then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

function sessionCookie(sid) {
  const secure = LOCAL ? '' : ' Secure;';
  return `${SESSION_COOKIE}=${sid}; HttpOnly;${secure} SameSite=Strict; Path=/`;
}

function clearCookie() {
  const secure = LOCAL ? '' : ' Secure;';
  return `${SESSION_COOKIE}=; HttpOnly;${secure} SameSite=Strict; Path=/; Max-Age=0`;
}

// ── LOGIN ATTEMPT TRACKING ────────────────────────────────────────────────────

function getAttemptInfo(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return { count: 0 };
  if (Date.now() - entry.lastAttempt > ATTEMPT_RESET_MS) return { count: 0 };
  return entry;
}

// Delay before the Nth attempt (0-indexed count of prior failures)
// count=0 → 0ms (first ever attempt)
// count=1 → 5s, count=2 → 10s, count=3 → 20s …
function delayMs(count) {
  if (count === 0) return 0;
  return BASE_DELAY_MS * Math.pow(2, count - 1);
}

function recordFailure(ip, currentCount) {
  loginAttempts.set(ip, { count: currentCount + 1, lastAttempt: Date.now() });
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

// ── VALIDATION ────────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;

const isValidEmail = s => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);
const isValidDate  = s => typeof s === 'string' && DATE_RE.test(s) && !isNaN(Date.parse(s));

// ── TEXT EXTRACTION ───────────────────────────────────────────────────────────

function htmlToText(html) {
  let t = html;
  // Remove style and script blocks entirely
  t = t.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  // Block elements → newlines
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n');
  // Strip all remaining tags
  t = t.replace(/<[^>]+>/g, '');
  // Decode common entities
  t = t.replace(/&amp;/g,  '&')
       .replace(/&lt;/g,   '<')
       .replace(/&gt;/g,   '>')
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g,  "'")
       .replace(/&nbsp;/g, ' ')
       .replace(/&#(\d+);/g, (_, n) => {
         const cp = parseInt(n);
         if (cp === 9 || cp === 10 || cp === 13) return String.fromCharCode(cp);
         if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F)) return '';
         if (cp >= 0x200B && cp <= 0x200F) return '';
         if (cp === 0xFEFF || cp === 0xFFFE) return '';
         return String.fromCharCode(cp);
       })
       .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // Collapse excessive blank lines
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  // Trim each line and remove whitespace-only lines
  t = t.split('\n').map(l => l.trim()).filter((l, i, arr) => {
    if (l !== '') return true;
    const prev = arr[i - 1];
    return prev !== undefined && prev !== '';
  }).join('\n');
  return t.trim();
}

function isHtml(text) {
  return /<html[\s>]|<body[\s>]|<div[\s>]|<p[\s>]/i.test(text);
}

function extractText(raw) {
  if (!raw) return '';
  return isHtml(raw) ? htmlToText(raw) : raw;
}

function cleanText(text) {
  let t = text;
  // Strip URLs — bracketed first, then bare
  t = t.replace(/\[https?:\/\/[^\]]+\]/g, '');
  t = t.replace(/https?:\/\/[^\s)>\]"']+/g, '');
  // Unified line cleanup
  t = t.split('\n').map(l => l.trim()).filter((l, i, arr) => {
    if (l !== '') return true;
    const prev = arr[i - 1];
    return prev !== undefined && prev !== '';
  }).join('\n');
  return t.trim();
}

// ── STRIPPING ─────────────────────────────────────────────────────────────────

function stripSignature(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const cutAt = lines.findIndex(line => {
    const t = line.trimEnd();
    return (
      t === '-- '       ||   // RFC 2822 sig delimiter
      /^_{3,}$/.test(t) ||   // underscores
      /^={3,}$/.test(t)      // equals (common in clients)
    );
  });
  return lines.slice(0, cutAt === -1 ? lines.length : cutAt).join('\n');
}

function stripReplies(text) {
  if (!text) return '';
  const lines = text.split('\n');
  // Accumulate lines, cut at first reply indicator
  let cutAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (
      /^>/.test(t)                              ||  // quoted line
      /^-{4,}\s*Original Message/i.test(t)     ||  // Outlook style
      /^_{4,}$/.test(t)                        ||  // underline separator
      /^From:\s.+Sent:\s/i.test(t)             ||  // forwarded block (inline)
      // "On [date], [name] wrote:" — may span two lines, handle both
      /^On .{8,}wrote:\s*$/.test(t)            ||
      (i > 0 && /wrote:\s*$/.test(t) && /^On /.test(lines[i - 1] || ''))
    ) {
      cutAt = i;
      break;
    }
  }
  return lines.slice(0, cutAt === -1 ? lines.length : cutAt).join('\n');
}

function processBody(raw, folder, msgFromAddress, sessionEmail) {
  const text = extractText(raw);

  // Determine if this is the signed-in user's own sent message
  const isAllMail  = folder === '[Gmail]/All Mail';
  const isOwnMsg   = msgFromAddress && sessionEmail &&
                     msgFromAddress.toLowerCase() === sessionEmail.toLowerCase();

  // For own messages in All Mail — they are the content, don't strip replies
  // For everything else — strip replies then signatures
  let result = text;
  if (!(isAllMail && isOwnMsg)) {
    result = stripReplies(result);
  }
  result = stripSignature(result);

  return cleanText(result);
}

// ── IMAP CONCURRENCY ────────────────────────────────────────────────────────
const MAX_IMAP_CONCURRENT = 3;

function acquireImap(sid) {
  let sem = imapSemaphores.get(sid);
  if (!sem) { sem = { active: 0, queue: [] }; imapSemaphores.set(sid, sem); }
  if (sem.active < MAX_IMAP_CONCURRENT) {
    sem.active++;
    return Promise.resolve();
  }
  return new Promise(resolve => sem.queue.push(resolve));
}

function releaseImap(sid) {
  const sem = imapSemaphores.get(sid);
  if (!sem) return;
  if (sem.queue.length > 0) {
    sem.queue.shift()();
  } else {
    sem.active--;
    if (sem.active === 0) imapSemaphores.delete(sid);
  }
}

// ── BODY EXTRACTION ───────────────────────────────────────────────────────────
async function fetchMessagesForAddress(sid, email, password, folder, from, dateFrom, dateTo, sessionEmail) {
  await acquireImap(sid);
  const client  = makeClient(email, password);
  const results = [];

  try {
    await withImapTimeout(async () => {
      await client.connect();
      await client.mailboxOpen(folder);

      const since  = new Date(dateFrom);
      const before = new Date(new Date(dateTo).getTime() + 86_400_000);

      const searchCriteria = { since, before };
      if (from) searchCriteria.from = from;

      const uids = await client.search(searchCriteria, { uid: true });
      if (!uids.length) {
        await client.logout();
        return;
      }

      const capped = uids.slice(0, MAX_MESSAGES);

      for await (const msg of client.fetch(capped, {
        envelope: true,
        source:   true,
      }, { uid: true })) {
        const parsed  = await simpleParser(msg.source, { skipHtmlToText: false });
        const plainText = parsed.text || '';
        const htmlText  = parsed.html ? htmlToText(parsed.html) : '';
        const rawBody   = plainText.length >= htmlText.length ? plainText : htmlText;
        const fromAddr = msg.envelope?.from?.[0]?.address || '';
        const fromName = msg.envelope?.from?.[0]?.name    || fromAddr;

        results.push({
          uid:     msg.uid,
          subject: msg.envelope?.subject || '(no subject)',
          from:    fromName,
          date:    msg.envelope?.date?.toISOString().slice(0, 10) || '',
          body:    processBody(rawBody, folder, fromAddr, sessionEmail),
        });
      }

      await client.logout();
    }, client);
  } catch (err) {
    try { await client.logout(); } catch (_) {}
    throw err;
  } finally {
    releaseImap(sid);
  }

  return results;
}

// ── SESSION GATES ─────────────────────────────────────────────────────────────
function isSessionExpired(session) {
  const now = Date.now();
  return now - session.lastActive > SESSION_TTL_MS ||
         now - session.createdAt > SESSION_MAX_AGE_MS;
}

function requireSession(req, res, next) {
  const [sid, session] = getSession(req);
  if (!session || isSessionExpired(session)) {
    if (sid) sessions.delete(sid);
    return res.redirect('/');
  }
  session.lastActive = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  req.session = session;
  next();
}

function requireSessionApi(req, res, next) {
  const [sid, session] = getSession(req);
  if (!session || isSessionExpired(session)) {
    if (sid) sessions.delete(sid);
    return res.status(401).json({ ok: false, error: 'Unauthorised' });
  }
  session.lastActive = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  req.session = session;
  next();
}

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/login', async (req, res) => {
  const ip = req.ip;
  const { email, password } = req.body;

  // Input validation — fast fail
  if (!isValidEmail(email) || !password || typeof password !== 'string' || password.length > 128) {
    return res.status(400).json({ ok: false, error: 'invalid' });
  }

  // Enforce progressive delay — keyed by ip|email to avoid NAT lockout
  const attemptKey = ip + '|' + email.toLowerCase();
  const info = getAttemptInfo(attemptKey);
  const delay = delayMs(info.count);
  if (delay > 0) {
    const retryAfter = info.lastAttempt + delay;
    if (Date.now() < retryAfter) {
      return res.status(429).json({ ok: false, error: 'rate', retryAfter });
    }
  }

  // Attempt IMAP auth
  const client = makeClient(email, password);
  try {
    await withImapTimeout(async () => {
      await client.connect();
      await client.logout();
    }, client);
  } catch (err) {
    if (err.message === 'IMAP_TIMEOUT') {
      return res.status(504).json({ ok: false, error: 'Mail server timed out. Please try again.' });
    }
    recordFailure(attemptKey, info.count);
    return res.status(401).json({
      ok:         false,
      error:      'auth',
      retryAfter: Date.now() + delayMs(info.count + 1),
    });
  }

  // Success — clear attempt counter, create session
  clearAttempts(attemptKey);

  const sid = uuidv4();
  const encPassword = encryptPassword(password);
  sessions.set(sid, {
    sid,
    email,
    encPassword,      // AES-256-GCM encrypted, in-memory only
    createdAt:   Date.now(),
    lastActive:  Date.now(),
    fetchCount:  0,
    windowStart: Date.now(),
  });

  res.setHeader('Set-Cookie', sessionCookie(sid));
  res.json({ ok: true });
});

app.get('/app', requireSession, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/api/me', requireSessionApi, (req, res) => {
  res.json({ ok: true, email: req.session.email });
});

app.get('/api/folders', requireSessionApi, async (req, res) => {
  const { email } = req.session;
  const client = makeClient(email, getSessionPassword(req.session));
  try {
    const folders = await withImapTimeout(async () => {
      await client.connect();
      const list = await client.list();
      await client.logout();
      return list.map(f => f.path);
    }, client);
    res.json({ ok: true, folders });
  } catch (err) {
    try { await client.logout(); } catch (_) {}
    if (err.message === 'IMAP_TIMEOUT') {
      return res.status(504).json({ ok: false, error: 'Mail server timed out. Please try again.' });
    }
    res.status(500).json({ ok: false, error: 'Failed to load folders.' });
  }
});

app.post('/api/fetch', requireSessionApi, async (req, res) => {
  const session = req.session;

  // Rate limit — fixed window, resets per session
  const now = Date.now();
  if (now - session.windowStart > RATE_WINDOW_MS) {
    session.fetchCount  = 0;
    session.windowStart = now;
  }
  if (session.fetchCount >= RATE_LIMIT) {
    const resetStr = new Date(session.windowStart + RATE_WINDOW_MS)
      .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return res.status(429).json({
      ok:    false,
      error: `You've reached the limit of 20 extractions per hour. Try again after ${resetStr}.`,
    });
  }

  const { folder, fromAddresses = [], contains = '', dateFrom, dateTo } = req.body;

  if (!folder || typeof folder !== 'string' || folder.length > 100) {
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  }
  if (!Array.isArray(fromAddresses) || fromAddresses.length > 20) {
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  }
  for (const addr of fromAddresses) {
    if (typeof addr !== 'string' || addr.length > 254 || !isValidEmail(addr)) {
      return res.status(400).json({ ok: false, error: 'Invalid request.' });
    }
  }
  if (typeof contains !== 'string' || contains.length > 200) {
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  }
  if (!isValidDate(dateFrom) || !isValidDate(dateTo)) {
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  }

  session.fetchCount++;

  try {
    const seen     = new Set();
    const merged   = [];
    const notFound = [];

    if (fromAddresses.length === 0) {
      // No from filter — single search, no address tracking
      const msgs = await fetchMessagesForAddress(
        session.sid, session.email, getSessionPassword(session), folder, null, dateFrom, dateTo, session.email
      );
      msgs.forEach(m => { if (!seen.has(m.uid)) { seen.add(m.uid); merged.push(m); } });
    } else {
      // One search per address — OR semantics, deduplicate by UID
      for (const addr of fromAddresses) {
        const msgs = await fetchMessagesForAddress(
          session.sid, session.email, getSessionPassword(session), folder, addr, dateFrom, dateTo, session.email
        );
        if (msgs.length === 0) {
          notFound.push(addr);
        } else {
          msgs.forEach(m => { if (!seen.has(m.uid)) { seen.add(m.uid); merged.push(m); } });
        }
      }
    }

    // Apply contains filter (case-insensitive, across subject + body)
    const containsLower = contains.toLowerCase();
    const filtered = containsLower
      ? merged.filter(m =>
          m.subject.toLowerCase().includes(containsLower) ||
          (m.body || '').toLowerCase().includes(containsLower)
        )
      : merged;

    // Sort by date descending
    filtered.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));

    // Strip uid from response — internal only
    const messages = filtered.map(({ uid: _uid, ...rest }) => rest);

    if (messages.length === 0) {
      const hint = notFound.length > 0
        ? 'No messages found from ' + notFound.join(', ') + ' in the selected date range.'
        : 'No messages found for the selected criteria. Try a wider date range or check the sender address.';
      return res.json({ ok: true, messages: [], notFound, hint });
    }

    res.json({ ok: true, messages, notFound });
  } catch (err) {
    if (err.message === 'IMAP_TIMEOUT') {
      return res.status(504).json({ ok: false, error: 'Mail server timed out. Please try again.' });
    }
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('closed') || msg.includes('reset') || msg.includes('econnreset') || msg.includes('throttl') || msg.includes('too many') || msg.includes('bye')) {
      return res.status(429).json({ ok: false, error: 'Error. Call throttled. Try searching a smaller time window.' });
    }
    res.status(500).json({ ok: false, error: 'Failed to fetch messages.' });
  }
});

app.post('/logout', (req, res) => {
  const [sid] = getSession(req);
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
});

// ── CLEANUP SWEEP ──────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.lastActive > SESSION_TTL_MS ||
        now - session.createdAt > SESSION_MAX_AGE_MS) {
      sessions.delete(sid);
      imapSemaphores.delete(sid);
    }
  }
  for (const [key, entry] of loginAttempts) {
    if (now - entry.lastAttempt > ATTEMPT_RESET_MS) loginAttempts.delete(key);
  }
}, SWEEP_INTERVAL_MS);

// ── START ─────────────────────────────────────────────────────────────────────
const HOST = '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`aimail-beta listening on ${HOST}:${PORT}${LOCAL ? ' (local mode)' : ''}`);
});
