# Sandbox validation checkpoint — 2026-10-20, 09:17 Asia/Ho_Chi_Minh

Scope: Render My Workspace, service srv-dbbca5uq1p3s73c31910, branch prototype/customer-ai-chat-sandbox-20261020. Production and main were not modified.

## Verified

- Deployed application commit: ccd72ef5c015a0e7a355fe46c608fe84b4a51e12; deployment dep-dbbctlbrjlhs73dqaks0 is live.
- The user replaced the API key and saved/deployed. Previous format blocker is resolved. Upstream now returns HTTP 429 with code credit_balance_exhausted, exposed safely as OPENAI_CREDIT_BALANCE_EXHAUSTED. No key value was inspected or logged. Further GPT calls stopped pending API credits.
- Local programming tests with a mocked OpenAI response: 36/36 PASS. Includes pricing at 20%/35%, confirmation, same-request replay, consumed quote under a new request ID, cross-customer rejection, PDF signature, safe network/quota diagnostics and no raw secret/error payload exposure. These are NOT real GPT accuracy results.
- Additional PDF extraction checks for both fake customers verify Vietnamese names/address, 20%/35% discount text and correct totals. For 10 cartons of 5L at list price 110,000 VND and 8% shipping, totals are A 950,400 VND, B 772,200 VND. This was local testing, not a live GPT-created order.
- Live session endpoints return demo-a = KH-DEMO-A / 20%, demo-b = KH-DEMO-B / 35%. Explicit address changes require human review without a quote. Last verified sandbox order count: 0.
- Desktop browser loads both profiles. Demo-b send disables the submit button while waiting, displays the upstream error, then re-enables it without creating an order. Server-mode layout is one column, 850px chat width at a 1363px viewport, with no horizontal page overflow, a 16px textarea and 44px sample buttons. HTML closes correctly and contains responsive CSS.

## Not yet verified / remaining limitations

- Live GPT extraction/quote accuracy, live GPT confirmation/PDF/replay flow and p50/p95 are BLOCKED by exhausted API credit. Latest failed upstream roundtrip was 7468ms; it is not model inference latency and must not be reported as GPT p50/p95.
- Physical Samsung Chrome / Samsung Internet, keyboard interaction and PDF sharing are NOT verified. Static responsive checks and desktop browser results do not certify a Samsung device.
- Free Render sandbox storage is ephemeral; no real data should be entered. Multi-SKU messages remain outside this prototype's supported scope.

Next: the API account owner must restore API credit (billing is separate from ChatGPT Plus). Do not rotate keys merely for exhausted credit. After credit is available, run python tests/live-sandbox.py: it targets only this sandbox with fake profiles, takes 20 GPT samples and verifies two unpaid TEST orders, quote/customer isolation, replay protection and Unicode PDF contents. Stop on upstream failure and report the measured results honestly.
