# Minh Satori Customer AI Chat — Cloudflare Workers AI FREE sandbox

This independent branch forks the **Work OpenAI sandbox branch** `prototype/customer-ai-chat-sandbox-20261020`. DO NOT merge it into `main` or change its existing Render service. Work's GPT implementation and secrets stay untouched.

## Behavior (actual code)

1. Only fabricated profiles `demo-a` (20%) and `demo-b` (35%) exist. Links are intentionally public; DO NOT issue them to actual customers.
2. Rule-first Vietnamese interpreter handles familiar SKUs, item count, last order, and address/phone changes. Server computes price and shipping from its trusted fixture, never from AI.
3. For phrases the rules cannot fully resolve, optional Cloudflare Workers AI Free `@cf/meta/llama-3.2-3b-instruct` tries to extract intent. Model-proposed product is revalidated; if not explicit or uniquely known, the system asks for clarification. If AI is unavailable, credentials are missing, the daily local cap is reached, or Cloudflare's Free neuron quota is exhausted, rule parsing continues; the system never calls OpenAI.
4. Clients must review quote and confirm once. Sandbox PDF shows WATERMARK and uses fake profile data. The store is ephemeral `orders.json` isolated from Google Drive and Apps Script production.
5. The draft PDF means **order confirmation**, never payment confirmation.

## Setup

Run local `node server.mjs` with Node 22, Python 3, `reportlab` and a system-installed Vietnamese-capable font. To enable Cloudflare AI on a separate Free **Render** service, add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` to **Render service environment only**; also `CF_DAILY_CALL_LIMIT=100`. Never reveal the token in GitHub/chat, and never reuse the Work OpenAI API key. Configure a Cloudflare Workers Free account with Workers AI access; it may require Cloudflare account verification. No Cloudflare plugin is connected to ChatGPT, so the owner or Work must enter these secrets via a private browser session. No token is needed to test rules.

Default model: `@cf/meta/llama-3.2-3b-instruct`. Official REST endpoint `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}`. Cloudflare Workers AI Free includes 10,000 neurons/day. On Free plan it rejects AI calls past that budget; it cannot guarantee unlimited free inference. Enable no auto-upgrade/billed AI resources.

For isolated Render Docker deployment set repository to `nguyenkhoilevn7-acetropical/Minhsatori`, branch `prototype/customer-ai-cloudflare-free-20261020`, context `.`, Dockerfile `customer-ai-chat-prototype/Dockerfile`, plan `Free`, region Singapore, autoDeploy **off**. Dockerfile runs offline rule/PDF integration and mocked Cloudflare quota tests **on every build**. Follow deployment status/logs, then use `/c/demo-a` and `/c/demo-b`.

Do not store paid API keys, actual invoices, phone numbers or production data in this sandbox. Before live release, add permanent storage, rate limits by verified customer identity, OTP on new device, price-policy management and an audited payment lifecycle. Free Render instances can restart and lose the ephemeral demo data. Tests never authorize live orders.

## Reversal

Work GPT remains at `prototype/customer-ai-chat-sandbox-20261020` and Render `srv-dbbca5uq1p3s73c31910`. The FREE branch and its proposed separate Render service can be deleted or suspended without affecting Work's sandbox.
