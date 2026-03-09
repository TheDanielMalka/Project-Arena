# ╔══════════════════════════════════════════════════════════════╗
# ║  ARENA Engine — Python OCR / Capture / Matcher             ║
# ╚══════════════════════════════════════════════════════════════╝

FROM python:3.12-slim

# System deps for OpenCV / Tesseract
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/screenshots /app/logs

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
