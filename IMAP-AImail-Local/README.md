# Mail Extract — Local IMAP Edition

Extract emails from Gmail as clean, AI-ready text. Runs entirely on your machine — no server, no cloud, no data leaves your computer.

Part of the [Emergence Project](https://emergence.designs-os.com/) by Design/OS. Full documentation at [emergence.designs-os.com](https://emergence.designs-os.com/).

---

## What it does

- Connects to Gmail via IMAP using an app password
- Searches by sender, keywords, date range, and folder (Inbox or All Mail)
- Strips signatures, reply chains, HTML, and URLs
- Returns clean plain text formatted for pasting into AI as context
- Displays a preview with message count, character count, and estimated token count
- One-click copy of all extracted messages

---

## Requirements

- **Node.js** 18 or later — [download here](https://nodejs.org/)
- **Git** — [download here](https://git-scm.com/)
- **Gmail account** with an **app password** — [how to create one](https://support.google.com/accounts/answer/185833)

> An app password is a 16-character code that lets apps access your Gmail without your main password. It requires 2-Step Verification to be enabled on your Google account.

---

## Setup

```bash
git clone https://github.com/jedbjorn/Emergence_Project_Public.git
cd Emergence_Project_Public/IMAP-AImail-Local
npm install
```

---

## Running the app

### macOS / Linux

```bash
node AImail.js
```

Press `Ctrl+C` to stop.

### Windows — Command Prompt or PowerShell

```cmd
node AImail.js
```

Press `Ctrl+C` to stop.

---

## Usage

1. Start the app using one of the methods above
2. Your browser opens automatically to **http://localhost:3000**
3. Enter your Gmail address and app password
4. Use the filters to search your email:
   - **Folder** — toggle between Inbox and All Mail
   - **From** — add one or more sender addresses (press Enter after each)
   - **Contains** — keyword search across subject and body
   - **Timeline** — drag the handles to set a date range
5. Click **Extract emails**
6. Click **Copy all** to copy the formatted output to your clipboard

---

## Security

- **No data leaves your machine.** The app runs entirely on localhost and connects only to `imap.gmail.com` to fetch your email.
- **Your app password is encrypted** using AES-256-GCM. The encryption key lives only in your browser cookie — the two halves are never stored together. Neither side is useful without the other.
- **A session file is written to disk** while you are signed in. It contains your email address and the encrypted password. Broswer holds the enctryption key. It is deleted only when you explicitly log out — closing the browser tab does not delete it. If the app is closed without logging out, the file persists until the session expires (2 hours of inactivity or 8 hours total).
- **Sessions expire** after 2 hours of inactivity or 8 hours total.
- **Rate limited** to 30 extractions per hour per session.
- App passwords can be revoked anytime from your [Google Account security settings](https://myaccount.google.com/apppasswords).

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port to run the server on |
| `SESSIONS_DIR` | `./sessions` | Where session files are stored |

**Custom port — macOS / Linux:**
```bash
PORT=8080 node AImail.js
```

**Custom port — Windows (PowerShell):**
```powershell
$env:PORT=8080; node AImail.js
```

**Custom port — Windows (Command Prompt):**
```cmd
set PORT=8080 && node AImail.js
```

---

## Dependencies

| Package | Purpose |
|---|---|
| [express](https://expressjs.com/) | Web server |
| [imapflow](https://imapflow.com/) | IMAP client for Gmail |
| [mailparser](https://nodemailer.com/extras/mailparser/) | Email parsing and MIME handling |

---

## Troubleshooting

**"Sign-in failed"**
- Make sure you're using an app password, not your Gmail password
- Verify 2-Step Verification is enabled on your Google account
- Check that the app password hasn't been revoked

**"Mail server timed out"**
- Check your internet connection
- Gmail IMAP may be temporarily unavailable — try again in a moment

**Port already in use**
- Another process is using port 3000. Run with `PORT=3001 node AImail.js`

**`npm install` fails with certificate errors (managed/corporate Mac)**
```bash
npm config set strict-ssl false
npm install
npm config set strict-ssl true
```

**No results found**
- Try a wider date range
- Check the sender address for typos
- Make sure the folder selection (Inbox vs All Mail) matches where the emails are

---

## License

MIT

---

Built by the Emergence Project team: Jed, Des, Ops, River, Cash, Webby, CC, Demi
