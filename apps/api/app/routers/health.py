from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..db import database_status

router = APIRouter(tags=["infra"])


# GET + HEAD: uptime monitors (e.g. UptimeRobot) default to HEAD, and FastAPI's @get does
# not auto-allow it, so a HEAD probe would 405.
@router.api_route("/health", methods=["GET", "HEAD"])
def health() -> dict:
    """Liveness: the process is up. Stays 200 even if the content DB is missing."""
    return {"status": "ok"}


@router.api_route("/ready", methods=["GET", "HEAD"])
def ready() -> JSONResponse:
    """Readiness: 200 only when content is loaded, else 503 — so a monitor on /ready
    also catches a missing, corrupt, or schema-incompatible content database."""
    payload = database_status()
    return JSONResponse(payload, status_code=200 if payload["status"] == "ready" else 503)
