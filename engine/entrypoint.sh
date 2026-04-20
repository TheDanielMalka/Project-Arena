#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Arena engine container entrypoint
#
# Runs as root just long enough to ensure the runtime directories (mounted
# from named volumes in docker-compose.yml) are writable by `appuser`, then
# drops privileges and exec's the real command.
#
# Why: docker-compose volumes from older deploys were initialized while the
# engine ran as root, so they're owned by root:root on disk. When we switch
# the container to USER appuser (uid 1000), writes fail → engine crashes →
# health check never passes. Chowning on every startup is cheap and
# idempotent; new volumes get the right ownership from the start.
# ─────────────────────────────────────────────────────────────────────────────
set -e

for dir in /app/screenshots /app/evidence /app/logs /app/uploads /app/uploads/reports; do
    mkdir -p "$dir"
    chown -R appuser:appuser "$dir" || true
done

# Re-exec the CMD (passed as "$@") as appuser. gosu preserves signals and PID 1
# semantics — unlike `su` — so uvicorn still receives SIGTERM on `docker stop`.
exec gosu appuser "$@"
