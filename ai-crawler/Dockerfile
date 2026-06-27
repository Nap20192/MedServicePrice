# ai-crawler worker image.
# Python 3.13: crawl4ai pins lxml~=5.3, which has no wheel for 3.14.
# Build context is the repo root (see deploy/docker-compose.yml) so this Dockerfile
# can COPY the ai-crawler/ package.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# lxml build deps (fallback if no wheel) + curl for debugging.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libxml2-dev libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY ai-crawler/requirements.txt ./requirements.txt
RUN pip install --upgrade pip && pip install -r requirements.txt

# Headless Chromium for crawl4ai's browser-fallback path (+ its system libs).
RUN python -m playwright install --with-deps chromium

COPY ai-crawler/ ./

# Long-running RabbitMQ consumer. CLI (python main.py ...) still works in this image.
CMD ["python", "worker.py"]
