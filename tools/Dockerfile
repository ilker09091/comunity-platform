# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONUTF8=1 IMPORTER_DEPLOYED=1 IMPORTER_BIND=0.0.0.0 IMPORTER_PORT=4317 \
    IMPORTER_STATE_DIR=/app/importer-state IMPORTER_SECRET_FILE=/run/circle-importer/key \
    CIRCLE_WEB_URL=http://web:3000 PLAYWRIGHT_BROWSERS_PATH=/opt/playwright PATH=/opt/venv/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tini \
    && python3 -m venv /opt/venv && rm -rf /var/lib/apt/lists/*
COPY tools/requirements-importer.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && playwright install --with-deps chromium \
    && groupadd --system --gid 1001 circle && useradd --system --uid 1001 --gid circle --home /app importer \
    && mkdir -p /app/importer-state && chown -R importer:circle /app && chmod -R a+rX /opt/playwright
COPY --chown=importer:circle tools/*.py tools/*.mjs ./tools/
COPY --chown=importer:circle index.html ./index.html
USER importer
EXPOSE 4317
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["python","tools/tiktok_importer.py"]
