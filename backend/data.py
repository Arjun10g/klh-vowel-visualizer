from __future__ import annotations

import json
import logging
import os
import unicodedata
from pathlib import Path

import polars as pl

from .schemas import classify_vowel

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
# Prefer the column-pruned, stress-filtered parquet (~5.5MB) when present —
# 16× smaller than the raw CSV (88MB), loads ~10× faster, and ships in the
# Docker image / git repo directly. Falls back to the original CSV in dev
# when only the upstream file is on disk.
DEFAULT_PARQUET_PATH = REPO_ROOT / "all_data_18Nov2023.parquet"
DEFAULT_CSV_PATH = REPO_ROOT / "all_data_18Nov2023.csv"
DEFAULT_PREFIX_OFFSETS_PATH = REPO_ROOT / "data" / "prefix_offsets.json"
GIT_LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1"

# Subset of CSV columns we actually use. Saves memory on the 88MB file.
USED_COLUMNS: tuple[str, ...] = (
    "Speaker",
    "filename",
    "vowel",
    "word",
    "stress",
    "previous_sound",
    "next_sound",
    "time",
    "f1",
    "f2",
    "f1_normed",
    "f2_normed",
    "original_order",
    "start",
    "word_start",
)


class DataStore:
    """In-memory dataset. Loaded once at app startup."""

    df: pl.DataFrame
    prefix_offsets: dict[str, float]
    prefix_offsets_loaded: bool

    def __init__(self, df: pl.DataFrame, prefix_offsets: dict[str, float], loaded: bool) -> None:
        self.df = df
        self.prefix_offsets = prefix_offsets
        self.prefix_offsets_loaded = loaded


def _data_path() -> Path:
    """Resolve the source file. Honors KLH_DATA_PATH override, otherwise
    prefers parquet → csv in that order."""
    override = os.environ.get("KLH_DATA_PATH") or os.environ.get("KLH_CSV_PATH")
    if override:
        return Path(override)
    if DEFAULT_PARQUET_PATH.exists() and not _is_git_lfs_pointer(DEFAULT_PARQUET_PATH):
        return DEFAULT_PARQUET_PATH
    if DEFAULT_PARQUET_PATH.exists():
        log.warning(
            "%s is a Git LFS pointer, not parquet data — falling back to CSV",
            DEFAULT_PARQUET_PATH,
        )
    return DEFAULT_CSV_PATH


