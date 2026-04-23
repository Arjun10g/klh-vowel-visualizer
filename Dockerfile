# --- Stage 1: build the React frontend --------------------------------------
FROM node:20-alpine AS frontend-build
WORKDIR /build
# package files first so npm install caches nicely across source-only edits
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- Stage 2: python runtime serving FastAPI + the built frontend ----------
FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    KLH_FRONTEND_DIST=/app/static
WORKDIR /app

# Install python deps first so source edits don't bust the layer.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Application code + data. Parquet is the source of truth in the image —
# 5.5 MB vs the original 88 MB CSV (column-pruned + stress-filtered).
COPY backend/ ./backend/
COPY all_data_18Nov2023.parquet ./all_data_18Nov2023.parquet

# Optional offsets file: present at build time → bundled; absent → jump-link
# stays disabled at runtime per the data loader's graceful fallback.
COPY data/ ./data/

# Built frontend from stage 1.
COPY --from=frontend-build /build/dist /app/static

# Hugging Face Spaces routes external traffic to port 7860 by default.
# Override with $PORT at runtime for other platforms (Fly.io, Render, etc.).
ENV PORT=7860
EXPOSE 7860

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
