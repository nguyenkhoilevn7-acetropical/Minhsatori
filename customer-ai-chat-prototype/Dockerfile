# Minh Satori Customer AI Chat SANDBOX ONLY. Requires repo root as build context.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-reportlab fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY customer-ai-chat-prototype/ ./
# Copy the original logo already checked into the repository, for HTML and PDF.
COPY logo-satori-3394.jpg ./assets/logo-satori.jpg
RUN node --check server.mjs && node --check free-parser.mjs && node tests/delivery-intent.test.mjs && node tests/free-test.mjs && node tests/free-ai-test.mjs && node tests/ui-test.mjs && node tests/read-sync-test.mjs && node --check customer-links.mjs && node tests/customer-links.test.mjs
ENV NODE_ENV=production DEMO_BIND=0.0.0.0
EXPOSE 8787
CMD ["node", "server.mjs"]
