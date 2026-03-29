#!/bin/bash

# ── DAILY SYSTEM REPORT ───────────────────────────────────────────────────────
# Companion to The Watcher. Not core — install separately if you want it.
# Delivers a daily HTML email with system health metrics:
#   disk, RAM, uptime, PM2 process status, fail2ban stats, request count.
#
# Cron: runs at 08:00 UTC daily as the aimail (app) user.
# Config: /etc/logwatcher/report.conf
#
# See INSTALL.md for setup instructions.

# ── CONFIG ───────────────────────────────────────────────────────────────────
CONFIG="/etc/logwatcher/report.conf"
if [ ! -f "$CONFIG" ]; then
  echo "Missing $CONFIG — see report.conf.example"
  exit 1
fi
source "$CONFIG"
# Expected vars: TO, FROM, SERVER_NAME, SERVER_IP
# Optional vars: COUNTER_FILE (default: /var/log/app-requests.log)
#                RESTART_FILE (default: /var/lib/app/restarts.log)

COUNTER_FILE="${COUNTER_FILE:-/var/log/app-requests.log}"
RESTART_FILE="${RESTART_FILE:-/var/lib/app/restarts.log}"

TODAY=$(date '+%Y-%m-%d')
DOW=$(date '+%A')
SUBJECT="Daily Report — ${SERVER_NAME} — $TODAY"

# ── DISK ──────────────────────────────────────────────────────────────────────
DISK_PCT=$(df / | awk 'NR==2 {printf "%.0f", $3/$2*100}')
DISK_USED_H=$(df -h / | awk 'NR==2 {print $3}')
DISK_TOTAL_H=$(df -h / | awk 'NR==2 {print $2}')

if   [ "$DISK_PCT" -ge 90 ]; then DISK_COLOR="#A32D2D"; DISK_STATUS="critical"
elif [ "$DISK_PCT" -ge 80 ]; then DISK_COLOR="#854F0B"; DISK_STATUS="warning"
elif [ "$DISK_PCT" -ge 60 ]; then DISK_COLOR="#BA7517"; DISK_STATUS="elevated"
else DISK_COLOR="#3B6D11"; DISK_STATUS="ok"
fi

# ── RAM ───────────────────────────────────────────────────────────────────────
RAM_USED=$(free -m | awk 'NR==2 {print $3}')
RAM_TOTAL=$(free -m | awk 'NR==2 {print $2}')
RAM_PCT=$(free -m | awk 'NR==2 {printf "%.0f", $3/$2*100}')

if   [ "$RAM_PCT" -ge 90 ]; then RAM_COLOR="#A32D2D"; RAM_STATUS="critical"
elif [ "$RAM_PCT" -ge 80 ]; then RAM_COLOR="#854F0B"; RAM_STATUS="warning"
elif [ "$RAM_PCT" -ge 60 ]; then RAM_COLOR="#BA7517"; RAM_STATUS="elevated"
else RAM_COLOR="#3B6D11"; RAM_STATUS="ok"
fi

# ── UPTIME ────────────────────────────────────────────────────────────────────
UPTIME=$(uptime -p | sed 's/up //')

