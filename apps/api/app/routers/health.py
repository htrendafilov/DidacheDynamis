from fastapi import APIRouter

from ..db import content_version

router = APIRouter(tags=["infra"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/ready")
def ready() -> dict:
    v = content_version()
    return {"status": "ready" if v else "no-content", "content_version": v}
