# Minh Satori Customer AI Chat SANDBOX ONLY. Requires repo root as build context.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-reportlab fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY customer-ai-chat-prototype/ ./
RUN node --check server.mjs && node --check free-parser.mjs && node tests/free-test.mjs && node tests/free-ai-test.mjs
ENV NODE_ENV=production DEMO_BIND=0.0.0.0
EXPOSE 8787
CMD ["node", "server.mjs"]
