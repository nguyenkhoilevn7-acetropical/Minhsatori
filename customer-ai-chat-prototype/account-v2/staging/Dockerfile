FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql postgresql-client poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY customer-ai-chat-prototype/package.json ./customer-ai-chat-prototype/package.json
RUN cd customer-ai-chat-prototype && npm install --omit=dev --no-audit --no-fund
COPY customer-ai-chat-prototype ./customer-ai-chat-prototype
COPY apps-script/production-snapshot-20261115 ./apps-script/production-snapshot-20261115
COPY accounting-core.js ./accounting-core.js
COPY logo-satori-3394.jpg ./logo-satori-3394.jpg
ENV SATORI_SYNTHETIC_STAGING=1
CMD ["bash","customer-ai-chat-prototype/account-v2/staging/start.sh"]
