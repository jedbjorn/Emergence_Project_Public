# The Watcher

*He lights the Warning Beacons of Gondor.*

The Watcher is a minimal, heavily isolated security monitoring daemon for Linux servers. It watches `/var/log/auth.log` for three events — successful SSH logins from untrusted IPs, user account creation or modification, and unexpected sudo commands — and fires an out-of-band email alert the moment any of them occur.

One job. Done with discipline.

---

## What He Does

- Watches the OS, not the application. Every service running on the box gets the same protection for free.
- Fires immediately on intrusion signals — not on a slow polling cycle, not batched.
- Sends alerts out-of-band to an external email account. An attacker who owns the machine cannot suppress the notification.
- The alert includes the full log line: source IP, timestamp, key fingerprint.

**The window between intrusion and awareness: minutes.**

---

## The Isolation Model

This is what makes The Watcher different from a cron script in root's crontab.

The Watcher runs as a dedicated system user — `logwatcher` — with no shell, no sudo access, and no relationship to the application user or any other system user. He gets exactly what he needs and nothing else:

| Resource | Access | Mechanism |
|---|---|---|
| `/var/log/auth.log` | Read only | POSIX ACL scoped to that file |
| `/var/lib/logwatcher/` | Read/write | Owns the directory |
| `/etc/logwatcher/watcher.conf` | Read | System config path |
| `/etc/msmtp/logwatcher.conf` | Read | msmtp config — logwatcher has no home dir |
| Mail send (msmtp) | Execute | AppArmor local override |

The simpler path was available — add the app user to the `adm` group, two commands, done. We didn't, because:

- The app user would gain read access to all of `/var/log/`, not just `auth.log`
- An application compromise would inherit that access
- `adm` group membership is permanent and system-wide

The result: if the application is compromised, The Watcher is untouched. If The Watcher is compromised, he cannot execute commands. The two are completely independent.

---

## What He Watches

- Successful SSH logins from untrusted IPs
- User account creation or modification
- Unexpected sudo commands

---

## Design Principles

**Build at the right layer.** The Watcher doesn't know about Node.js, IMAP, or Gmail. He watches the OS. Build at the right layer and you only build it once.

**Out-of-band is non-negotiable.** Alerts sent to a local mailbox are useless when the attacker is already on the machine. The alert account must be external and MFA'd on a physical device.

**One tool, one job.** The Watcher does not also monitor disk, RAM, or process health. That is a different concern. Scope discipline is what keeps him auditable.

**No installers.** This is a how-to, not an automation script. Someone who runs a script they don't understand hasn't hardened anything. Read the guide. Understand each step. Then run the command.

---

## Stack

- **OS:** Debian / Ubuntu (tested on Debian 12)
- **Mail transport:** msmtp
- **Confinement:** AppArmor
- **Cron:** system cron (`/etc/cron.d/`) with named user execution
- **Scripts:** Bash

---

## Repository Structure

```
README.md           ← you are here
INSTALL.md          ← setup guide — ordered, with commands, with verify steps
HARDENING.md        ← the environment The Watcher lives in
/src
  watcher.sh        ← the watcher script
  daily-report.sh   ← daily system report (companion, not core)
  watcher.conf      ← config template
  msmtp.conf        ← msmtp config template
  security-watch    ← cron file for /etc/cron.d/
  apparmor-local-msmtp ← AppArmor local override for msmtp
```

---

## Origin Story

The Watcher was built for [ai-mail](https://aimail.designs-os.com) — a self-hosted email extraction tool where users put Gmail app passwords into a server we operate. *"Beta in name, production in security"* was the only acceptable posture.

The full story of how he was built, the bug that nearly meant he never worked, and why the isolation model exists is in the journal:

- [Entry 006 — Security Is a Posture](https://emergence.designs-os.com/006-security_is_a_posture) — the session where The Watcher was built
- [Entry 007 — The Watcher and His Room](https://emergence.designs-os.com/007-the_watcher_and_his_room) — the bug, the fix, and a shell that said no

HARDENING.md in this repo documents the full environment he lives in: UFW, SSH lockdown, sysctl hardening, application user isolation, session management, and the recovery chain. The Watcher is one piece of that stack. He is the piece that watches everything else.

---

## Who This Is For

You are running a Debian or Ubuntu server — a VPS, a dedicated box, a home lab machine, anything with SSH exposed and something worth protecting. You have an application on it that matters. You want to know — within minutes — if someone who isn't you gets in.

You are comfortable with the command line. You want to understand what you are deploying, not run a script and hope.

---

## Contributing

If our approach has gaps, we want to know. Open an issue.

---

*Part of the [Emergence Project](https://emergence.designs-os.com). Architecture by Jed and Webby.*
