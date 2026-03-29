#!/bin/bash

# ── THE WATCHER ──────────────────────────────────────────────────────────────
# Watches /var/log/auth.log for:
#   - SSH logins from untrusted IPs
#   - User account creation or modification
#   - Unexpected sudo commands
#
# Fires an out-of-band email alert on any match.
# Runs as the logwatcher system user via /etc/cron.d/security-watch.
# See INSTALL.md for full setup instructions.

# ── CONFIG ───────────────────────────────────────────────────────────────────
CONFIG="/etc/logwatcher/watcher.conf"
if [ ! -f "$CONFIG" ]; then
  echo "Missing $CONFIG — see watcher.conf.example"
  exit 1
fi
source "$CONFIG"
# Expected vars from config:
#   TO            — alert destination email
#   FROM          — sending address
#   SERVER_NAME   — human-readable server name for email headers
#   SERVER_IP     — your server's IP (shown in alert footer)
#   TRUSTED_IPS   — space-separated list of trusted IPs (won't trigger alerts)
#   ALERT_SCRIPT  — full path to security_alert.sh
#   STATE_FILE    — full path to state file (default: /var/lib/logwatcher/watch.state)
#   AUTH_LOG      — full path to auth log (default: /var/log/auth.log)

STATE_FILE="${STATE_FILE:-/var/lib/logwatcher/watch.state}"
AUTH_LOG="${AUTH_LOG:-/var/log/auth.log}"

# ── GET NEW LINES SINCE LAST RUN ─────────────────────────────────────────────
if [ -f "$STATE_FILE" ]; then
    LAST_LINE=$(cat "$STATE_FILE")
else
    LAST_LINE=0
fi

TOTAL_LINES=$(wc -l < "$AUTH_LOG")

if [ "$TOTAL_LINES" -le "$LAST_LINE" ]; then
    # Log rotated or no new lines — reset
    LAST_LINE=0
fi

NEW_LINES=$(tail -n +"$((LAST_LINE + 1))" "$AUTH_LOG")
echo "$TOTAL_LINES" > "$STATE_FILE"

if [ -z "$NEW_LINES" ]; then
    exit 0
fi

# ── CHECK: SSH LOGIN FROM UNTRUSTED IP ───────────────────────────────────────
echo "$NEW_LINES" | grep "Accepted " | while read -r line; do
    SRC_IP=$(echo "$line" | grep -oP 'from \K[0-9.]+')
    TRUSTED=false
    for ip in $TRUSTED_IPS; do
        if [ "$SRC_IP" = "$ip" ]; then
            TRUSTED=true
            break
        fi
    done
    if [ "$TRUSTED" = false ]; then
        "$ALERT_SCRIPT" "SSH login from untrusted IP" "$line"
    fi
done

# ── CHECK: USER CREATION OR MODIFICATION ─────────────────────────────────────
echo "$NEW_LINES" | grep -E "useradd|usermod" | while read -r line; do
    "$ALERT_SCRIPT" "User account change" "$line"
done

# ── CHECK: SUDO COMMANDS (EXCLUDING EXPECTED SYSTEM CALLS) ───────────────────
echo "$NEW_LINES" | grep "sudo:" | grep "COMMAND=" \
    | grep -v "fail2ban-client" \
    | grep -v "logwatcher" \
    | while read -r line; do
        "$ALERT_SCRIPT" "Unexpected sudo command" "$line"
    done
