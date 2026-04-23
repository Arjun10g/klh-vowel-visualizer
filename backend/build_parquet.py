"""Regenerate all_data_18Nov2023.parquet from the upstream CSV.

The parquet is the column-pruned, stress-filtered subset the backend actually
uses. Shipping the parquet (~5.5 MB) instead of the raw CSV (~88 MB) keeps
the git repo, Docker image, and HF Spaces deploy small enough to avoid LFS.

Usage:
    python -m backend.build_parquet [path/to/all_data_18Nov2023.csv]

Defaults to <repo-root>/all_data_18Nov2023.csv when no argument is given.
"""

from __future__ import annotations

import sys
from pathlib import Path

import polars as pl

from .data import DEFAULT_CSV_PATH, DEFAULT_PARQUET_PATH, USED_COLUMNS


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV_PATH
    if not src.exists():
        print(f"source CSV not found at {src}", file=sys.stderr)
        sys.exit(1)
    print(f"reading {src}")
    df = pl.read_csv(src, columns=list(USED_COLUMNS), null_values=["NA", ""])
    before = df.height
    df = df.filter(pl.col("stress") != "0")
    print(f"filtered stress==0: dropped {before - df.height} rows; final {df.height} rows")
    DEFAULT_PARQUET_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(DEFAULT_PARQUET_PATH, compression="zstd", compression_level=22)
    size_mb = DEFAULT_PARQUET_PATH.stat().st_size / 1024 / 1024
    print(f"wrote {DEFAULT_PARQUET_PATH} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
