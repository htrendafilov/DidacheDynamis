# Multi-stage: build the SPA, build content.sqlite from committed public-domain sources,
# then serve API + built SPA + read-only DB from one image. No Git LFS needed — the DB is
# a reproducible build artifact.
#
# NOTE: the web + api stages activate once apps/web and apps/api land (M2). The content
# stage below is live now (M1).

# --- Stage 1: build the web SPA ---
FROM node:22-slim AS web
WORKDIR /web
ARG VITE_DROPBOX_APP_KEY=""
ENV VITE_DROPBOX_APP_KEY=${VITE_DROPBOX_APP_KEY}
# Commit SHA for the build-version stamp (no .git in this stage); CI passes github.sha.
ARG VITE_BUILD_ID=""
ENV VITE_BUILD_ID=${VITE_BUILD_ID}
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build          # outputs /web/dist

# --- Stage 2: build content.sqlite from data/sources via the importer ---
FROM python:3.13-slim AS content
WORKDIR /build
COPY apps/importer/ ./importer/
COPY data/sources/ ./data/sources/
RUN pip install --no-cache-dir ./importer \
 && mkdir -p /out \
 && bibleimport build-all --sources-dir data/sources --out /out/content.sqlite

# --- Stage 3: API runtime ---
FROM python:3.13-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    CONTENT_DB_PATH=/app/data/content.sqlite \
    API_PORT=8080

COPY apps/api/pyproject.toml apps/api/ ./api/
RUN pip install --no-cache-dir ./api gunicorn uvicorn

# Built SPA served by FastAPI StaticFiles
COPY --from=web /web/dist ./web_dist
# Read-only content database, built in the content stage
COPY --from=content /out/content.sqlite ./data/content.sqlite

EXPOSE 8080
# On Render bind $PORT; N workers tuned for the VM (see backend_design §5).
CMD ["gunicorn", "app.main:app", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "4", "-b", "0.0.0.0:8080"]
