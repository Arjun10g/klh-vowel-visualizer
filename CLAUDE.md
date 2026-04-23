# CLAUDE.md

Project guidance for Claude Code working on the Ka Leo Hawaiʻi Vowel Visualizer rewrite.

## Project overview

This is a ground-up rewrite of an existing R/Shiny dashboard (`app.R`) that visualizes Hawaiian vowel formant data. The original is in the repo root as reference only — do not modify it, do not port its code directly. The rewrite uses a React frontend and Python backend. The goal is interactive, low-latency visualizations with correct data logic, per-token click handlers, audio playback, and text-to-speech metadata readout.

**Data source (updated):** `https://github.com/tkettig/KLHData`. This repo supersedes the older `KaLeoHawaii` repo that the original `app.R` pointed at. Do not use the old URL.

Repo layout (as of plan finalization):
- Eight speaker folders: `AA, DK, HM, IN, JM, LV, RM, SB`. These are the definitive speaker codes — the old `KLH###`-style codes in `app.R` are obsolete.
- `R_scripts/` — contains the pipeline that generates the formant data from Praat output. Read this at build start to understand the exact CSV schema being produced.
- `add_tier.praat`, `measure_f0.praat` — Praat scripts used upstream to produce the measurements. Not called by the app.

**CSV location:** `all_data_18Nov2023.csv` lives somewhere in the `KLHData` folder structure (confirmed by user). At build start, locate it and load from the raw GitHub URL. Expected path is `https://raw.githubusercontent.com/tkettig/KLHData/main/all_data_18Nov2023.csv` but verify — if it lives in a subfolder, adjust accordingly.

**Audio URL pattern:** the old pattern was `https://github.com/tkettig/KaLeoHawaii/raw/main/{Speaker}/output/sounds/{filename}.wav`. In `KLHData`, the speaker folders (`AA, DK, HM, IN, JM, LV, RM, SB`) exist at the repo root. Verify whether audio files live at `{Speaker}/output/sounds/{filename}.wav` or directly at `{Speaker}/{filename}.wav` or elsewhere before hardcoding the URL template.

Expected columns per row (one row = one time sample of one token): Speaker, filename, vowel, word, stress, previous sound, next sound, time, f1, f2, f1_normed, f2_normed, original_order, start. Column names may differ slightly — check the actual file at build time and update the Pydantic schemas to match, rather than assuming.

## Architecture

**Frontend:** React + Vite + TypeScript. Plotly.js via `react-plotly.js` for all plots. Zustand for state (one store each for filters, UI toggles, selected token). Tailwind + shadcn/ui for controls. Native `<audio>` for playback. Browser `speechSynthesis` API for TTS.

**Backend:** FastAPI. Polars preferred over Pandas for speed. SciPy for smoothing splines and KDE. Load the CSV once at startup into memory — it is small.

**Repo layout:**
```
/backend    FastAPI app, data loading, smoothing, contour computation
/frontend   React app
/data       prefix_offsets.json (interview start offsets, user-supplied)
app.R       Original Shiny app, reference only
```

## Core data logic (get this right — the original got it wrong)

These rules live in ONE function on the backend. Do not scatter them.

- `n_rendered_plots` = number of subplot panels the frontend will render. If `compare_speakers` is on and N speakers are selected, that is N plots. If off, one plot regardless of speaker count. Same pattern for separate-stress mode.
- `use_normalized = (n_rendered_plots > 1)`. Single-plot views use raw `f1`/`f2` in Hz. Multi-plot views use `f1_normed`/`f2_normed`. This is the fix for the "raw vs normalized" bug in the original.
- `weighting` parameter on `/api/trajectories`:
  - `mean_of_means` — group by speaker first, average within speaker, then average across speakers. Equal weight per speaker.
  - `pooled` — flat average across all rows. Speakers with more tokens dominate.

## API endpoints

