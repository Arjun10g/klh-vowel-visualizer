# Natural Language Filters and Optimization Plan

## Goal

Add a natural-language command bar that lets users type requests such as:

```text
Show unstressed tokens for LV with vowels ai and ae
```

and have the app update its existing filters, fetch data through the current API,
and redraw the active tab.

This should not execute arbitrary code. The safe version of the feature is:

```text
natural language -> validated filter patch JSON -> Zustand filter store -> existing API calls
```

That gives users the "run this query" experience while keeping execution inside
the app's known filter schema.

## Execution Status

Updated on July 6, 2026:

- Implemented the deterministic natural-language command bar.
- Implemented validated filter patching through the existing Zustand stores.
- Fixed raw-vs-normalized formant selection to use rendered panel count.
- Added stress-separated panels for Raw Contours and Individual Trajectories.
- Restored a clean frontend lint baseline.
- Improved backend token-limit sampling across speakers.
- Added in-process caches for trajectory and contour endpoint computations.
- Added focused backend unit tests for data filtering, sampling, smoothing
  groups, and sparse contour behavior.
- Restored the Corpus Word tab.
- Added URL-shareable filter state that overrides local storage on load.
- Added lazy Plotly loading through a shared wrapper; Plotly now builds into a
  separate chunk.
- Replaced the full Plotly dist import with a smaller custom Plotly bundle that
  registers only `scatter` and `contour`.
- Added optional MiniLM semantic assist through `@huggingface/transformers`; the
  model loads only when the user clicks Semantic in the command bar.
- Added an optional local generative parser through
  `onnx-community/SmolLM2-135M-Instruct-ONNX-MHA`; the model loads only when
  the user clicks Local in the command bar, and output is reduced to validated
  `FilterPatch` values before applying.
- Moved Live Voice formant estimation into a Vite web worker.
- Added an AudioWorklet microphone capture path for Live Voice, with the
  analyser-based capture path retained as fallback.
- Added a Playwright smoke test for metadata load, command filtering, URL sync,
  and Corpus Word tab rendering.

Remaining caveats:

- The local generative model is intentionally opt-in because first use can
  download a large model into the browser cache.
- Plotly is now much smaller than the full dist chunk, but the custom chunk is
  still over Vite's default 500 kB warning threshold.
- The AudioWorklet path requires a browser that supports AudioWorklet and
  microphone access from a secure context; older browsers fall back to the
  analyser path.

## Why This Is Feasible

The app already has a clean filter model:

- Speakers: `AA, DK, HM, IN, JM, LV, RM, SB`
- Vowels from `/api/metadata`
- Stresses: `primary, secondary, unstressed`
- Display modes: speaker mode, stress mode, weighting, point mode
- Word search and token filtering via `/api/tokens`
- Word-specific querying via `/api/words` and `/api/word-plot`
- Function-word include/exclude filters

The natural-language layer only needs to translate text into those existing
controls. It does not need to invent a new query engine.

## Recommended Product Behavior

Add a command input above or inside the left rail.

Example commands:

```text
unstressed vowels for LV
compare AA and DK for ai and ae
show primary stress only for speaker HM
find words containing kai for all speakers
separate speakers, pooled weighting, smoothing 700
show LV unstressed ai tokens
```

The command bar should return a preview before applying when confidence is not
high:

```json
{
  "speakers": ["LV"],
  "vowels": ["ai"],
  "stresses": ["unstressed"],
  "speakerMode": "merged"
}
```

For high-confidence simple commands, applying immediately is reasonable. For
ambiguous requests, show a preview with an Apply button.

## Key Design Rule

Never let a model write or execute code.

The model or parser may only output this kind of object:

```ts
type FilterPatch = {
  speakers?: string[];
  vowels?: string[];
  stresses?: string[];
  speakerMode?: "merged" | "separate";
  stressMode?: "off" | "overlay" | "separate";
  weighting?: "mean_of_means" | "pooled";
  pointMode?: "auto" | "single" | "nine";
  wordQuery?: string;
  functionWordModes?: Record<string, "ignore" | "include" | "exclude">;
  trajectoryOpacity?: number;
  contourPointOpacity?: number;
  smoothing?: number;
  tab?: "overall" | "individual" | "raw_contours" | "contours_only" | "corpus_word" | "live_voice";
};
```

