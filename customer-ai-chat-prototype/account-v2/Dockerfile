# Separate owner/customer portal, isolated from the old production server.
FROM node:22-alpine
WORKDIR /app
COPY customer-ai-chat-prototype/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY customer-ai-chat-prototype/ ./
# The exact website logo is part of the canonical PDF template.
COPY logo-satori-3394.jpg ./assets/logo-satori.jpg
RUN npm run test:account-v2
ENV NODE_ENV=production PORT=10000
EXPOSE 10000
CMD ["node","account-v2/boot.mjs"]
