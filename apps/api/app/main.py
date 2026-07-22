"""FastAPI app: read-only reader API + (in prod) the built SPA.

Immutable content is cacheable: GET /api responses get an ETag (from the content version)
and Cache-Control, and honour If-None-Match with 304 — so Cloudflare/browsers serve most reads.
"""

from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse
from starlette.middleware.base import BaseHTTPMiddleware

from . import settings
from .db import content_version
from .routers import commentary, dictionary, general_books, health, passages, search, works, xrefs


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.content_version = content_version()
    yield


class CacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if not (request.method == "GET"
                and request.url.path.startswith(settings.API_V1)
                and response.status_code == 200):
            return response

        body = b""
        async for chunk in response.body_iterator:
            body += chunk

        version = getattr(request.app.state, "content_version", None) or "0"
        etag = '"' + hashlib.md5(version.encode() + body).hexdigest() + '"'  # noqa: S324
        cache_control = f"public, max-age={settings.CACHE_MAX_AGE}"
        media_type = response.headers.get("content-type", "application/json")

        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={"ETag": etag, "Cache-Control": cache_control})

        return Response(
            content=body,
            status_code=200,
            media_type=media_type,
            headers={"ETag": etag, "Cache-Control": cache_control},
        )


# Content-Security-Policy (assigned to M5): the app is now served through the Cloudflare
# Tunnel straight to this process (no Caddy in the bible path), so the app sets its own headers.
# The Dropbox token lives in sessionStorage, so lock scripts to same-origin; allow the Dropbox
# API hosts for sync (connect-src), inline data-URL images (notes), and inline styles
# (react-resizable-panels / TipTap set element style attributes).
CSP = (
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; "
    "form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; font-src 'self'; frame-src 'self'; "
    "connect-src 'self' https://api.dropboxapi.com https://content.dropboxapi.com"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("Content-Security-Policy", CSP)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        # The read-only API serves public-domain content with no auth or writes, so allow any origin
        # to fetch it (this powers the external embed.js widget). Scoped to /api so the SPA/HTML is
        # not made cross-origin readable. A literal "*" (not an echoed Origin) keeps it cacheable at
        # the Cloudflare edge without a Vary. Simple GETs need no preflight.
        if request.url.path.startswith(settings.API_V1):
            response.headers.setdefault("Access-Control-Allow-Origin", "*")
        return response


app = FastAPI(title="Bible Reader API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CacheMiddleware)
app.add_middleware(SecurityHeadersMiddleware)  # added last -> outermost -> headers on every response

app.include_router(health.router)
app.include_router(works.router)
app.include_router(passages.router)
app.include_router(search.router)
app.include_router(commentary.router)
app.include_router(dictionary.router)
app.include_router(xrefs.router)
app.include_router(general_books.router)


# Serve the built SPA in production (absent in dev, where Vite serves it).
if settings.WEB_DIST_PATH.exists():
    _INDEX = settings.WEB_DIST_PATH / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return Response(status_code=404)
        target = settings.WEB_DIST_PATH / full_path
        if full_path and target.is_file():
            return FileResponse(target)
        # Hashed build assets must 404 when missing — never fall back to index.html, or a
        # stale lazy-chunk URL (from a tab opened before a deploy) would receive HTML and fail
        # to execute as JS. A 404 lets the client detect it and reload (see main.tsx).
        if full_path.startswith("assets/"):
            return Response(status_code=404)
        return FileResponse(_INDEX)
