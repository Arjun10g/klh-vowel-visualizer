"""2D KDE contour computation per (group, vowel).

Used by the Contours Only and Raw Contours tabs. Returns a regular x/y grid
plus density values so the frontend can drive Plotly's contour trace directly
— much simpler than shipping polygon outlines and lets the frontend tune the
number of levels client-side.

Per CLAUDE.md, groups with too few points must surface as a structured
`insufficient_data` status so the panel can say "Not enough data for contours
(N points)" instead of failing silently like the original `stat_density_2d`.
"""

from __future__ import annotations

import logging
from typing import Literal

import numpy as np
import polars as pl
from scipy.stats import gaussian_kde

from .smoothing import GroupBy, _enumerate_groups, _composite_key, _resolve_groupings

log = logging.getLogger(__name__)

# Below this many tokens we don't attempt a KDE — scipy needs >= 3 points for
# a 2D estimate, and anything < ~10 produces a wildly unreliable surface.
MIN_TOKENS_FOR_KDE = 10

DEFAULT_GRID_SIZE = 60
PADDING = 0.10

ContourStatus = Literal["ok", "insufficient_data"]


def _grid_bounds(values: np.ndarray) -> tuple[float, float]:
    lo = float(values.min())
    hi = float(values.max())
    span = hi - lo or 1.0
    return lo - span * PADDING, hi + span * PADDING


def _kde_for_group(
    rows: pl.DataFrame,
    *,
    f1_col: str,
    f2_col: str,
    grid_size: int,
) -> dict:
    """Run gaussian_kde on (f2, f1) for one (group, vowel) slice.

    Aggregates to one point per token (centroid across time) so KDE measures
    where each token "lands" rather than how its trajectory sweeps across the
    space. That matches how the original `stat_density_2d` was used in app.R
    after collapsing to per-token means.
    """
    centroids = rows.group_by("token_id").agg(
        pl.col(f1_col).mean().alias("f1c"),
        pl.col(f2_col).mean().alias("f2c"),
    )
    n = centroids.height
    if n < MIN_TOKENS_FOR_KDE:
        return {"status": "insufficient_data", "n": n}

    f1_vals = centroids.get_column("f1c").to_numpy()
    f2_vals = centroids.get_column("f2c").to_numpy()

    # KDE expects shape (d, n)
    pts = np.vstack([f2_vals, f1_vals])
    try:
        kde = gaussian_kde(pts)
    except (np.linalg.LinAlgError, ValueError) as e:
        # Singular covariance (all points collapse to a line) — surface as
        # insufficient_data rather than 500.
        log.warning("KDE failed: %s — marking insufficient_data", e)
        return {"status": "insufficient_data", "n": n}

    x_lo, x_hi = _grid_bounds(f2_vals)
    y_lo, y_hi = _grid_bounds(f1_vals)
    xs = np.linspace(x_lo, x_hi, grid_size)
    ys = np.linspace(y_lo, y_hi, grid_size)
    xx, yy = np.meshgrid(xs, ys)
    z = kde(np.vstack([xx.ravel(), yy.ravel()])).reshape(xx.shape)
    return {
        "status": "ok",
        "n": n,
        "x": xs.tolist(),
        "y": ys.tolist(),
        "z": z.tolist(),
        "z_max": float(z.max()),
    }


def compute_contours(
    df: pl.DataFrame,
    *,
    speakers: list[str] | None,
    vowels: list[str] | None,
    stresses: list[str] | None,
    normalize: bool,
    group_by: list[GroupBy],
    grid_size: int = DEFAULT_GRID_SIZE,
) -> list[dict]:
    out = df
    if speakers:
        out = out.filter(pl.col("Speaker").is_in(speakers))
    if vowels:
        out = out.filter(pl.col("vowel").is_in(vowels))
    if stresses:
        out = out.filter(pl.col("stress").is_in(stresses))

    if out.height == 0:
        return []

    f1_col = "f1_normed" if normalize else "f1"
    f2_col = "f2_normed" if normalize else "f2"

    groupings = _resolve_groupings(group_by)
    results: list[dict] = []
    for dimensions, rows in _enumerate_groups(out, groupings):
        if rows.height == 0:
            continue
        for vowel in sorted(rows.get_column("vowel").unique().to_list()):
            v_rows = rows.filter(pl.col("vowel") == vowel)
            kde_payload = _kde_for_group(
                v_rows, f1_col=f1_col, f2_col=f2_col, grid_size=grid_size
            )
            results.append(
                {
                    "group_key": _composite_key(dimensions),
                    "dimensions": dimensions,
                    "vowel": vowel,
                    **kde_payload,
                }
            )
    return results
