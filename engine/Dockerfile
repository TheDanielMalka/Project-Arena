# ╔══════════════════════════════════════════════════════════════╗
# ║  ARENA Engine — Python OCR / Capture / Matcher             ║
# ╚══════════════════════════════════════════════════════════════╝

FROM python:3.12-slim

# System deps for OpenCV / Tesseract
# tesseract-ocr-eng: English language data (explicit — default pkg may omit it on slim)
# libgl1 + libglib2.0-0: required by opencv-python-headless at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# build-essential + python3-dev are needed to compile web3's C extensions
# (lru-dict, ckzg). Purged after pip install to keep the image lean.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential python3-dev \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY . .

# Create all runtime directories the engine writes to.
# volumes in docker-compose.yml are mounted over these — they just ensure
# the paths exist when the container starts without a compose volume.
RUN mkdir -p /app/screenshots /app/evidence /app/logs /app/uploads/reports

# ── Run as non-root (audit 2026-04-20) ───────────────────────────────────────
# Prior to this change the engine ran as root, so any RCE (e.g. in an OCR
# or image pipeline dep) gave immediate root inside the container and a
# much bigger surface for escaping to the host.
#
# Create a system user `appuser` (uid/gid 1000 — matches the default host
# uid so docker-compose bind-mounts from the host stay readable), chown the
# paths the engine writes to at runtime, then switch to it.
#
# The named volumes defined in docker-compose.yml (arena-screenshots,
# arena-evidence, arena-engine-logs) are mounted OVER these chowned dirs.
# Docker preserves the chown on the named volume's first initialization,
# so writes still succeed after the volume mount.
RUN groupadd --system --gid 1000 appuser \
    && useradd --system --uid 1000 --gid 1000 --home-dir /app --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