Then validate every value against live `/api/metadata` before updating state.

## Transformer Strategy

Use a phased approach. A large local LLM is possible, but it is probably not the
first thing to ship.

### Phase 1: Deterministic Parser

Build a schema-aware parser with no ML dependency.

Files likely involved:

- `frontend/src/lib/nlFilters.ts`
- `frontend/src/components/NaturalLanguageFilterBar.tsx`
- `frontend/src/store/filters.ts`
- `frontend/src/store/ui.ts`

Capabilities:

- Map "voice", "speaker", "user" to speaker filters.
- Detect speaker codes from metadata.
- Detect stress words: "unstressed", "primary", "secondary".
- Detect vowel labels from metadata.
- Detect "compare speakers" or "separate speakers".
- Detect "merged", "pooled", "mean of means", "smoothing N".
- Detect word/token search phrases and update `wordQuery`.

Why first:

- Fast.
- No model download.
- Works offline.
- Easy to test.
- Covers many commands users will actually type.

### Phase 2: Lightweight Embedding Model

Add an optional open-source sentence-transformer layer for fuzzy matching and
intent classification.

Good candidates checked:

- `sentence-transformers/all-MiniLM-L6-v2`: maps text to 384-dimensional
  embeddings and is widely used for semantic search and clustering.
- `Xenova/all-MiniLM-L6-v2`: ONNX-compatible packaging for Transformers.js.
- Hugging Face Transformers.js can run ONNX models in the browser.

Use cases:

- Match "weak stress" or "no stress" to `unstressed`.
- Match "draw each person separately" to `speakerMode: "separate"`.
- Match vague corpus-word requests to the nearest known intent.
- Rank likely word matches when a query has spelling variation.

Recommended architecture:

- Keep deterministic parsing as the primary source of truth.
- Use embeddings only to rank unresolved terms and intent examples.
- Keep a confidence score. Low confidence means preview, not auto-apply.

This can run fully client-side, but the first load may download model assets.
Make it lazy-loaded only when the command bar is used.

### Phase 3: Small Local Generative Parser

If users need richer language than rules plus embeddings can handle, add a small
instruction model that outputs only `FilterPatch` JSON.

Candidates checked:

- `onnx-community/SmolLM2-135M-Instruct-ONNX-MHA`: small Transformers.js-ready
  text-generation model, now used by the optional Local command-bar action.
- `Qwen/Qwen3-0.6B`: small text-generation model with Transformers examples.
- `HuggingFaceTB/SmolLM3-3B`: stronger small open model, but much heavier.
- Quantized GGUF variants can run through llama.cpp-style runtimes, but that
  adds deployment complexity.

Recommendation:

- Keep this optional and preview-based.
- Prefer server-side behind `/api/filter-query/parse` if usage grows beyond
  occasional local parsing.
- Do not load a 3B model into the browser for the main app experience.
- Gate it with a feature flag such as `KLH_ENABLE_NL_MODEL=true`.
- Cache the model after startup if the deployment has enough memory.

For Hugging Face Spaces CPU deployments, a small deterministic parser plus a
lazy embedding model is the better first implementation.

## Suggested Natural-Language API

If parsing happens on the backend:

```http
POST /api/filter-query/parse
Content-Type: application/json

{
  "query": "show unstressed ai for LV",
  "active_filters": { ... }
}
```

Response:

```json
{
  "patch": {
    "speakers": ["LV"],
    "vowels": ["ai"],
    "stresses": ["unstressed"]
  },
  "confidence": 0.95,
  "explanation": "Matched speaker LV, vowel ai, and unstressed stress.",
  "warnings": []
}
```

For the first implementation, frontend-only parsing is simpler because the
frontend already owns filter state.

## Implementation Plan

1. Add a `FilterPatch` schema in TypeScript.
2. Add a deterministic parser in `frontend/src/lib/nlFilters.ts`.
3. Add unit-style examples for parser inputs and expected patches.
4. Add `NaturalLanguageFilterBar` to `LeftRail`.
5. Show a filter preview for ambiguous queries.
6. Apply validated patches to Zustand stores.
7. Add optional lazy embedding support only after the rule parser works.
8. Consider a backend model endpoint only if real user commands outgrow the
   hybrid parser.

