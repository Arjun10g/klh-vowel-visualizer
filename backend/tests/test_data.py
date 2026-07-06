from __future__ import annotations

from collections import Counter
import unittest

import polars as pl

from backend.data import filter_tokens, normalize_word_query, tokens_payload


def sample_df() -> pl.DataFrame:
    rows = []
    specs = [
        ("AA", "AA_file_1", "ai", "kai", "primary", 1, 10.0),
        ("AA", "AA_file_2", "ae", "maikaʻi", "unstressed", 0, 20.0),
        ("DK", "DK_file_1", "ai", "kai", "unstressed", 1, 30.0),
        ("DK", "DK_file_2", "a", "hale", "secondary", 0, 40.0),
    ]
    for original_order, (speaker, filename, vowel, word, stress, articles, start) in enumerate(specs):
        rows.append(
            {
                "Speaker": speaker,
                "filename": filename,
                "vowel": vowel,
                "word": word,
                "stress": stress,
                "previous_sound": "k",
                "next_sound": "i",
                "time": 5.0,
                "f1": 500.0 + original_order,
                "f2": 1500.0 + original_order,
                "f1_normed": 0.1 + original_order,
                "f2_normed": 0.2 + original_order,
                "start": start,
                "original_order": original_order,
                "token_id": f"{speaker}|{filename}|{start}",
                "word_search_key": normalize_word_query(word),
                "articles": articles,
            }
        )
    return pl.DataFrame(rows)


class DataFilteringTests(unittest.TestCase):
    def test_filter_tokens_combines_speaker_vowel_and_stress(self) -> None:
        out = filter_tokens(
            sample_df(),
            speakers=["DK"],
            vowels=["ai"],
            stresses=["unstressed"],
        )

        self.assertEqual(out.height, 1)
        self.assertEqual(out.item(0, "word"), "kai")

    def test_filter_tokens_supports_function_include_and_word_query(self) -> None:
        out = filter_tokens(
            sample_df(),
            speakers=None,
            vowels=None,
            stresses=None,
            function_include=["articles"],
            word_q="kai",
        )

        self.assertEqual(out.height, 2)
        self.assertEqual(set(out.get_column("Speaker").to_list()), {"AA", "DK"})

    def test_tokens_payload_round_robins_to_fill_limit(self) -> None:
        payload = tokens_payload(sample_df(), limit=3)

        self.assertEqual(payload["n_tokens"], 4)
        self.assertEqual(payload["n_rows"], 3)
        self.assertEqual(Counter(row["speaker"] for row in payload["rows"]), {"AA": 2, "DK": 1})


if __name__ == "__main__":
    unittest.main()
