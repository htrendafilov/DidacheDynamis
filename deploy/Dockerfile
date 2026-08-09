# Multi-stage: build the SPA, fetch the checksum-pinned KJV from CrossWire, build content.sqlite
# from the reviewed sources, then serve API + built SPA + read-only DB from one image. The KJV
# source is never committed; the DB is a reproducible build artifact.
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
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gzip libsword-utils unzip \
 && rm -rf /var/lib/apt/lists/*
COPY apps/importer/ ./importer/
COPY data/sources/ ./data/sources/
COPY scripts/fetch-kjv.sh ./scripts/fetch-kjv.sh
RUN pip install --no-cache-dir ./importer \
 && bash scripts/fetch-kjv.sh \
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

# Attribution travels with the artifact, not just the repository. content.sqlite carries texts
# whose licences require notices to accompany redistribution (TSK is CC BY 4.0; the KJV rides on
# CrossWire's grant), and an image is a redistribution — whoever pulls it may never see the repo.
COPY NOTICE ./NOTICE
COPY LICENSES/ ./LICENSES/

EXPOSE 8080
# On Render bind $PORT; N workers tuned for the VM (see backend_design §5).
CMD ["gunicorn", "app.main:app", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "4", "-b", "0.0.0.0:8080"]
