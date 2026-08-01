# Monitoring, Health Probes & Alerts

The production application is continuously monitored via HTTP readiness probes, external uptime pingers, and automated GitHub Actions alert workflows.

## Health Probe Architecture & Semantics

```mermaid
flowchart TD
    Monitor[Uptime Monitor / Monitoring Probe] --> ProbeType{Probe Endpoint}
    
    ProbeType -->|GET /health| HealthCheck[Liveness Check\nProcess Running Check]
    HealthCheck -->|Returns 200 OK| ProcessUp[Status: Healthy]

    ProbeType -->|GET /ready| ReadyCheck[Readiness Check\nProcess + SQLite DB Verification]
    ReadyCheck -->|DB Valid & Reachable| DBOK[Returns 200 OK\nStatus: Ready]
    ReadyCheck -->|DB Missing or Corrupt| DBFail[Returns 503 Service Unavailable\nStatus: Unhealthy]
```

### Endpoint Definitions

| Probe Endpoint | Purpose | Checks Performed | Success Code | Failure Code |
|---|---|---|---|---|
| `GET /health` | Liveness | Verifies Python process is running | `200 OK` | Host down / Process dead |
| `GET /ready` | Readiness | Verifies DB availability, schema version, and content checksums | `200 OK` | `503 Service Unavailable` |

> [!IMPORTANT]
> External uptime monitors (such as UptimeRobot) **must probe `/ready`** rather than `/health`. This ensures alerts trigger if the database becomes corrupted, unreadable, or missing.

## Monitoring Infrastructure

1. **UptimeRobot (Primary)**:
   - Currently probes `https://bible.trendafilovi.net/health` every 5 minutes.
   - It should be changed to `/ready` so database failures are detected as well.
   - Email delivery still requires verification of the configured alert contact.

2. **GitHub Actions Uptime Workflow (Secondary)**:
   - File: [`.github/workflows/uptime.yml`](../../.github/workflows/uptime.yml).
   - Probes both public endpoints every 90 minutes with retries.
   - Automatically opens a deduplicated **`outage`** GitHub issue when probes fail, and closes it upon recovery.

3. **Deployment Workflow (manual container path)**:
   - [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) is manual
     (`workflow_dispatch`): it builds/pushes a commit-SHA + `latest` image to GHCR, SSHes to the VM,
     pulls with Compose, and checks readiness.
   - It intentionally does not deploy on every commit. The generic native production procedures are
     documented in this guide ([hosting options](hosting-options.md),
     [backups & rollback](backups-and-rollback.md)); live operator values stay in the private
     runbook (see [`plan/deployment/README.md`](../../plan/deployment/README.md)).
