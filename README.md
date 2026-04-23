---
title: Ka Leo Hawaiʻi Vowel Visualizer
emoji: 🌺
colorFrom: indigo
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# Ka Leo Hawaiʻi Vowel Visualizer

Interactive viewer for Hawaiian vowel formant data (F1/F2 trajectories,
KDE contours, per-token audio playback, TTS readout).

- **Backend**: FastAPI + Polars + SciPy (smoothing splines, gaussian KDE).
- **Frontend**: React + TypeScript + Plotly.js + Zustand.
- **Data**: [tkettig/KLHData](https://github.com/tkettig/KLHData) — 8 speakers,
  ~25 000 tokens, 22 vowels.

Single-image deploy: a multi-stage `Dockerfile` builds the React bundle and
copies it into the Python image, which serves both the API (`/api/*`) and
the SPA from one origin.

## Local development

```sh
# Backend
.venv/bin/uvicorn backend.main:app --reload --port 8765

# Frontend (separate terminal — Vite proxies /api/* to :8765)
cd frontend && npm run dev
```

## Run the production image locally

```sh
docker build -t klh-vv .
docker run --rm -p 7860:7860 klh-vv
# open http://localhost:7860
```
