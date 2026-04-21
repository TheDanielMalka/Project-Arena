#!/bin/bash
# Watches ~/.ssh/authorized_keys for changes and sends a Slack alert.
# Runs as a systemd service (arena-ssh-monitor) — see infra/systemd/arena-ssh-monitor.service
# Installed automatically on every EC2 deploy via CI/CD.

KEYS_FILE="/home/ubuntu/.ssh/authorized_keys"
HASH_FILE="/var/lib/arena-ssh-monitor/keys.hash"
ENV_FILE="/home/ubuntu/Project-Arena/.env"

mkdir -p "$(dirname "$HASH_FILE")"

# Store initial hash on startup
sha256sum "$KEYS_FILE" > "$HASH_FILE" 2>/dev/null || true

send_slack() {
    WEBHOOK=$(grep -m1 'SLACK_ALERTS_WEBHOOK_URL' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    [ -z "$WEBHOOK" ] && return
    curl -s -X POST "$WEBHOOK" \
        -H 'Content-type: application/json' \
        -d "{\"text\":\"$1\"}" || true
}

inotifywait -m -e modify,create,delete,move "$KEYS_FILE" 2>/dev/null | while read -r; do
    NEW_HASH=$(sha256sum "$KEYS_FILE" 2>/dev/null | awk '{print $1}')
    OLD_HASH=$(cat "$HASH_FILE" 2>/dev/null || echo "")

    if [ "$NEW_HASH" != "$OLD_HASH" ]; then
        echo "$NEW_HASH" > "$HASH_FILE"
        send_slack "⚠️ *authorized_keys changed* on $(hostname) at $(date -u '+%Y-%m-%d %H:%M:%S UTC') — verify immediately"
    fi
done
