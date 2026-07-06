from __future__ import annotations

import unittest

import polars as pl

from backend.contours import compute_contours
from backend.smoothing import compute_trajectories


def formant_df(n_tokens: int = 4) -> pl.DataFrame:
    rows = []
    for speaker in ["AA", "DK"]:
        for token_idx in range(n_tokens):
            token_id = f"{speaker}|file_{token_idx}|{token_idx}"
            for time in [0.0, 1.0, 2.0, 3.0]:
                rows.append(
                    {
                        "Speaker": speaker,
                        "vowel": "ai",
                        "stress": "primary",
                        "token_id": token_id,
                        "time": time,
                        "f1": 500.0 + token_idx + time,
                        "f2": 1500.0 + token_idx + time,
                        "f1_normed": 0.1 + token_idx + time,
                        "f2_normed": 0.2 + token_idx + time,
                    }
                )
    return pl.DataFrame(rows)


class ComputeTests(unittest.TestCase):
    def test_compute_trajectories_groups_by_speaker(self) -> None:
        groups = compute_trajectories(
            formant_df(),
            speakers=None,
            vowels=["ai"],
            stresses=None,
            normalize=False,
            group_by=["speaker"],
            weighting="pooled",
            smoothing=0,
            n_eval_points=4,
        )

        self.assertEqual(len(groups), 2)
        self.assertEqual({group["dimensions"]["speaker"] for group in groups}, {"AA", "DK"})
        self.assertTrue(all(len(group["points"]) == 4 for group in groups))

    def test_compute_contours_marks_sparse_groups_as_insufficient(self) -> None:
        groups = compute_contours(
            formant_df(n_tokens=1),
            speakers=["AA"],
            vowels=["ai"],
            stresses=None,
            normalize=False,
            group_by=["none"],
            grid_size=30,
        )

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["status"], "insufficient_data")
        self.assertEqual(groups[0]["n"], 1)


if __name__ == "__main__":
    unittest.main()

