#!/bin/bash

# ── SECURITY ALERT ────────────────────────────────────────────────────────────
# Called by watcher.sh when an intrusion signal is detected.
# Sends an out-of-band HTML email alert immediately.
#
# Usage: security_alert.sh "Incident type" "Full log line"

# ── CONFIG ───────────────────────────────────────────────────────────────────
CONFIG="/etc/logwatcher/watcher.conf"
if [ ! -f "$CONFIG" ]; then
  echo "Missing $CONFIG — see watcher.conf.example"
  exit 1
fi
source "$CONFIG"
# Expected vars: TO, FROM, SERVER_NAME, SERVER_IP

INCIDENT_TYPE="$1"
INCIDENT_DETAIL="$2"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
TODAY=$(date '+%Y-%m-%d')
SUBJECT="⚠ SECURITY ALERT — ${SERVER_NAME} — $TODAY"

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
  .header { background: #A32D2D; padding: 24px 28px 20px; }
  .header h1 { margin: 0; font-size: 15px; font-weight: 500; color: #ffffff; letter-spacing: 0.02em; }
  .header p { margin: 4px 0 0; font-size: 12px; color: rgba(255,255,255,0.7); }
  .section { padding: 20px 28px; border-bottom: 1px solid #eeece6; }
  .section:last-child { border-bottom: none; }
  .section-label { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #999; margin: 0 0 14px; }
  .detail { background: #f8f7f3; border-radius: 6px; padding: 14px 16px; margin: 0 0 10px; }
  .detail-label { font-size: 11px; color: #999; margin: 0 0 4px; }
  .detail-value { font-size: 14px; color: #333; margin: 0; font-family: monospace; word-break: break-all; }
  .footer { padding: 16px 28px; background: #f8f7f3; }
  .footer p { margin: 0; font-size: 11px; color: #aaa; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>Security Alert</h1>
    <p>${SERVER_NAME} &nbsp;&middot;&nbsp; $TIMESTAMP</p>
  </div>
  <div class="section">
    <p class="section-label">Incident</p>
    <div class="detail">
      <p class="detail-label">Type</p>
      <p class="detail-value">$INCIDENT_TYPE</p>
    </div>
    <div class="detail">
      <p class="detail-label">Detail</p>
      <p class="detail-value">$INCIDENT_DETAIL</p>
    </div>
    <div class="detail">
      <p class="detail-label">Timestamp</p>
      <p class="detail-value">$TIMESTAMP</p>
    </div>
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
msmtp --file=/etc/msmtp/logwatcher.conf "$TO" < "$TMPFILE"
rm "$TMPFILE"

echo "Alert sent: $INCIDENT_TYPE"
