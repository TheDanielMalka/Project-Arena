# ╔══════════════════════════════════════════════════════════════╗
# ║  ARENA Engine — Python OCR / Capture / Matcher             ║
# ╚══════════════════════════════════════════════════════════════╝

FROM python:3.12-slim

# System deps for OpenCV / Tesseract
# tesseract-ocr-eng: English language data (explicit — default pkg may omit it on slim)
# libgl1 + libglib2.0-0: required by opencv-python-headless at runtime
# gosu: used by entrypoint to drop privileges to appuser after runtime chown
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    libgl1 \
    libglib2.0-0 \
    gosu \
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

# ── Non-root runtime (audit 2026-04-20) ──────────────────────────────────────
# The container starts as root so the entrypoint can chown the mounted
# volumes (which may have been created by older deploys that ran the
# engine as root), then drops to `appuser` via `gosu` to execute the CMD.
# This closes the privilege-escalation surface without breaking existing
# named volumes whose on-disk ownership we can't change otherwise.
RUN groupadd --system --gid 1000 appuser \
    && useradd --system --uid 1000 --gid 1000 --home-dir /app --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
