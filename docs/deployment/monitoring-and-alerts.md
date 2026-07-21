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
| `GET /ready` | Readiness | Verifies process + queries `content.sqlite` works table | `200 OK` | `503 Service Unavailable` |

> [!IMPORTANT]
> External uptime monitors (such as UptimeRobot) **must probe `/ready`** rather than `/health`. This ensures alerts trigger if the database becomes corrupted, unreadable, or missing.

## Monitoring Infrastructure

1. **UptimeRobot (Primary)**:
   - Probes `https://bible.trendafilovi.net/ready` every 5 minutes.
   - Triggers instant email notifications on HTTP 5xx errors or connection timeouts.

2. **GitHub Actions Uptime Workflow (Secondary)**:
   - File: [`.github/workflows/uptime.yml`](file:///Users/hristo.trendafilov/mydev/bible_app_bg/.github/workflows/uptime.yml).
   - Probes public endpoints on a scheduled cron cadence.
   - Automatically opens a deduplicated **`outage`** GitHub issue when probes fail, and closes it upon recovery.
