# Verified Interview Offsets

`data/prefix_offsets.json` contains only offsets that have been independently
verified against the Kani'aina episode audio. Missing prefixes deliberately
remain unavailable in the UI rather than receiving estimated positions.

## A-KLH-HV24-057

| Corpus recording | Episode offset (seconds) | Episode offset (clock) |
| --- | ---: | --- |
| `KLH057a` | `0.0` | `0:00.000` |
| `KLH057b` | `2600.5416780045352` | `43:20.542` |

Verification: the archived Kani'aina MP3 is 82,541,504 bytes at 128 kbps,
which gives 5,158.844 seconds. The upstream `KLH057A_notes.TextGrid` and
`KLH057B_notes.TextGrid` durations sum to 5,158.843356009071 seconds. The
0.644 ms difference is below one MP3 frame, establishing that the source
recordings are concatenated in episode order with no material gap.

The Kani'aina player does not provide a documented URL parameter for seeking,
so the app displays the exact position beside its separate Open episode link.
