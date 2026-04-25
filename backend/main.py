from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .data import (
    DataStore,
    build_store,
    filter_tokens,
    metadata_payload,
    token_detail,
    tokens_payload,
)
from .contours import compute_contours
from .schemas import (
    ContoursResponse,
    GroupBy,
    MetadataResponse,
    TokenDetail,
    TokensResponse,
    TrajectoriesResponse,
    Weighting,
    WordPlotResponse,
    WordsResponse,
)
from .smoothing import compute_trajectories
from .word_plot import word_plot_payload, word_search_payload

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("klh.backend")

# Built at startup, read-only thereafter.
_store: DataStore | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _store
    _store = build_store()
    log.info(
        "DataStore ready: %d rows, prefix_offsets=%s",
        _store.df.height,
        "loaded" if _store.prefix_offsets_loaded else "missing",
    )
    yield


app = FastAPI(title="Ka Leo Hawaiʻi Vowel Visualizer API", lifespan=lifespan)

# Vite dev server runs on 5173 by default. Restrict to localhost for now.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def store() -> DataStore:
    if _store is None:
        raise HTTPException(status_code=503, detail="Data store not initialized yet")
    return _store


@app.get("/api/health")
def health() -> dict:
    s = store()
    return {
        "status": "ok",
        "rows": s.df.height,
        "prefix_offsets_loaded": s.prefix_offsets_loaded,
    }


@app.get("/api/metadata", response_model=MetadataResponse)
def metadata() -> MetadataResponse:
    return MetadataResponse(**metadata_payload(store().df))


@app.get("/api/tokens", response_model=TokensResponse)
def tokens(
    speakers: Annotated[list[str] | None, Query()] = None,
    vowels: Annotated[list[str] | None, Query()] = None,
    stresses: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int | None, Query(ge=1, le=5000)] = 500,
) -> TokensResponse:
    """Return filtered token-level formant tracks.

    `limit` caps the number of distinct tokens returned (default 500) so the
    frontend doesn't accidentally pull tens of thousands of rows during a wide
    filter selection. Pass `limit=0` semantics via omitting / setting high cap.
    """
    filtered = filter_tokens(
        store().df,
        speakers=speakers,
        vowels=vowels,
        stresses=stresses,
    )
    payload = tokens_payload(filtered, limit=limit)
    return TokensResponse(**payload)


@app.get("/api/token/{token_id:path}", response_model=TokenDetail)
def token(token_id: str) -> TokenDetail:
    s = store()
    detail = token_detail(s.df, s.prefix_offsets, token_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"token not found: {token_id}")
    return TokenDetail(**detail)


@app.get("/api/words", response_model=WordsResponse)
def words(
    q: Annotated[str, Query()] = "",
    speakers: Annotated[list[str] | None, Query()] = None,
    stresses: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=2000)] = 20,
) -> WordsResponse:
    """Search recorded corpus words under the active filters."""
    payload = word_search_payload(
        store().df,
        q=q,
        speakers=speakers,
        stresses=stresses,
        limit=limit,
    )
    return WordsResponse(**payload)


@app.get("/api/word-plot", response_model=WordPlotResponse)
def word_plot(
    word: Annotated[str, Query()] = "",
    speakers: Annotated[list[str] | None, Query()] = None,
    stresses: Annotated[list[str] | None, Query()] = None,
    normalize: Annotated[bool, Query()] = False,
    weighting: Annotated[Weighting, Query()] = "mean_of_means",
    smoothing: Annotated[float, Query(ge=0, le=100000)] = 500.0,
    n_eval_points: Annotated[int, Query(ge=10, le=500)] = 100,
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
) -> WordPlotResponse:
    """Return actual recorded occurrences for one corpus word."""
    payload = word_plot_payload(
        store().df,
        word=word,
        speakers=speakers,
        stresses=stresses,
        normalize=normalize,
        weighting=weighting,
        smoothing=smoothing,
        n_eval_points=n_eval_points,
        limit=limit,
    )
    return WordPlotResponse(**payload)


@app.get("/api/trajectories", response_model=TrajectoriesResponse)
def trajectories(
    speakers: Annotated[list[str] | None, Query()] = None,
    vowels: Annotated[list[str] | None, Query()] = None,
    stresses: Annotated[list[str] | None, Query()] = None,
    normalize: Annotated[bool, Query()] = False,
    group_by: Annotated[list[GroupBy] | None, Query()] = None,
    weighting: Annotated[Weighting, Query()] = "mean_of_means",
    smoothing: Annotated[float, Query(ge=0, le=100000)] = 500.0,
    n_eval_points: Annotated[int, Query(ge=10, le=500)] = 100,
) -> TrajectoriesResponse:
    """Pre-computed smoothed trajectories per group/vowel.

    `group_by` accepts multiple values (`?group_by=speaker&group_by=stress`).
    Order is preserved in the composite group_key so the frontend can rebuild it.
    """
    effective_group_by: list[GroupBy] = group_by or ["none"]
    groups = compute_trajectories(
        store().df,
        speakers=speakers,
        vowels=vowels,
        stresses=stresses,
        normalize=normalize,
        group_by=effective_group_by,
        weighting=weighting,
        smoothing=smoothing,
        n_eval_points=n_eval_points,
    )
    return TrajectoriesResponse(
        normalize=normalize,
        group_by=effective_group_by,
        weighting=weighting,
        smoothing=smoothing,
        n_eval_points=n_eval_points,
        groups=groups,
    )


@app.get("/api/contours", response_model=ContoursResponse)
def contours(
    speakers: Annotated[list[str] | None, Query()] = None,
    vowels: Annotated[list[str] | None, Query()] = None,
    stresses: Annotated[list[str] | None, Query()] = None,
    normalize: Annotated[bool, Query()] = False,
    group_by: Annotated[list[GroupBy] | None, Query()] = None,
    grid_size: Annotated[int, Query(ge=20, le=200)] = 60,
) -> ContoursResponse:
    """KDE contour grids per (group, vowel)."""
    effective_group_by: list[GroupBy] = group_by or ["none"]
    groups = compute_contours(
        store().df,
        speakers=speakers,
        vowels=vowels,
        stresses=stresses,
        normalize=normalize,
        group_by=effective_group_by,
        grid_size=grid_size,
    )
    return ContoursResponse(
        normalize=normalize,
        group_by=effective_group_by,
        grid_size=grid_size,
        groups=groups,
    )


# ---- Static frontend serving ------------------------------------------------
#
# Production deploys (Docker, Hugging Face Spaces) bake the React build into
# the image and let FastAPI serve it from /. In dev, the Vite server runs on
# :5173 and proxies /api/* here, so this block stays inert (no dist dir).
#
# IMPORTANT: this MUST be appended AFTER all /api/* route registrations — the
# /{full_path:path} catch-all would otherwise shadow later API routes.
_FRONTEND_DIST = Path(os.environ.get("KLH_FRONTEND_DIST", "/app/static"))
if _FRONTEND_DIST.is_dir() and (_FRONTEND_DIST / "index.html").is_file():
    log.info("Serving frontend from %s", _FRONTEND_DIST)
    _ASSETS_DIR = _FRONTEND_DIST / "assets"
    if _ASSETS_DIR.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=_ASSETS_DIR),
            name="assets",
        )

    @app.get("/", include_in_schema=False)
    def _root() -> FileResponse:
        return FileResponse(_FRONTEND_DIST / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa_fallback(full_path: str) -> FileResponse:
        if full_path.startswith(("api/", "docs", "openapi.json", "redoc")):
            raise HTTPException(status_code=404)
        candidate = _FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_FRONTEND_DIST / "index.html")
