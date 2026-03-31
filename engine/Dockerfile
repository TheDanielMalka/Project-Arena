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
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create all runtime directories the engine writes to.
# volumes in docker-compose.yml are mounted over these — they just ensure
# the paths exist when the container starts without a compose volume.
RUN mkdir -p /app/screenshots /app/evidence /app/logs

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