- `GET /api/metadata` — returns `{speakers, vowels, stresses, prev_sounds, next_sounds, vowel_types}` where `vowel_types` maps each vowel to `"monophthong"` or `"diphthong"`.
- `GET /api/tokens?speakers=...&vowels=...&stresses=...` — filtered raw token-level formant tracks. One row per time sample.
- `GET /api/trajectories?speakers=...&vowels=...&stresses=...&normalize=bool&group_by=speaker|stress|none&weighting=mean_of_means|pooled&smoothing=float` — pre-computed smoothed trajectories per group.
- `GET /api/contours?...` — KDE contour polygons. When a group has too few points for a KDE, return `{status: "insufficient_data", n: X}` for that group. The frontend shows "Not enough data for contours (N points)" in that panel instead of failing silently like the original.
- `GET /api/token/{id}` — full metadata for the info panel: Speaker, filename, vowel, word, stress, previous sound, next sound, audio URL, `interview_seconds`.

## Vowel classification

- **Monophthongs:** `a, ā, e, ē, i, ī, o, ō, u, ū`
- **Diphthongs:** `ai, ae, ao, au, ei, iu, oi, ou, āi, āu`

In the Overall Trajectories tab, monophthongs render as a point + label at their mean F1/F2 position. Diphthongs render as a smoothed trajectory with an arrow at the terminus. This matches the reference chart (see `reference_lv_chart.png` in the repo root — the visual spec for single-speaker overall trajectories).

## Smoothing

Use `scipy.interpolate.UnivariateSpline` with `k=3` (cubic). Expose the smoothing parameter `s` as a slider in the UI. Default `s` must be tuned so that speaker LV's `ai`, `ae`, `ao`, `au` trajectories roughly match the reference chart. The original's `lm(f ~ poly(time, 2))` is a 2nd-degree polynomial per vowel, which physically cannot represent curves that bend back on themselves — that is the root cause of the LV misrendering. Do not reproduce it.

Labels go at the trajectory terminus (endpoint), not the midpoint. The original used `slice(floor(n()/2))` — do not copy that.

For single-speaker views, compute fixed axis ranges from the full vowel space of that speaker with ~10% padding. Do not let axes auto-fit per render — it makes the chart jump when filters change.

## Tab structure

