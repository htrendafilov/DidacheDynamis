# Deployment & Operations Guide: Overview

This guide covers deployment topology, zero-downtime release procedures, Cloudflare Tunnel configuration, backups, and monitoring for **bible_app_bg**.

## Production Topology

```mermaid
flowchart LR
    Browser([User Browser]) -->|HTTPS| CFEdge[Cloudflare Edge]
    
    subgraph Host Server [Production VM]
        CFTunnel[cloudflared Daemon] -->|HTTP 127.0.0.1:8080| Gunicorn[Gunicorn + Uvicorn Workers]
        Gunicorn --> SPA[Built SPA Assets\nreleases/ts/web_dist]
        Gunicorn --> DB[(Read-Only SQLite\ndata/content.sqlite)]
    end

    CFEdge <===>|Encrypted QUIC Tunnel| CFTunnel
```

## Core Deployment Principles

- **No Inbound Origin Ports**: Public traffic reaches the application exclusively through a Cloudflare Tunnel (`cloudflared`). The origin firewall exposes zero web ports to the public internet.
- **Atomic Release Swaps**: Web SPA releases use atomic symlink replacement (`mv -Tf`). Content database updates use atomic file replacement (`mv -f`).
- **Read-Only Storage**: The application backend holds no mutable state and writes zero data to disk at runtime.

---

## Deployment Topics

- [Hosting Options](file:///Users/hristo.trendafilov/mydev/bible_app_bg/docs/deployment/hosting-options.md) — Systemd + Gunicorn vs Docker containerization
- [Cloudflare Tunnel](file:///Users/hristo.trendafilov/mydev/bible_app_bg/docs/deployment/cloudflare-tunnel.md) — Zero Trust tunnel, origin protection & CDN caching
- [Backups & Rollbacks](file:///Users/hristo.trendafilov/mydev/bible_app_bg/docs/deployment/backups-and-rollback.md) — Atomic symlink swaps, live SQLite backups & rollback steps
- [Monitoring & Alerts](file:///Users/hristo.trendafilov/mydev/bible_app_bg/docs/deployment/monitoring-and-alerts.md) — `/health` vs `/ready` probes & UptimeRobot monitoring
