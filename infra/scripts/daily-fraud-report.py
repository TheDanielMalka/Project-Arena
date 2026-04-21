#!/usr/bin/env python3
"""
Daily fraud report — runs via cron, queries DB directly, posts to Slack.
Installed by CI/CD deploy. Runs at 07:00 UTC every day.
"""
import json
import os
import sys
from datetime import datetime, timezone, timedelta

import httpx
import psycopg2

ENV_FILE = "/home/ubuntu/Project-Arena/.env"


def load_env(path: str) -> dict:
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    except Exception as e:
        print(f"[ERROR] Could not read .env: {e}")
        sys.exit(1)
    return env


def slack_post(webhook: str, text: str) -> None:
    try:
        httpx.post(webhook, json={"text": text}, timeout=5)
    except Exception as e:
        print(f"[WARN] Slack post failed: {e}")


def main():
    env = load_env(ENV_FILE)
    webhook = env.get("SLACK_ALERTS_WEBHOOK_URL", "")
    db_url  = env.get("DATABASE_URL", "")

    if not webhook:
        print("[WARN] SLACK_ALERTS_WEBHOOK_URL not set — exiting")
        sys.exit(0)

    if not db_url:
        print("[ERROR] DATABASE_URL not set")
        sys.exit(1)

    conn = psycopg2.connect(db_url)
    cur  = conn.cursor()

    # ── 1. High win-rate players ─────────────────────────────────────────────
    cur.execute("""
        SELECT u.username, us.win_rate, us.matches
        FROM user_stats us JOIN users u ON u.id = us.user_id
        WHERE us.win_rate > 80 AND us.matches >= 10
        ORDER BY us.win_rate DESC LIMIT 10
    """)
    high_wr = cur.fetchall()

    # ── 2. Pair farming ───────────────────────────────────────────────────────
    cur.execute("""
        SELECT u1.username, u2.username, COUNT(*) AS cnt
        FROM match_players mp1
        JOIN match_players mp2 ON mp1.match_id = mp2.match_id AND mp1.user_id < mp2.user_id
          AND mp1.user_id IS NOT NULL AND mp2.user_id IS NOT NULL
        JOIN users u1 ON u1.id = mp1.user_id
        JOIN users u2 ON u2.id = mp2.user_id
        JOIN matches m ON m.id = mp1.match_id
        WHERE m.created_at > NOW() - INTERVAL '24 hours'
        GROUP BY u1.username, u2.username
        HAVING COUNT(*) > 3
        ORDER BY cnt DESC LIMIT 10
    """)
    pairs = cur.fetchall()

    # ── 3. Recently banned ────────────────────────────────────────────────────
    cur.execute("""
        SELECT u.username, pp.offense_type, pp.banned_at
        FROM player_penalties pp JOIN users u ON u.id = pp.user_id
        WHERE pp.banned_at > NOW() - INTERVAL '24 hours'
        ORDER BY pp.banned_at DESC LIMIT 10
    """)
    banned = cur.fetchall()

    cur.close()
    conn.close()

    total = len(high_wr) + len(pairs) + len(banned)
    now   = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    if total == 0:
        slack_post(webhook, f"✅ *Daily Fraud Report* — {now}\nNo suspicious activity detected.")
        print("No findings — clean report sent to Slack.")
        return

    lines = [f"🚨 *Daily Fraud Report* — {now}\n"]

    if high_wr:
        lines.append(f"*High Win-Rate Players ({len(high_wr)}):*")
        for r in high_wr:
            lines.append(f"  • {r[0]} — {r[1]:.1f}% over {r[2]} matches")

    if pairs:
        lines.append(f"\n*Pair Farming ({len(pairs)}):*")
        for r in pairs:
            lines.append(f"  • {r[0]} + {r[1]} — {r[2]} matches together")

    if banned:
        lines.append(f"\n*Recently Banned ({len(banned)}):*")
        for r in banned:
            lines.append(f"  • {r[0]} — {r[1]}")

    slack_post(webhook, "\n".join(lines))
    print(f"Fraud report sent — {total} findings.")


if __name__ == "__main__":
    main()