## Example Parser Cases

```text
show unstressed for LV
```

Expected patch:

```json
{
  "speakers": ["LV"],
  "stresses": ["unstressed"]
}
```

```text
compare AA DK for ai ae
```

Expected patch:

```json
{
  "speakers": ["AA", "DK"],
  "vowels": ["ai", "ae"],
  "speakerMode": "separate"
}
```

```text
pooled weighting, raw contours, word kai
```

Expected patch:

```json
{
  "weighting": "pooled",
  "tab": "raw_contours",
  "wordQuery": "kai"
}
```

## Acceptance Criteria

- A user can type common filter requests and see controls update.
- Parser output is validated against metadata before applying.
- Ambiguous requests produce a preview instead of surprising changes.
- No arbitrary code execution, eval, or generated Python/JavaScript execution.
- Existing URL/API behavior remains unchanged.
- Core plot tabs still build after the feature lands.

## Other Repo Optimizations

### 1. Fix Normalization Rule Drift

Project guidance says:

```text
use_normalized = n_rendered_plots > 1
```

Current frontend code often uses:

```ts
const useNormalized = speakerMode === "merged";
```

That appears inverted for common views. A single merged plot should use raw Hz;
multi-panel views should use normalized formants.

Recommended fix:

- Create a shared helper that computes panel specs and `useNormalized`.
- Use it in Overall, Individual, Raw Contours, Contours Only, and Corpus Word if
  that tab is restored.
- Add regression examples for one-panel vs multi-panel behavior.

Likely files:

- `frontend/src/lib/panels.ts`
- `frontend/src/components/OverallTrajectoriesTab.tsx`
- `frontend/src/components/IndividualTrajectoriesTab.tsx`
- `frontend/src/components/RawContoursTab.tsx`
- `frontend/src/components/ContoursOnlyTab.tsx`
- `frontend/src/components/CorpusWordTab.tsx`

### 2. Restore A Clean Lint Baseline

`npm run build` currently passes, but `npm run lint` fails on existing issues:

- `react-hooks/set-state-in-effect`
- `react-refresh/only-export-components`
- `react-hooks/exhaustive-deps` warnings
- one stale eslint-disable warning

Recommended fix:

- Move immediate loading/error state into async microtasks or derived state.
- Move non-component exports out of component files.
- Memoize selected trace objects where dependency arrays expect stability.

This should be done before adding the natural-language feature, otherwise new
work will be harder to verify.

### 3. Reduce Frontend Bundle Cost

The current production build succeeds, but the main JS bundle is large because
Plotly is bundled into the initial app.

Recommended options:

- Create one shared Plotly wrapper instead of repeating factory setup in each
  panel component.
- Lazy-load route/tab components with `React.lazy`.
- Lazy-load Plotly only when a plot tab is opened.
- Consider a smaller Plotly bundle if the app only needs scatter and contour
  traces.

Expected benefit:

- Faster first load.
- Less memory pressure in the browser.
- Cleaner component code.

### 4. Cache Expensive Backend Computations

Trajectory smoothing and KDE contour computation are pure functions of query
parameters and the immutable in-memory dataframe.

Recommended fix:

- Add an in-process cache for `/api/trajectories`.
- Add an in-process cache for `/api/contours`.
- Normalize list params to tuples for cache keys.
- Include `normalize`, `group_by`, `weighting`, `smoothing`, `n_eval_points`,
  and function filters in the cache key.

Expected benefit:

- Faster repeated tab switches.
- Faster slider settle/revisit behavior.
- Less CPU on Hugging Face Spaces.

### 5. Precompute Metadata And Axis Ranges

Metadata is derived from the dataframe each call. Axis ranges are recomputed on
the frontend from returned rows.

Recommended fix:

- Store metadata payload once in `DataStore`.
- Precompute raw and normalized axis ranges for:
  - all data
  - per speaker
  - per speaker plus stress if needed
- Add an endpoint or metadata field for canonical axis ranges.

