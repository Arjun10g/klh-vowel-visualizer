"""Smoothing pipeline for vowel trajectories.

Given filtered token-level rows, this module:

1. Aggregates rows to a single (time → mean f1, mean f2) curve per group/vowel,
   using either the `mean_of_means` (per-speaker average then averaged across
   speakers — equal weight per speaker) or `pooled` (flat average across all
   rows — speakers with more tokens dominate) weighting strategy.

2. Fits `scipy.interpolate.UnivariateSpline(k=3, s=smoothing)` separately to
   f1(time) and f2(time), then evaluates each spline at `n_eval_points` evenly
   spaced times to produce the smoothed trajectory.

Per CLAUDE.md, this is the load-bearing module for the Overall Trajectories,
Individual Trajectories, and Raw Contours overlay views — keep the logic
correct here and other tabs reduce to rendering.
"""

from __future__ import annotations

import logging
from typing import Literal

import numpy as np
import polars as pl
from scipy.interpolate import UnivariateSpline

log = logging.getLogger(__name__)

Weighting = Literal["mean_of_means", "pooled"]
GroupBy = Literal["none", "speaker", "stress"]

DEFAULT_N_EVAL_POINTS = 100
# Cubic spline. A 2nd-degree poly was the original app's mistake — it can't
# represent a curve that bends back on itself, which is exactly what diphthongs
# like LV's `ai`/`ae`/`ao`/`au` do.
SPLINE_K = 3
# k=3 needs at least 4 distinct knots. Aggregated curves under that → skip
# spline and emit the raw aggregated points (rare; happens for sparse vowels).
MIN_KNOTS_FOR_SPLINE = SPLINE_K + 1


def _aggregate_one(
    rows: pl.DataFrame,
    *,
    f1_col: str,
    f2_col: str,
    weighting: Weighting,
) -> pl.DataFrame:
    """Collapse rows to (time, f1_mean, f2_mean) per group.

    For `mean_of_means`, average within speaker first to give equal weight to
    each speaker regardless of token count, then average across speakers.
    """
    if weighting == "pooled":
        return (
            rows.group_by("time")
            .agg(pl.col(f1_col).mean().alias("f1"), pl.col(f2_col).mean().alias("f2"))
            .sort("time")
        )
    # mean_of_means
    per_speaker = rows.group_by(["Speaker", "time"]).agg(
        pl.col(f1_col).mean().alias("f1_sp"),
        pl.col(f2_col).mean().alias("f2_sp"),
    )
    return (
        per_speaker.group_by("time")
        .agg(pl.col("f1_sp").mean().alias("f1"), pl.col("f2_sp").mean().alias("f2"))
        .sort("time")
    )


def _fit_and_eval(
    times: np.ndarray,
    values: np.ndarray,
    *,
    smoothing: float,
    eval_times: np.ndarray,
) -> np.ndarray:
    """Fit a cubic UnivariateSpline and evaluate it at `eval_times`.

    Falls back to linear interpolation when there aren't enough distinct knots
    for a k=3 spline (`< MIN_KNOTS_FOR_SPLINE`). `s` is the SciPy smoothing
    factor — 0 fits exactly, larger values smooth more. We pass it through
    unchanged so the UI slider has predictable semantics.
    """
    if len(times) < MIN_KNOTS_FOR_SPLINE:
        return np.interp(eval_times, times, values)
    try:
        spl = UnivariateSpline(times, values, k=SPLINE_K, s=smoothing)
        return spl(eval_times)
    except Exception as e:  # noqa: BLE001 — SciPy raises a variety
        log.warning("Spline fit failed (%s) — falling back to linear interp", e)
        return np.interp(eval_times, times, values)


def _group_key_column(group_by: GroupBy) -> str | None:
    if group_by == "speaker":
        return "Speaker"
    if group_by == "stress":
        return "stress"
    return None


def _resolve_groupings(group_by: list[GroupBy]) -> list[tuple[GroupBy, str]]:
    """Drop 'none' and dedupe; return (dim_name, dataframe_column) pairs."""
    seen: set[GroupBy] = set()
    out: list[tuple[GroupBy, str]] = []
    for g in group_by:
        if g == "none" or g in seen:
            continue
        col = _group_key_column(g)
        if col is None:
            continue
        seen.add(g)
        out.append((g, col))
    return out


def _enumerate_groups(
    df: pl.DataFrame,
    groupings: list[tuple[GroupBy, str]],
) -> list[tuple[dict[str, str], pl.DataFrame]]:
    """Walk every combination of grouping values present in `df`.

    Returns (dimensions_dict, slice) pairs. With no groupings, yields a single
    pair containing all rows under empty dimensions.
    """
    if not groupings:
        return [({}, df)]
    pairs: list[tuple[dict[str, str], pl.DataFrame]] = [({}, df)]
    for dim_name, col in groupings:
        next_pairs: list[tuple[dict[str, str], pl.DataFrame]] = []
        for dims, slice_ in pairs:
            for val in sorted(slice_.get_column(col).unique().to_list()):
                next_pairs.append(
                    ({**dims, dim_name: str(val)}, slice_.filter(pl.col(col) == val))
                )
        pairs = next_pairs
    return pairs


def _composite_key(dimensions: dict[str, str]) -> str:
    if not dimensions:
        return "all"
    # Stable order so the frontend can rebuild this composite from its own
    # known group_by sequence without depending on dict ordering.
    return "|".join(f"{v}" for _, v in sorted(dimensions.items()))


def compute_trajectories(
    df: pl.DataFrame,
    *,
    speakers: list[str] | None,
    vowels: list[str] | None,
    stresses: list[str] | None,
    normalize: bool,
    group_by: list[GroupBy],
    weighting: Weighting,
    smoothing: float,
    n_eval_points: int = DEFAULT_N_EVAL_POINTS,
) -> list[dict]:
    """Return one smoothed trajectory dict per (group_combo, vowel)."""
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
            agg = _aggregate_one(v_rows, f1_col=f1_col, f2_col=f2_col, weighting=weighting)
            if agg.height == 0:
                continue
            times = agg.get_column("time").cast(pl.Float64).to_numpy()
            f1_vals = agg.get_column("f1").to_numpy()
            f2_vals = agg.get_column("f2").to_numpy()
            t_min, t_max = float(times.min()), float(times.max())
            if t_min == t_max:
                eval_times = np.array([t_min])
                f1_smooth = np.array([float(f1_vals.mean())])
                f2_smooth = np.array([float(f2_vals.mean())])
            else:
                eval_times = np.linspace(t_min, t_max, n_eval_points)
                f1_smooth = _fit_and_eval(times, f1_vals, smoothing=smoothing, eval_times=eval_times)
                f2_smooth = _fit_and_eval(times, f2_vals, smoothing=smoothing, eval_times=eval_times)

            n_tokens = v_rows.select(pl.col("token_id")).n_unique()
            results.append(
                {
                    "group_key": _composite_key(dimensions),
                    "dimensions": dimensions,
                    "vowel": vowel,
                    "n_tokens": n_tokens,
                    "points": [
                        {"time": float(t), "f1": float(a), "f2": float(b)}
                        for t, a, b in zip(eval_times, f1_smooth, f2_smooth, strict=True)
                    ],
                }
            )
    return results
