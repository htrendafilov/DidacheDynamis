# Multi-stage: build the SPA, then serve API + built SPA from one image.
# Bakes content.sqlite into the image (immutable per content version).

# --- Stage 1: build the web SPA ---
FROM node:22-slim AS web
WORKDIR /web
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build          # outputs /web/dist

# --- Stage 2: API runtime ---
FROM python:3.13-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    CONTENT_DB_PATH=/app/data/content.sqlite \
    API_PORT=8080

COPY apps/api/pyproject.toml apps/api/ ./api/
RUN pip install --no-cache-dir ./api gunicorn uvicorn

# Built SPA served by FastAPI StaticFiles
COPY --from=web /web/dist ./web_dist
# Read-only content database (built offline by bibleimport)
COPY data/content.sqlite ./data/content.sqlite

EXPOSE 8080
# N workers tuned for the 4-vCPU VM; see backend_design §5
CMD ["gunicorn", "app.main:app", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "4", "-b", "0.0.0.0:8080"]
