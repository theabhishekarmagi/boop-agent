FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY server/browser-use-requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY server/google-forms-worker.py server/form-browser-service.py ./
RUN useradd -m -u 10001 browser && chmod -R a+rX /worker
USER browser
ENV BOOP_FORM_CHROMIUM=/usr/bin/chromium BOOP_FORM_DOCKER=true HOME=/tmp/browser ANONYMIZED_TELEMETRY=false DO_NOT_TRACK=1
CMD ["python", "-u", "form-browser-service.py"]