1. **Overall Trajectories** — monophthongs as labeled points at mean; diphthongs as smoothed trajectories with terminal arrow.
2. **Individual Trajectories** — one faint line per token (opacity exposed as a slider, default higher than the original's 0.01) plus the smoothed mean on top. Click a line to select that token.
3. **Raw Contours** — KDE contours plus scatter points (opacity exposed as a slider, default higher than original). Click a point to select.
4. **Contours Only** — KDE contours with higher bin count, no points.

Each rendered plot is a separate Plotly instance, not a facet inside one plot. This is non-negotiable — it is how click handlers work when speakers or stresses are plotted separately. The original used ggplot facets in a PNG, which is why clicks only worked on the "ALL" view.

## Layout

**Left rail (persistent across tabs):**
- Speaker filter (multi-select)
- Vowel filter (multi-select)
- Stress filter (multi-select)
- Speaker toggle: segmented control labeled `Merged / Separate` (not a bare on/off switch)
- Stress toggle: segmented control with three modes: `Off / Overlay / Separate`
  - Off: overall mean, stress ignored
  - Overlay: stresses on the same plot with different line dashes (solid/dashed/dotted)
  - Separate: one subplot per stress level
- Weighting toggle: `Mean of means / Pooled`
- Opacity sliders: trajectory underlays, contour points
- Smoothing slider

**Main area:** the active tab's plot(s).

**Right rail (persistent, populates when a token is clicked):**
- Info table: Speaker, filename, vowel, word, stress, previous sound, next sound
- Audio player with default `playbackRate = 0.25` and speed selector (0.25 / 0.5 / 1.0)
- "Jump to interview" link
- TTS toggle and speed slider

The right rail is new — in the original, the info table was at the bottom of the page, disconnected from the audio player. Do not replicate that layout.

## Text-to-speech

Browser `speechSynthesis` API. Output only — no input/command recognition.

On token click, if TTS is enabled, speak: `"Speaker {Speaker}, vowel {vowel}, word {word}, {stress} stress."` Example: *"Speaker KLH013, vowel ai, word kai, primary stress."*

Controls in the right rail:
- On/off toggle
- Speed slider (0.5–1.5)
- Voice selector populated from `speechSynthesis.getVoices()`

No backend involvement. No API keys. Works offline in Chrome, Edge, Safari, Firefox.

## Interview jump link

Compute `interview_seconds = token.start + prefix_offsets[filename_prefix]` where `filename_prefix = filename.split('_')[0]`. The `prefix_offsets` lookup lives in `/data/prefix_offsets.json` and is user-supplied — it maps each filename prefix (e.g. `KLH013`) to the number of seconds from the start of the full interview audio.

If `prefix_offsets.json` is missing or a prefix is not in it, disable the link and show a tooltip: "Interview offset not available for this speaker." Do not crash.

## Build order

Do these in order. Do not skip ahead.

1. Backend skeleton: load CSV, implement `/api/metadata` and `/api/tokens`. Add `prefix_offsets.json` loader with graceful fallback when missing.
2. React skeleton: left rail with filters, Raw Contours tab only. Validate that click events fire on individual points.
3. Right rail: token click → info panel → audio player (x0.25, speed selector, jump link) → TTS.
4. Smoothing pipeline. Validate against `reference_lv_chart.png`. Do NOT build the Overall Trajectories tab before this step lands — you will have to redo the tab if the smoothing changes.
5. Overall Trajectories tab with monophthong/diphthong split and the 3-mode stress toggle.
6. Individual Trajectories tab.
7. Contours Only tab.
8. Opacity defaults tuning pass. Final polish.

## Things the original got wrong — do not repeat

- Static PNG plots with no per-point click handlers.
- Server-side re-render on every input change.
- `stat_density_2d` silently failing on sparse groups (blank panels with no message).
- Normalization logic, facet logic, and plotting logic tangled together.
- `compare_speakers` rendering duplicate panels instead of one-per-speaker.
- Empty placeholder tabs (Individual Trajectories, Raw Contours, Contours Only were all stubs).
- Labels mid-trajectory.
- 2nd-degree polynomial smoothing.
- Token info table disconnected from audio player.
- Audio defaulting to 1.0× speed.
- Opacity at 0.01, making individual trajectories invisible.

## Things to verify with the user during build

- Reference chart is in `reference_lv_chart.png`. If smoothing defaults do not visually match it for LV's `ai`, `ae`, `ao`, `au`, stop and ask.
- **Data format.** At step 1, locate `all_data_18Nov2023.csv` in the `KLHData` repo and confirm the exact column names match what the Pydantic schemas expect. If names differ, update the schemas — do not rename columns in the data.
- **Audio URL pattern in `KLHData`.** Verify by fetching one file before hardcoding the template. If it differs from `.../Speaker/output/sounds/filename.wav`, update the token endpoint accordingly.
- `prefix_offsets.json` is user-supplied. With only 8 speakers (`AA, DK, HM, IN, JM, LV, RM, SB`), this is a small file — if not present at build start, ask the user for the offsets before skipping the feature. If they don't have them yet, proceed without the jump-link and flag it clearly in the final handoff.
- TTS wording (`"Speaker X, vowel Y, word Z, W stress."`) is the proposed default. Confirm with user before shipping if time permits.

## Conventions

- Python: type hints everywhere, Pydantic models for request/response schemas, `ruff` for linting.
- TypeScript: strict mode on, no `any`, Zod schemas for API response validation at the boundary.
- No inline styles in React components — Tailwind classes only.
- One Plotly component per rendered plot. Do not use Plotly subplots/facets — compose at the React level.
- All filters, toggles, and sliders are controlled components driven by the Zustand store. No local component state for filter values.
- Backend endpoints are pure functions of their query params. No hidden server state. Cache aggressively.
