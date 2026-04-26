from __future__ import annotations

import logging
from typing import Any

import numpy as np
import polars as pl

from .data import audio_url, filter_tokens, normalize_word_query
from .schemas import Weighting
from .smoothing import DEFAULT_N_EVAL_POINTS, _aggregate_one, _fit_and_eval

log = logging.getLogger(__name__)


def _empty_word_plot(
    *,
    word: str,
    normalize: bool,
    weighting: Weighting,
    smoothing: float,
    n_eval_points: int,
) -> dict:
    return {
        "word": word,
        "normalize": normalize,
        "weighting": weighting,
        "smoothing": smoothing,
        "n_eval_points": n_eval_points,
        "n_occurrences": 0,
        "n_returned_occurrences": 0,
        "n_vowel_tokens": 0,
        "n_returned_vowel_tokens": 0,
        "occurrences": [],
        "slot_trajectories": [],
        "corpus_slot_trajectories": [],
        "speaker_slot_trajectories": [],
    }


def _match_rank(word_key: str, query_key: str) -> int | None:
    if not query_key:
        return None
    if word_key == query_key:
        return 0
    if word_key.startswith(query_key):
        return 1
    if query_key in word_key:
        return 2
    return None


def word_search_payload(
    df: pl.DataFrame,
    *,
    q: str,
    speakers: list[str] | None,
    stresses: list[str] | None,
    function_include: list[str] | None,
    function_exclude: list[str] | None,
    limit: int,
) -> dict:
    query_key = normalize_word_query(q)
    rows = filter_tokens(
        df,
        speakers=speakers,
        vowels=None,
        stresses=stresses,
        function_include=function_include,
        function_exclude=function_exclude,
    )
    if rows.height == 0:
        return {"query": q, "matches": []}

    grouped = rows.group_by(["word", "word_search_key"]).agg(
        pl.col("word_occurrence_id").n_unique().alias("n_occurrences"),
        pl.col("token_id").n_unique().alias("n_vowel_tokens"),
        pl.col("vowel").drop_nulls().unique().sort().alias("vowels"),
    )

    matches: list[dict[str, Any]] = []
    for row in grouped.to_dicts():
        rank = 0 if not query_key else _match_rank(str(row["word_search_key"]), query_key)
        if rank is None:
            continue
        matches.append(
            {
                "rank": rank,
                "word": row["word"],
                "n_occurrences": int(row["n_occurrences"]),
                "n_vowel_tokens": int(row["n_vowel_tokens"]),
                "vowels": sorted(str(v) for v in row["vowels"]),
            }
        )

    if query_key:
        matches.sort(key=lambda m: (m["rank"], -m["n_occurrences"], m["word"]))
    else:
        matches.sort(key=lambda m: m["word"])
    for match in matches:
        del match["rank"]
    return {"query": q, "matches": matches[:limit]}