# ── PM2 ───────────────────────────────────────────────────────────────────────
PM2_ROWS=$(pm2 jlist | python3 -c "
import sys, json
procs = [p for p in json.load(sys.stdin) if p.get('name') != 'pm2-logrotate']
for p in procs:
    name     = p['name']
    status   = p['pm2_env']['status']
    restarts = p['pm2_env']['restart_time']
    mem      = round(p['monit']['memory'] / 1024 / 1024, 1)
    s_color  = '#3B6D11' if status == 'online' else '#A32D2D'
    print(f'<tr><td style=\"padding:6px 12px 6px 0;font-family:monospace;font-size:13px;color:#444\">{name}</td><td style=\"padding:6px 12px;font-size:13px;color:{s_color};font-weight:500\">{status}</td><td style=\"padding:6px 12px;font-size:13px;color:#666\">{restarts} total</td><td style=\"padding:6px 0;font-size:13px;color:#666\">{mem} MB</td></tr>')
")

# Daily restart delta
CURRENT_RESTARTS=$(pm2 jlist | python3 -c "
import sys, json
procs = [p for p in json.load(sys.stdin) if p.get('name') != 'pm2-logrotate']
print(sum(p['pm2_env']['restart_time'] for p in procs))
")
if [ -f "$RESTART_FILE" ]; then
    PREV_RESTARTS=$(cat "$RESTART_FILE")
    DAILY_RESTARTS=$((CURRENT_RESTARTS - PREV_RESTARTS))
else
    DAILY_RESTARTS=0
fi
echo "$CURRENT_RESTARTS" > "$RESTART_FILE"

if   [ "$DAILY_RESTARTS" -ge 4 ]; then DR_COLOR="#A32D2D"
elif [ "$DAILY_RESTARTS" -ge 1 ]; then DR_COLOR="#BA7517"
else DR_COLOR="#3B6D11"
fi

# ── REQUEST COUNTER ───────────────────────────────────────────────────────────
# Optional. Wire this up if your app appends a line to COUNTER_FILE per request.
if [ -f "$COUNTER_FILE" ]; then
    REQUESTS=$(wc -l < "$COUNTER_FILE")
else
    REQUESTS=0
fi

# ── SECURITY ──────────────────────────────────────────────────────────────────
F2B_BANS=$(sudo fail2ban-client status sshd 2>/dev/null | grep 'Currently banned' | awk '{print $NF}')
F2B_BANS=${F2B_BANS:-0}

FAILED_SSH=$(grep "Failed password\|Invalid user\|authentication failure" /var/log/auth.log 2>/dev/null | grep "$(date '+%b %e')" | wc -l)
FAILED_SSH=${FAILED_SSH:-0}

LAST_BANS=$(sudo fail2ban-client status sshd 2>/dev/null | grep 'Banned IP' | sed 's/.*Banned IP list://' | tr ' ' '\n' | grep -v '^$' | tail -3 | tr '\n' ' ')
LAST_BANS=${LAST_BANS:-"none"}

if   [ "$F2B_BANS" -ge 6 ];  then BAN_COLOR="#A32D2D"
elif [ "$F2B_BANS" -ge 1 ];  then BAN_COLOR="#BA7517"
else BAN_COLOR="#3B6D11"
fi

if   [ "$FAILED_SSH" -ge 51 ]; then SSH_COLOR="#A32D2D"
elif [ "$FAILED_SSH" -ge 11 ]; then SSH_COLOR="#BA7517"
else SSH_COLOR="#3B6D11"
fi

# ── HTML EMAIL ────────────────────────────────────────────────────────────────
HTML=$(cat <<HTMLEOF
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin: 0; padding: 0; background: #f4f4f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .wrap { max-width: 580px; margin: 32px auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0ddd6; }
  .header { background: #1a1a1a; padding: 24px 28px 20px; }
  .header h1 { margin: 0; font-size: 15px; font-weight: 500; color: #ffffff; letter-spacing: 0.02em; }
  .header p { margin: 4px 0 0; font-size: 12px; color: #888; }
  .section { padding: 20px 28px; border-bottom: 1px solid #eeece6; }
  .section:last-child { border-bottom: none; }
  .section-label { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #999; margin: 0 0 14px; }
  .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .metric { background: #f8f7f3; border-radius: 6px; padding: 12px 14px; }
  .metric-label { font-size: 11px; color: #999; margin: 0 0 4px; }
  .metric-value { font-size: 22px; font-weight: 500; margin: 0; line-height: 1.1; }
  .metric-sub { font-size: 11px; color: #aaa; margin: 4px 0 0; }
  table { width: 100%; border-collapse: collapse; }
  .footer { padding: 16px 28px; background: #f8f7f3; }
  .footer p { margin: 0; font-size: 11px; color: #aaa; }
</style>
</head>
<body>
<div class="wrap">

  <div class="header">
    <h1>Daily Report — ${SERVER_NAME}</h1>
    <p>$DOW, $TODAY</p>
  </div>

  <div class="section">
    <p class="section-label">System</p>
    <div class="metric-grid">
      <div class="metric">
        <p class="metric-label">Disk usage</p>
        <p class="metric-value" style="color:$DISK_COLOR">$DISK_PCT%</p>
        <p class="metric-sub">$DISK_USED_H of $DISK_TOTAL_H &mdash; $DISK_STATUS</p>
      </div>
      <div class="metric">
        <p class="metric-label">RAM usage</p>
        <p class="metric-value" style="color:$RAM_COLOR">$RAM_PCT%</p>
        <p class="metric-sub">${RAM_USED}MB of ${RAM_TOTAL}MB &mdash; $RAM_STATUS</p>
      </div>
    </div>
    <p style="font-size:12px;color:#aaa;margin:12px 0 0">Uptime: $UPTIME</p>
  </div>

  <div class="section">
    <p class="section-label">Processes</p>
    <table>
      $PM2_ROWS
    </table>
    <p style="font-size:12px;color:$DR_COLOR;margin:12px 0 0;font-weight:500">$DAILY_RESTARTS restarts today</p>
  </div>

  <div class="section">
    <p class="section-label">Application activity</p>
    <div class="metric" style="display:inline-block;min-width:120px">
      <p class="metric-label">Requests today</p>
      <p class="metric-value" style="color:#185FA5">$REQUESTS</p>
      <p class="metric-sub">Lines in counter file</p>
    </div>
  </div>

  <div class="section">
    <p class="section-label">Security</p>
    <table>
      <tr>
        <td style="font-size:13px;color:#666;padding:5px 12px 5px 0">fail2ban bans (active)</td>
        <td style="font-size:13px;font-weight:500;color:$BAN_COLOR;padding:5px 0">$F2B_BANS</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#666;padding:5px 12px 5px 0">Failed SSH attempts today</td>
        <td style="font-size:13px;font-weight:500;color:$SSH_COLOR;padding:5px 0">$FAILED_SSH</td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#666;padding:5px 12px 5px 0;vertical-align:top">Last banned IPs</td>
        <td style="font-size:12px;color:#aaa;padding:5px 0;font-family:monospace">$LAST_BANS</td>
      </tr>
    </table>
  </div>

  <div class="footer">
    <p>Sent from ${SERVER_NAME} &nbsp;&middot;&nbsp; ${SERVER_IP}</p>
  </div>

</div>
</body>
</html>
HTMLEOF
)

# ── SEND ──────────────────────────────────────────────────────────────────────
TMPFILE=$(mktemp)
printf "To: %s\nFrom: %s\nSubject: %s\nMIME-Version: 1.0\nContent-Type: text/html; charset=utf-8\n\n" \
    "$TO" "$FROM" "$SUBJECT" > "$TMPFILE"
echo "$HTML" >> "$TMPFILE"
msmtp "$TO" < "$TMPFILE"
rm "$TMPFILE"

# ── RESET COUNTER ─────────────────────────────────────────────────────────────
> "$COUNTER_FILE"

echo "Report sent. Counter reset."
