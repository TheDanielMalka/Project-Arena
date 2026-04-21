#!/bin/bash
# Generates an SSH access audit report from /var/log/auth.log
# Usage: sudo bash ssh-audit-report.sh [days]
# Example: sudo bash ssh-audit-report.sh 7   (last 7 days, default: 30)

DAYS=${1:-30}
LOG="/var/log/auth.log"
SINCE=$(date -d "$DAYS days ago" '+%b %e' 2>/dev/null || date -v-${DAYS}d '+%b %e')

echo "================================================"
echo "  Arena SSH Access Audit Report"
echo "  Host    : $(hostname)"
echo "  Period  : last ${DAYS} days (since ${SINCE})"
echo "  Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "================================================"
echo ""

echo "── Successful logins ────────────────────────────"
grep "Accepted publickey" "$LOG" | awk '{print $1, $2, $3, $9, $11}' | tail -50
echo ""

echo "── Failed login attempts (top IPs) ─────────────"
grep "Failed password\|Invalid user\|Connection closed by invalid user" "$LOG" \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' \
  | sort | uniq -c | sort -rn | head -20
echo ""

echo "── Banned IPs (fail2ban) ────────────────────────"
sudo fail2ban-client status sshd 2>/dev/null | grep -E "Banned|Total"
echo ""

echo "── authorized_keys last modified ───────────────"
stat /home/ubuntu/.ssh/authorized_keys 2>/dev/null | grep -E "Modify|Change"
echo ""

echo "── Total failed attempts ────────────────────────"
grep -c "Failed password\|Invalid user" "$LOG" 2>/dev/null || echo "0"
echo ""

echo "================================================"
echo "  End of report"
echo "================================================"