def _limited_occurrence_ids(rows: pl.DataFrame, *, limit: int) -> list[str]:
    occurrence_meta = (
        rows.select(["Speaker", "word_occurrence_id", "word_start"])
        .unique(maintain_order=True)
        .sort(["Speaker", "word_start", "word_occurrence_id"])
    )
    if occurrence_meta.height <= limit:
        return [str(v) for v in occurrence_meta.get_column("word_occurrence_id").to_list()]

    speakers = occurrence_meta.get_column("Speaker").unique().sort().to_list()
    per_speaker = max(1, limit // max(1, len(speakers)))
    keep: list[str] = []
    for speaker in speakers:
        speaker_ids = (
            occurrence_meta.filter(pl.col("Speaker") == speaker)
            .get_column("word_occurrence_id")
            .head(per_speaker)
            .to_list()
        )
        keep.extend(str(v) for v in speaker_ids)

    if len(keep) < limit:
        fill = (
            occurrence_meta.filter(~pl.col("word_occurrence_id").is_in(keep))
            .get_column("word_occurrence_id")
            .head(limit - len(keep))
            .to_list()
        )
        keep.extend(str(v) for v in fill)

    return keep[:limit]


def _build_occurrences(rows: pl.DataFrame) -> list[dict]:
    sorted_rows = rows.sort(
        ["Speaker", "word_start", "start", "original_order", "time", "token_id"]
    ).to_dicts()
    by_occurrence: dict[str, dict] = {}

    for row in sorted_rows:
        occurrence_id = str(row["word_occurrence_id"])
        occurrence = by_occurrence.get(occurrence_id)
        if occurrence is None:
            occurrence = {
                "word_token_id": occurrence_id,
                "speaker": str(row["Speaker"]),
                "filename_prefix": str(row["filename_prefix"]),
                "word": str(row["word"]),
                "word_start": float(row["word_start"]),
                "vowels": [],
                "_tokens": {},
            }
            by_occurrence[occurrence_id] = occurrence

        token_id = str(row["token_id"])
        token_map = occurrence["_tokens"]
        token = token_map.get(token_id)
        if token is None:
            token = {
                "token_id": token_id,
                "filename": str(row["filename"]),
                "vowel": str(row["vowel"]),
                "stress": str(row["stress"]),
                "previous_sound": row.get("previous_sound"),
                "next_sound": row.get("next_sound"),
                "start": float(row["start"]),
                "original_order": int(row["original_order"]),
                "audio_url": audio_url(str(row["Speaker"]), str(row["filename"])),
                "samples": [],
            }
            token_map[token_id] = token

        token["samples"].append(
            {
                "time": float(row["time"]),
                "f1": float(row["f1"]),
                "f2": float(row["f2"]),
                "f1_normed": float(row["f1_normed"]),
                "f2_normed": float(row["f2_normed"]),
            }
        )

    occurrences: list[dict] = []
    for occurrence in by_occurrence.values():
        tokens = list(occurrence["_tokens"].values())
        for token in tokens:
            token["samples"].sort(key=lambda sample: sample["time"])
        tokens.sort(
            key=lambda token: (
                float(token["start"]),
                int(token["original_order"]),
                token["filename"],
                token["token_id"],
            )
        )
        del occurrence["_tokens"]
        occurrence["vowels"] = tokens
        occurrences.append(occurrence)

    occurrences.sort(
        key=lambda occurrence: (
            occurrence["speaker"],
            occurrence["word_start"],
            occurrence["word_token_id"],
        )
    )
    return occurrences


def _slot_trajectories(
    occurrences: list[dict],
    *,
    normalize: bool,
    weighting: Weighting,
    smoothing: float,
    n_eval_points: int,
) -> list[dict]:
    grouped_rows: dict[tuple[int, str], list[dict[str, Any]]] = {}
    token_ids: dict[tuple[int, str], set[str]] = {}
    f1_key = "f1_normed" if normalize else "f1"
    f2_key = "f2_normed" if normalize else "f2"

    for occurrence in occurrences:
        speaker = occurrence["speaker"]
        for slot, token in enumerate(occurrence["vowels"], start=1):
            key = (slot, token["vowel"])
            token_ids.setdefault(key, set()).add(token["token_id"])
            rows = grouped_rows.setdefault(key, [])
            for sample in token["samples"]:
                rows.append(
                    {
                        "Speaker": speaker,
                        "time": sample["time"],
                        "f1": sample[f1_key],
                        "f2": sample[f2_key],
                    }
                )

    trajectories: list[dict] = []
    for (slot, vowel), rows in sorted(grouped_rows.items(), key=lambda item: item[0]):
        if not rows:
            continue
        frame = pl.DataFrame(rows)
        agg = _aggregate_one(frame, f1_col="f1", f2_col="f2", weighting=weighting)
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
            f1_smooth = _fit_and_eval(
                times, f1_vals, smoothing=smoothing, eval_times=eval_times
            )
            f2_smooth = _fit_and_eval(
                times, f2_vals, smoothing=smoothing, eval_times=eval_times
            )
        trajectories.append(
            {
                "slot": slot,
                "vowel": vowel,
                "n_tokens": len(token_ids.get((slot, vowel), set())),
                "points": [
                    {"time": float(t), "f1": float(f1), "f2": float(f2)}
                    for t, f1, f2 in zip(eval_times, f1_smooth, f2_smooth, strict=True)
                ],
            }
        )
    return trajectories


def _speaker_slot_trajectories(
    occurrences: list[dict],
    *,
    normalize: bool,
    weighting: Weighting,
    smoothing: float,
    n_eval_points: int,
) -> list[dict]:
    by_speaker: dict[str, list[dict]] = {}
    for occurrence in occurrences:
        by_speaker.setdefault(occurrence["speaker"], []).append(occurrence)

    out: list[dict] = []
    for speaker, speaker_occurrences in sorted(by_speaker.items()):
        for trajectory in _slot_trajectories(
            speaker_occurrences,
            normalize=normalize,
            weighting=weighting,
            smoothing=smoothing,
            n_eval_points=n_eval_points,
        ):
            out.append({"speaker": speaker, **trajectory})
    return out


def word_plot_payload(
    df: pl.DataFrame,
    *,
    word: str,
    speakers: list[str] | None,
    stresses: list[str] | None,
    function_include: list[str] | None,
    function_exclude: list[str] | None,
    normalize: bool,
    weighting: Weighting,
    smoothing: float,
    n_eval_points: int = DEFAULT_N_EVAL_POINTS,
    limit: int,
) -> dict:
    word_key = normalize_word_query(word)
    if not word_key:
        return _empty_word_plot(
            word=word,
            normalize=normalize,
            weighting=weighting,
            smoothing=smoothing,
            n_eval_points=n_eval_points,
        )

    rows = filter_tokens(
        df,
        speakers=speakers,
        vowels=None,
        stresses=stresses,
        function_include=function_include,
        function_exclude=function_exclude,
    )
    rows = rows.filter(pl.col("word_search_key") == word_key)
    if rows.height == 0:
        return _empty_word_plot(
            word=word,
            normalize=normalize,
            weighting=weighting,
            smoothing=smoothing,
            n_eval_points=n_eval_points,
        )

    display_word = str(rows.select("word").head(1).item())
    n_occurrences = rows.select("word_occurrence_id").n_unique()
    n_vowel_tokens = rows.select("token_id").n_unique()
    keep_ids = _limited_occurrence_ids(rows, limit=limit)
    limited = rows.filter(pl.col("word_occurrence_id").is_in(keep_ids))
    occurrences = _build_occurrences(limited)
    comparison_rows = filter_tokens(
        df,
        speakers=None,
        vowels=None,
        stresses=stresses,
        function_include=function_include,
        function_exclude=function_exclude,
    ).filter(
        pl.col("word_search_key") == word_key
    )
    comparison_occurrences = _build_occurrences(comparison_rows)
    return {
        "word": display_word,
        "normalize": normalize,
        "weighting": weighting,
        "smoothing": smoothing,
        "n_eval_points": n_eval_points,
        "n_occurrences": n_occurrences,
        "n_returned_occurrences": len(occurrences),
        "n_vowel_tokens": n_vowel_tokens,
        "n_returned_vowel_tokens": limited.select("token_id").n_unique(),
        "occurrences": occurrences,
        "slot_trajectories": _slot_trajectories(
            occurrences,
            normalize=normalize,
            weighting=weighting,
            smoothing=smoothing,
            n_eval_points=n_eval_points,
        ),
        "corpus_slot_trajectories": _slot_trajectories(
            comparison_occurrences,
            normalize=normalize,
            weighting=weighting,
            smoothing=smoothing,
            n_eval_points=n_eval_points,
        ),
        "speaker_slot_trajectories": _speaker_slot_trajectories(
            comparison_occurrences,
            normalize=normalize,
            weighting=weighting,
            smoothing=smoothing,
            n_eval_points=n_eval_points,
        ),
    }
