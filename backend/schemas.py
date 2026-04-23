from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

VowelType = Literal["monophthong", "diphthong"]

MONOPHTHONGS: tuple[str, ...] = (
    "a", "ā", "e", "ē", "i", "ī", "o", "ō", "u", "ū",
)
DIPHTHONGS: tuple[str, ...] = (
    "ai", "ae", "ao", "au", "ei", "eu", "iu", "oa", "oi", "ou", "āi", "āu",
)


def classify_vowel(v: str) -> VowelType | None:
    if v in MONOPHTHONGS:
        return "monophthong"
    if v in DIPHTHONGS:
        return "diphthong"
    return None


class MetadataResponse(BaseModel):
    speakers: list[str]
    vowels: list[str]
    stresses: list[str]
    prev_sounds: list[str]
    next_sounds: list[str]
    vowel_types: dict[str, VowelType]


class TokenSample(BaseModel):
    """One time-sample row from the formant track of a single token.

    A token is identified by (Speaker, filename, word_start). One token has
    many TokenSample rows ordered by `time`.
    """

    token_id: str = Field(..., description="Stable id: '{Speaker}|{filename}|{word_start}'")
    speaker: str
    filename: str
    vowel: str
    word: str
    stress: str
    previous_sound: str | None
    next_sound: str | None
    time: float
    f1: float
    f2: float
    f1_normed: float
    f2_normed: float
    start: float
    original_order: int


class TokensResponse(BaseModel):
    n_tokens: int
    n_rows: int
    rows: list[TokenSample]


Weighting = Literal["mean_of_means", "pooled"]
GroupBy = Literal["none", "speaker", "stress"]


class TrajectoryPoint(BaseModel):
    time: float
    f1: float
    f2: float


class TrajectoryGroup(BaseModel):
    """One smoothed trajectory for a (group_key, vowel) pair.

    `dimensions` carries the grouping values (e.g. {"speaker": "AA",
    "stress": "primary"}); `group_key` is a stable composite for indexing.
    """

    group_key: str
    dimensions: dict[str, str]
    vowel: str
    n_tokens: int
    points: list[TrajectoryPoint]


class TrajectoriesResponse(BaseModel):
    normalize: bool
    group_by: list[GroupBy]
    weighting: Weighting
    smoothing: float
    n_eval_points: int
    groups: list[TrajectoryGroup]


class ContourGroup(BaseModel):
    """KDE contour grid for one (group_key, vowel) pair.

    `status="insufficient_data"` means the slice had fewer than the KDE
    threshold of tokens; the frontend should render a "Not enough data"
    placeholder for that panel/vowel.
    """

    group_key: str
    dimensions: dict[str, str]
    vowel: str
    status: Literal["ok", "insufficient_data"]
    n: int
    # Present only when status == "ok":
    x: list[float] | None = None
    y: list[float] | None = None
    z: list[list[float]] | None = None
    z_max: float | None = None


class ContoursResponse(BaseModel):
    normalize: bool
    group_by: list[GroupBy]
    grid_size: int
    groups: list[ContourGroup]


class TokenDetail(BaseModel):
    """Per-token enrichment for the right-rail panel."""

    token_id: str
    speaker: str
    filename: str
    word: str
    vowel: str
    stress: str
    previous_sound: str | None
    next_sound: str | None
    start: float
    audio_url: str
    interview_seconds: float | None = Field(
        None,
        description=(
            "Token start within the full interview audio. None when "
            "prefix_offsets.json is absent or this prefix is not in it."
        ),
    )
    interview_offset_available: bool
