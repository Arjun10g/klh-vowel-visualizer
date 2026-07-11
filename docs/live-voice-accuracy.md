# Live Voice Accuracy

## What Changed

The Live Voice path now uses overlapping 2048-sample microphone frames (1024-sample hop), anti-aliased downsampling, and a worker-side LPC tracker. The tracker searches nearby LPC orders and formant ceilings, prefers the first two valid resonances, and rejects isolated F2/F3 swaps before they can pull the plotted trail across the vowel space.

The corpus target remains a weak tie-breaker only. It cannot overwrite a microphone-derived estimate.

## Backtest

Run the recorded-audio regression check with:

```sh
cd frontend && npm run test:live-formants
```

It downloads fixed public KLH corpus segments and compares worker-estimator traces with the nine FastTrack F1/F2 measurements included in this repository. It runs each word's vowel segments in their recorded temporal order:

| Recorded word | Speaker | F1 MAE | F2 MAE |
| --- | --- | ---: | ---: |
| `aloha` | AA | 8 Hz | 24 Hz |
| `inoa` | LV | 96 Hz | 53 Hz |
| `kauaʻi` | DK | 12 Hz | 81 Hz |
| Overall | - | 23 Hz | 41 Hz |

The script fails when aggregate F1 MAE exceeds 100 Hz or F2 MAE exceeds 120 Hz. Its frame size and hop are imported from the production capture constants, so the test cannot quietly exercise a different analysis window from the app.
It also reports mean estimator time per frame; the worker keeps this work away from Plotly and the browser's interaction thread.

## Stable Live Visuals

The microphone tracker still uses each raw LPC estimate to choose its next
candidate. A separate display-only layer applies a five-frame rolling median,
confidence-gates weak frames, and then uses an adaptive moving average. This
removes isolated pole swaps without flattening sustained vowel movement.

The UI publishes this stabilized trace at 10 Hz, uses straight line segments
to avoid spline overshoot, and keeps the vowel-space axes fixed while the mic
is active. The Live Voice tab also includes a formant-over-time plot: F1 and
F2 have separate fixed Hz axes and optional corpus target guide lines, making
the opening/closing and fronting/backing movement of a user's vowels easier to
read.

Run the deterministic display-smoothing check with:

```sh
cd frontend && npm run test:live-smoothing
```

## Scope And Limits

The upstream repository publishes vowel-segment WAVs, not complete word recordings with consonants. The full-word backtest therefore reconstructs each recorded word's vowel sequence in order; it validates movement and tracker continuity across multiple vowel segments, but does not claim to validate consonant transitions.

Results should be treated as visual-comparison guidance, not clinical acoustic measurement. Different microphones, room acoustics, vocal characteristics, and browser capture behavior can alter estimates. Silence and unvoiced intervals clear tracking state after two analysis frames so a prior vowel does not bias the next voiced segment.
