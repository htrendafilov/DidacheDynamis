# Hosting & Deployment Options

`bible_app_bg` supports two production hosting strategies: **Native Systemd + Gunicorn** (current live VM setup) and **Containerized Docker Deployment**.

## Option 1: Native Systemd + Gunicorn (VM Setup)

### Current production reference

Production runs as `deploy` from `/opt/bible-app/bible-app`. The complete, current unit and operational
details are maintained in [`plan/deployment/live-runbook.md`](../../plan/deployment/live-runbook.md).
The essential service shape is:

```ini
[Unit]
Description=Bilingual Bible App FastAPI + SPA Service
After=network.target

[Service]
User=deploy
WorkingDirectory=/opt/bible-app/bible-app
ExecStart=/opt/bible-app/bible-app/.venv/bin/gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker \
  -w 3 \
  -b 127.0.0.1:8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Operational Commands
```bash
sudo systemctl status bible-app
sudo systemctl restart bible-app
sudo journalctl -u bible-app -n 100 --no-pager
```

---

## Option 2: Containerized Docker Setup

For Docker-based environments or container orchestrators, the repository includes a multi-stage
[`deploy/Dockerfile`](../../deploy/Dockerfile) and [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml).

### Docker Deployment Architecture

```mermaid
flowchart TD
    subgraph Multi-Stage Build
        Stage1[Stage 1: Web Builder\nNode 22 -> npm run build] --> Assets[dist/*]
        Stage2[Stage 2: Importer Builder\nPython 3.13 -> bibleimport build-all] --> DBArtifact[content.sqlite]
        
        Stage3[Stage 3: Production Runtime\nPython 3.13-slim + FastAPI + Gunicorn/Uvicorn]
        Assets --> Stage3
        DBArtifact --> Stage3
    end
    
    Stage3 --> Container[Running Docker Container\nPort 8080]
```

### Docker Compose Quickstart

```bash
# Build locally (the public Dropbox app key is build-time configuration)
docker build -f deploy/Dockerfile \
  --build-arg VITE_DROPBOX_APP_KEY="$DROPBOX_APP_KEY" \
  -t bible-app:local .

# Or deploy the image referenced by Compose (normally from GHCR)
IMAGE_TAG=<commit-sha> docker compose -f deploy/docker-compose.yml pull
IMAGE_TAG=<commit-sha> docker compose -f deploy/docker-compose.yml up -d

# Verify container logs
docker compose -f deploy/docker-compose.yml logs -f
```

The checked-in Compose file has an `image:` reference and no `build:` section, so `compose up
--build` does not build the repository locally.