def _is_git_lfs_pointer(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size > 1024:
        return False
    try:
        return path.read_text(errors="ignore").startswith(GIT_LFS_POINTER_PREFIX)
    except OSError:
        return False


def _prefix_offsets_path() -> Path:
    override = os.environ.get("KLH_PREFIX_OFFSETS_PATH")
    return Path(override) if override else DEFAULT_PREFIX_OFFSETS_PATH


def normalize_word_query(value: str) -> str:
    """Normalize user/corpus words for lookup without changing display text."""
    normalized = unicodedata.normalize("NFC", value.strip())
    normalized = normalized.replace("'", "ʻ").replace("`", "ʻ").replace("’", "ʻ")
    return normalized.casefold()


def load_prefix_offsets(path: Path | None = None) -> tuple[dict[str, float], bool]:
    """Load prefix → seconds map. Returns ({}, False) when file is missing/invalid.

    Per CLAUDE.md: do not crash if the file is absent — the jump-link feature
    should silently disable instead.
    """
    target = path or _prefix_offsets_path()
    if not target.exists():
        log.warning("prefix_offsets.json not found at %s — interview jump-link disabled", target)
        return {}, False
    try:
        raw = json.loads(target.read_text())
        if not isinstance(raw, dict):
            log.error("prefix_offsets.json is not a JSON object — disabling jump-link")
            return {}, False
        offsets = {str(k): float(v) for k, v in raw.items()}
        return offsets, True
    except (json.JSONDecodeError, ValueError, OSError) as e:
        log.error("Failed to parse prefix_offsets.json: %s — disabling jump-link", e)
        return {}, False


def load_dataframe(path: Path | None = None) -> pl.DataFrame:
    """Load the formant data into a Polars DataFrame, keeping only used columns.

    Reads either parquet (preferred — pre-pruned, pre-filtered, 5.5MB) or the
    raw CSV (88MB, requires column-subset + stress filter at load time).
    Adds a stable `token_id` derived from (Speaker, filename, word_start).
    """
    target = path or _data_path()
    if target.suffix == ".parquet" and _is_git_lfs_pointer(target):
        if DEFAULT_CSV_PATH.exists():
            log.warning("%s is a Git LFS pointer — loading %s instead", target, DEFAULT_CSV_PATH)
            target = DEFAULT_CSV_PATH
        else:
            raise FileNotFoundError(
                f"{target} is a Git LFS pointer and {DEFAULT_CSV_PATH} is missing"
            )
    log.info("Loading data from %s", target)
    if target.suffix == ".parquet":
        df = pl.read_parquet(target)
    else:
        df = pl.read_csv(
            target,
            columns=list(USED_COLUMNS),
            null_values=["NA", ""],
        )
        # CSV path — apply the stress filter that's already baked into parquet.
        before = df.height
        df = df.filter(pl.col("stress") != "0")
        log.info("Filtered stress==0: dropped %d rows", before - df.height)

    df = df.with_columns(
        (
            pl.col("Speaker").cast(pl.Utf8)
            + pl.lit("|")
            + pl.col("filename").cast(pl.Utf8)
            + pl.lit("|")
            + pl.col("word_start").cast(pl.Utf8)
        ).alias("token_id"),
    )
    df = df.with_columns(
        pl.col("filename").str.split("_").list.get(0).alias("filename_prefix"),
        pl.col("word").map_elements(normalize_word_query, return_dtype=pl.Utf8).alias(
            "word_search_key"
        ),
    )
    df = df.with_columns(
        (
            pl.col("Speaker").cast(pl.Utf8)
            + pl.lit("|")
            + pl.col("filename_prefix").cast(pl.Utf8)
            + pl.lit("|")
            + pl.col("word_start").cast(pl.Utf8)
            + pl.lit("|")
            + pl.col("word").cast(pl.Utf8)
        ).alias("word_occurrence_id"),
    )
    log.info("Loaded %d rows, %d unique tokens", df.height, df.select("token_id").n_unique())
    return df


# Audio file location in the KLHData repo. Verified 2026-04-23.
# Use raw.githubusercontent.com directly (the destination of the github.com/raw
# 302 redirect) — native <audio> elements don't reliably follow cross-origin
# redirects for media, which made the audio fail silently in the browser even
# though curl could fetch it.
AUDIO_URL_BASE = "https://raw.githubusercontent.com/tkettig/KLHData/main"

# Per-speaker subfolder under {Speaker}/. Most speakers store sounds under
# output/sounds/; LV uses output_dissertation/sounds/. Verified by HEAD-checking
# every speaker against a real filename from each speaker's tokens.
SPEAKER_SOUNDS_SUBPATH: dict[str, str] = {
    "AA": "output/sounds",
    "DK": "output/sounds",
    "HM": "output/sounds",
    "IN": "output/sounds",
    "JM": "output/sounds",
    "LV": "output_dissertation/sounds",
    "RM": "output/sounds",
    "SB": "output/sounds",
}
DEFAULT_SOUNDS_SUBPATH = "output/sounds"


def audio_url(speaker: str, filename: str) -> str:
    sub = SPEAKER_SOUNDS_SUBPATH.get(speaker, DEFAULT_SOUNDS_SUBPATH)
    return f"{AUDIO_URL_BASE}/{speaker}/{sub}/{filename}.wav"


def filename_prefix(filename: str) -> str:
    """Prefix used to look up an interview offset.

    Filenames look like 'KLH057a_1805' — the underscore-prefixed segment is
    the per-utterance index, and everything before it identifies the full
    interview file.
    """
    return filename.split("_", 1)[0]


def token_detail(df: pl.DataFrame, prefix_offsets: dict[str, float], token_id: str) -> dict | None:
    """Return enriched metadata for a single token, or None if not found."""
    rows = df.filter(pl.col("token_id") == token_id)
    if rows.height == 0:
        return None
    # Token-level fields are constant across rows; pick the first.
    first = rows.head(1).to_dicts()[0]
    speaker = first["Speaker"]
    filename = first["filename"]
    prefix = filename_prefix(filename)
    offset = prefix_offsets.get(prefix)
    interview_seconds = (offset + float(first["start"])) if offset is not None else None
    return {
        "token_id": token_id,
        "speaker": speaker,
        "filename": filename,
        "word": first["word"],
        "vowel": first["vowel"],
        "stress": first["stress"],
        "previous_sound": first.get("previous_sound"),
        "next_sound": first.get("next_sound"),
        "start": float(first["start"]),
        "audio_url": audio_url(speaker, filename),
        "interview_seconds": interview_seconds,
        "interview_offset_available": offset is not None,
    }


def build_store() -> DataStore:
    df = load_dataframe()
    offsets, loaded = load_prefix_offsets()
    return DataStore(df=df, prefix_offsets=offsets, loaded=loaded)


def metadata_payload(df: pl.DataFrame) -> dict:
    speakers = sorted(df.get_column("Speaker").drop_nulls().unique().to_list())
    vowels = sorted(df.get_column("vowel").drop_nulls().unique().to_list())
    stresses = sorted(df.get_column("stress").drop_nulls().unique().to_list())
    prev_sounds = sorted(df.get_column("previous_sound").drop_nulls().unique().to_list())
    next_sounds = sorted(df.get_column("next_sound").drop_nulls().unique().to_list())
    vowel_types = {v: t for v in vowels if (t := classify_vowel(v)) is not None}
    return {
        "speakers": speakers,
        "vowels": vowels,
        "stresses": stresses,
        "prev_sounds": prev_sounds,
        "next_sounds": next_sounds,
        "vowel_types": vowel_types,
    }


def filter_tokens(
    df: pl.DataFrame,
    *,
    speakers: list[str] | None,
    vowels: list[str] | None,
    stresses: list[str] | None,
) -> pl.DataFrame:
    out = df
    if speakers:
        out = out.filter(pl.col("Speaker").is_in(speakers))
    if vowels:
        out = out.filter(pl.col("vowel").is_in(vowels))
    if stresses:
        out = out.filter(pl.col("stress").is_in(stresses))
    return out


def tokens_payload(filtered: pl.DataFrame, *, limit: int | None) -> dict:
    n_tokens = filtered.select("token_id").n_unique()
    out = filtered
    if limit is not None and n_tokens > limit:
        # Stratify across speakers so multi-speaker selections don't get
        # silently dominated by whichever speaker appears first in the CSV.
        # Each speaker contributes ceil(limit / n_speakers) tokens at most.
        speaker_ids = out.select(["Speaker", "token_id"]).unique(maintain_order=True)
        speakers = speaker_ids.get_column("Speaker").unique().to_list()
        per_speaker = max(1, limit // max(1, len(speakers)))
        keep_ids: list[str] = []
        for sp in speakers:
            ids = (
                speaker_ids.filter(pl.col("Speaker") == sp)
                .get_column("token_id")
                .head(per_speaker)
                .to_list()
            )
            keep_ids.extend(ids)
        out = out.filter(pl.col("token_id").is_in(keep_ids))
    rows = out.rename({"Speaker": "speaker"}).to_dicts()
    for row in rows:
        row["audio_url"] = audio_url(str(row["speaker"]), str(row["filename"]))
    return {"n_tokens": n_tokens, "n_rows": len(rows), "rows": rows}
