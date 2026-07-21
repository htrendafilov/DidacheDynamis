from fastapi import APIRouter

from ..db import content_version

router = APIRouter(tags=["infra"])


# GET + HEAD: uptime monitors (e.g. UptimeRobot) default to HEAD, and FastAPI's @get does
# not auto-allow it, so a HEAD probe would 405.
@router.api_route("/health", methods=["GET", "HEAD"])
def health() -> dict:
    return {"status": "ok"}


@router.api_route("/ready", methods=["GET", "HEAD"])
def ready() -> dict:
    v = content_version()
    return {"status": "ready" if v else "no-content", "content_version": v}
