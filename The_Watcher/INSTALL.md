# Installing The Watcher

Debian / Ubuntu. Tested on Debian 12.

This guide assumes a fresh server with sudo access. If your SSH and firewall are already locked down, skip to [Step 3 — Create the logwatcher User](#step-3--create-the-logwatcher-user).

Read each step before you run it. That is not optional advice.

---

## Before You Start

You need:
- A server running Debian 12 or Ubuntu 22.04+
- A user with sudo access
- An external email account for alerts (Gmail works — use an app password)
- `msmtp` and `apparmor-utils` installed (covered below)

The alert account must be **external** — not hosted on the server you are protecting. An attacker who owns the machine cannot suppress an alert that goes somewhere else.

---

## Step 1 — Install Dependencies

```bash
sudo apt update
sudo apt install -y msmtp msmtp-mta apparmor-utils acl
```

Verify AppArmor is running:

```bash
sudo aa-status
```

You should see a list of loaded profiles. If AppArmor is not running, enable it:

```bash
sudo systemctl enable apparmor && sudo systemctl start apparmor
```

---

## Step 2 — Configure msmtp

msmtp handles outbound email. You will configure two msmtp configs: one for your admin user (optional, for testing) and one scoped to `logwatcher`.

Create the logwatcher msmtp config:

```bash
sudo mkdir -p /etc/msmtp
sudo nano /etc/msmtp/logwatcher.conf
```

Paste and fill in your values from `src/msmtp.conf` in this repo. The fields you must set:

- `host` — your SMTP server (e.g. `smtp.gmail.com`)
- `from` — the sending address
- `user` — your SMTP username
- `password` — your app password (not your account password)
- `to` — the alert destination address

Lock down the file:

```bash
sudo chmod 600 /etc/msmtp/logwatcher.conf
```

**Do not skip the chmod.** This file contains your app password in plaintext. Only `logwatcher` should ever read it — that is enforced in a later step.

Test msmtp before continuing:

```bash
echo "Subject: Watcher test" | msmtp --file=/etc/msmtp/logwatcher.conf your@alertaddress.com
```

You should receive the email within a minute. If you don't, check your SMTP credentials and spam folder before proceeding. There is no point wiring up The Watcher if the mail transport is broken.

---

## Step 3 — Create the logwatcher User

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin logwatcher
```

Verify:

```bash
id logwatcher
```

You should see a system UID with no groups beyond its own. No shell. No home directory. This user cannot log in and cannot execute commands beyond what is explicitly permitted.

---

## Step 4 — Set Up Watcher Directories

```bash
sudo mkdir -p /var/lib/logwatcher
sudo chown logwatcher:logwatcher /var/lib/logwatcher
sudo chmod 750 /var/lib/logwatcher

sudo mkdir -p /etc/logwatcher
```

The `/var/lib/logwatcher/` directory is where The Watcher writes his state file — the record of what he has already processed. `logwatcher` owns it. Nobody else writes to it.

---

## Step 5 — Install the Config

Copy `src/watcher.conf` from this repo to the server:

```bash
sudo cp watcher.conf /etc/logwatcher/watcher.conf
sudo nano /etc/logwatcher/watcher.conf
```

Fill in:
- `ALERT_EMAIL` — where alerts go
- `TRUSTED_IPS` — space-separated list of IPs that should not trigger alerts (your home IP, your office IP, etc.)
- `STATE_FILE` — leave as default unless you have a reason to change it
- `LOG_FILE` — leave as default

Lock it down:

```bash
sudo chown root:logwatcher /etc/logwatcher/watcher.conf
sudo chmod 640 /etc/logwatcher/watcher.conf
```

---

## Step 6 — Install the Watcher Script

```bash
sudo cp src/watcher.sh /usr/local/bin/watcher.sh
sudo chown root:root /usr/local/bin/watcher.sh
sudo chmod 755 /usr/local/bin/watcher.sh
```

---

## Step 7 — Scope the POSIX ACL

This is the step that gives The Watcher exactly one file to read and nothing else.

First, confirm ACL support is enabled on your filesystem:

```bash
sudo tune2fs -l $(findmnt -n -o SOURCE /) | grep "Default mount options"
```

You should see `acl` in the output. On most modern Debian/Ubuntu installs it is enabled by default.

Set the ACL:

```bash
sudo setfacl -m u:logwatcher:r /var/log/auth.log
```

Verify:

```bash
sudo getfacl /var/log/auth.log
```

You should see:
```
user:logwatcher:r--
```

Test it:

```bash
sudo -u logwatcher cat /var/log/auth.log | head -5
```

You should see log lines. If you see `Permission denied`, the ACL is not set correctly — do not proceed until this works.

---

## Step 8 — AppArmor Confinement

msmtp has an AppArmor profile. The default profile does not allow reads from `/etc/msmtp/` or writes to `/var/lib/logwatcher/`. You need a local override.

Copy the override from this repo:

```bash
sudo cp src/apparmor-local-msmtp /etc/apparmor.d/local/usr.bin.msmtp
```

Reload the AppArmor profile:

```bash
sudo apparmor_parser -r /etc/apparmor.d/usr.bin.msmtp
```

Verify the profile is loaded:

```bash
sudo aa-status | grep msmtp
```

You should see `msmtp` listed under enforced profiles.

---

## Step 9 — Wire the Cron Job

```bash
sudo cp src/security-watch /etc/cron.d/security-watch
sudo chown root:root /etc/cron.d/security-watch
sudo chmod 644 /etc/cron.d/security-watch
```

View the file and confirm the executing user is `logwatcher`:

```bash
cat /etc/cron.d/security-watch
```

The cron line should look like:

```
*/5 * * * * logwatcher /usr/local/bin/watcher.sh
```

The Watcher runs every five minutes as `logwatcher`. Not as root. Not as your app user.

---

## Step 10 — Test Before You Trust

This is the only non-optional step.

**Test the script directly as logwatcher:**

```bash
sudo -u logwatcher /usr/local/bin/watcher.sh
```

Check the watcher log:

```bash
sudo cat /var/lib/logwatcher/watcher.log
```

You should see a run entry. No `Permission denied`. No errors.

**Trigger a real alert:**

Log in from an IP that is not in your `TRUSTED_IPS` list — a VPN, a phone hotspot, a different network. Wait up to five minutes (one cron cycle). You should receive an email alert with the log line from that login.

If the alert does not arrive:
1. Check `/var/lib/logwatcher/watcher.log` for errors
2. Check that the msmtp config is correct (`Step 2`)
3. Check that the AppArmor override loaded correctly (`Step 8`)
4. Check spam

Do not consider The Watcher deployed until you have received a real alert. A watcher that has never fired is a watcher that might never fire.

---

## Step 11 — Persist the ACL Across Log Rotation

`/var/log/auth.log` is rotated by `logrotate`. When it rotates, the new file is created without the ACL. You need to re-apply it automatically.

Create a logrotate postrotate hook:

```bash
sudo nano /etc/logrotate.d/auth-acl
```

Contents:

```
/var/log/auth.log {
    postrotate
        setfacl -m u:logwatcher:r /var/log/auth.log
    endscript
}
```

This ensures the ACL survives every rotation. Verify by checking the logrotate config is valid:

```bash
sudo logrotate --debug /etc/logrotate.d/auth-acl
```

---

## Done

The Watcher is deployed when:

- [ ] msmtp sends mail successfully
- [ ] `logwatcher` user exists with no shell and no home
- [ ] POSIX ACL confirmed on `/var/log/auth.log`
- [ ] AppArmor profile confirmed enforced
- [ ] Cron job running as `logwatcher`
- [ ] Real alert received from an untrusted IP

All six. Not five.

---

## Optional — Daily System Report

`src/daily-report.sh` is a companion script that delivers a daily HTML email with system health metrics: disk, RAM, uptime, PM2 process status, fail2ban stats, and a request count if you are running an application with the counter wired in.

It is not part of The Watcher's core job. Install it separately if you want it. Setup instructions are in the script header.

---

*Part of the [Emergence Project](https://emergence.designs-os.com).*
