# syntax=docker/dockerfile:1.7
# Quiz.me extractor image. Runs as a non-root user with a read-only root
# filesystem; the only writable path is the /tmp tmpfs mounted at runtime.
ARG PYTHON_IMAGE=python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1

FROM ${PYTHON_IMAGE} AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
COPY requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install --no-compile -r /tmp/requirements.txt

FROM ${PYTHON_IMAGE} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
 && apt-get purge -y --auto-remove \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 extractor \
 && useradd --system --uid 10001 --gid extractor --home-dir /nonexistent --shell /usr/sbin/nologin extractor
COPY --from=build /opt/venv /opt/venv
WORKDIR /srv
COPY app ./app
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    EXTRACTOR_TMP_DIR=/tmp \
    OMP_THREAD_LIMIT=1
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status == 200 else 1)"]
CMD ["uvicorn", "--factory", "app.main:create_app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header", "--no-access-log", "--timeout-graceful-shutdown", "70"]
