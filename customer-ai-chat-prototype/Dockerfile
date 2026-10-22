# Minh Satori Customer AI Chat SANDBOX ONLY. Requires repo root as build context.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-reportlab python3-qrcode python3-pil fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY customer-ai-chat-prototype/ ./
# Copy the original logo already checked into the repository, for HTML and PDF.
COPY logo-satori-3394.jpg ./assets/logo-satori.jpg
RUN python3 -c "import qrcode; from PIL import Image; import reportlab; print('PASS sandbox invoice QR dependencies')" && node --check server.mjs && node --check free-parser.mjs && node --check conversation-understanding.mjs && node tests/conversation-learning.test.mjs && node tests/shorthand-water-basket.test.mjs && node tests/colloquial-basket.test.mjs && node --check order-with-notes.mjs && node tests/order-with-notes.test.mjs && node tests/delivery-intent.test.mjs && node tests/amendment.test.mjs && node tests/multi-order.test.mjs && node tests/catalog-cart.test.mjs && node tests/unified-draft.test.mjs && node tests/exact-quantity-repro.test.mjs && node tests/persistent-draft.test.mjs && node tests/bootstrap-snapshot.test.mjs && node tests/safe-start.test.mjs && node tests/emergency-preview.test.mjs && node tests/production-launch-guard.test.mjs && node tests/satori-water-default.test.mjs && node tests/delivery-locations.test.mjs && node tests/multi-delivery-e2e.test.mjs && node tests/two-device-single-bill.test.mjs && node tests/chat-first.test.mjs && node tests/customer-suggestions.test.mjs && node tests/customer-change.test.mjs && node tests/free-test.mjs && node tests/free-ai-test.mjs && node tests/business-reply.test.mjs && node tests/drive-backup.test.mjs && node tests/gemini-scenarios.test.mjs && node tests/gemini-multi-segment.test.mjs && node tests/ui-test.mjs && node tests/read-sync-test.mjs && node tests/owner-live-lookup.test.mjs && node tests/owner-customer-screening.test.mjs && node tests/catalogue-parity.test.mjs && node tests/catalogue-drive-audit.test.mjs && node tests/checkout-preflight.test.mjs && node tests/satori-checkout-transport.test.mjs && node --check version-status.mjs && node tests/version-status.test.mjs && node --check customer-links.mjs && node tests/customer-links.test.mjs
ENV NODE_ENV=production DEMO_BIND=0.0.0.0
EXPOSE 8787
CMD ["node", "safe-start.mjs"]
