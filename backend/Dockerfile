FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_CACHE_DIR=/app/.uv-cache

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

RUN pip install --no-cache-dir uv==0.12.1

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .
RUN chown -R app:app /app

USER app
EXPOSE 8000

CMD ["uv", "run", "--no-sync", "gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "60"]
