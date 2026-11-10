FROM node:22-bookworm-slim AS node-deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
ENV PORT=10000
WORKDIR /app
COPY --from=node-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=node-deps /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=node-deps /app/node_modules /app/node_modules
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p uploads generated
CMD ["sh", "-c", "gunicorn app:app --bind 0.0.0.0:${PORT:-10000} --timeout 720 --workers 1 --threads 4"]