Expected benefit:

- Less duplicated range logic.
- More stable plots.
- Better match with the project guidance that single-speaker views should not
  jump as filters change.

### 6. Improve Token Limit Sampling

`tokens_payload()` caps distinct tokens and stratifies by speaker. The current
logic can return fewer than the requested limit when the limit is not evenly
distributed or when speakers have uneven counts.

Recommended fix:

- Use round-robin fill across speakers until the exact limit is reached.
- Make ordering deterministic.
- Return `n_returned_tokens` explicitly.

Expected benefit:

- More predictable UI messaging.
- Better multi-speaker balance.

### 7. Add Backend Tests For Data Semantics

Add tests before changing data logic.

High-value tests:

- `filter_tokens()` speaker, vowel, stress, function include/exclude, word query.
- `tokens_payload()` limit behavior and audio URLs.
- normalization decision helper once added.
- trajectory grouping by speaker/stress.
- KDE `insufficient_data` behavior.
- word occurrence ordering in `word_plot_payload()`.

Suggested structure:

```text
backend/tests/test_data.py
backend/tests/test_smoothing.py
backend/tests/test_contours.py
backend/tests/test_word_plot.py
```

### 8. Add Frontend Smoke Tests

Use Playwright or a lightweight browser smoke test.

Flows to verify:

- Metadata loads.
- Each tab renders without crashing.
- Changing speaker/vowel/stress controls triggers a data fetch.
- Clicking a token populates the right rail.
- Audio URL appears in the selected token panel.
- Natural-language command applies expected filters once implemented.

### 9. Move Live Voice Processing Off The Main Thread

`LiveVoiceTab` estimates formants in the browser while Plotly is also active.
That can cause UI jank on slower devices.

Recommended fix:

- Move LPC estimation to a Web Worker or AudioWorklet.
- Keep React state updates throttled.
- Keep the existing estimator as the first implementation, but isolate it from
  the render thread.

### 10. Restore Or Remove Paused Corpus Word UI

The Corpus Word feature has backend endpoints and frontend components, but the
visible tab is paused.

Options:

- Restore the tab and test it.
- Keep it hidden but move paused code behind a clearly named feature flag.
- Remove stale navigation state for `corpus_word` if it will stay hidden.

This matters because the natural-language command bar may want to route word
queries to either regular token highlighting or the Corpus Word tab.

### 11. Add URL-Shareable Filter State

Persisted local state is useful, but sharing a plot configuration currently
depends on local browser storage.

Recommended fix:

- Serialize filters into URL query params.
- Add "copy link" support.
- On load, URL params should override local storage.

Expected benefit:

- Easier collaboration.
- Reproducible bug reports.
- Better teaching/demo workflow.

### 12. Tighten Deployment Configuration

The app is deployed on Hugging Face Spaces and serves API plus SPA from one
FastAPI process.

Recommended checks:

- Keep `/api/health` available.
- Add a version/build metadata endpoint.
- Ensure production CORS is same-origin only unless a separate frontend is used.
- Consider warming metadata/cache at startup.
- Add deployment notes for both active Spaces remotes.

## Suggested Priority Order

1. Fix normalization rule drift.
2. Restore lint baseline.
3. Add backend tests for data semantics.
4. Add deterministic natural-language parser and command bar.
5. Add URL-shareable filter state.
6. Add backend compute caching.
7. Lazy-load Plotly and tab bundles.
8. Add optional embedding support.
9. Consider a local generative parser only if needed.
10. Move Live Voice analysis into a worker.

## Source Checks For Model Planning

Current model/library checks used for this plan:

- `sentence-transformers/all-MiniLM-L6-v2`
  - https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- `Xenova/all-MiniLM-L6-v2`
  - https://huggingface.co/Xenova/all-MiniLM-L6-v2
- Hugging Face Transformers.js
  - https://huggingface.co/docs/transformers.js/en/index
- `Qwen/Qwen3-0.6B`
  - https://huggingface.co/Qwen/Qwen3-0.6B
- `HuggingFaceTB/SmolLM3-3B`
  - https://huggingface.co/HuggingFaceTB/SmolLM3-3B
