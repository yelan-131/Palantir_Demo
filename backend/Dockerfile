# ── Production backend image ────────────────────────────
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install \
      --index-url ${PIP_INDEX_URL} \
      --timeout 120 \
      --retries 5 \
      -r requirements.txt

# Fail the build if the official SDK or its platform binary is absent/mismatched.
RUN python -c "from importlib.metadata import version; from deepseek_harness import DeepSeekHarness; assert version('deepseek-harness-sdk') == version('deepseek-harness-runtime-bin') == '0.1.5rc1'"

COPY . .

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=5).read()" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
