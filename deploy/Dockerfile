# syntax=docker/dockerfile:1

############  Stage 1: build the React frontend  ############
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build      # outputs frontend/dist

############  Stage 2: python runtime (serves app + runs voice agent)  ############
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/cache/hf

# System deps: Tesseract (+ Hindi/Telugu language packs), OpenMP for faiss/torch
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-hin tesseract-ocr-tel \
        libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only PyTorch first so FlagEmbedding doesn't pull the ~2GB CUDA build.
# This index has both x86_64 and arm64 (Oracle Ampere) wheels.
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt ./
RUN pip install -r requirements.txt

# App source
COPY . .
# Drop in the compiled frontend from stage 1 (overrides anything copied above)
COPY --from=frontend /app/frontend/dist ./frontend/dist

EXPOSE 8005
CMD ["python", "server.py"]
