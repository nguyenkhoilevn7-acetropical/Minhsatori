# Sandbox validation checkpoint — 2026-10-20

Scope: Render My Workspace, service srv-dbbca5uq1p3s73c31910, branch prototype/customer-ai-chat-sandbox-20261020. Production and main were not modified.

- Deployed application commit: 340ba111828a1bf339cc8b186db03a0c9cdf20ce.
- Latest verified deployment: dep-dbbcnorrjlhs73dpnqdg, live.
- Local programming tests using an OpenAI test double: 35/35 PASS. Includes server pricing at 20% and 35%, correct confirmation, same-request replay, consumed-quote replay with a different request ID, cross-customer access denial, PDF signature and sanitized error responses. These are not real GPT accuracy results.
- Live session endpoints: demo-a is KH-DEMO-A / 20%; demo-b is KH-DEMO-B / 35%. Explicit address change requires human review and creates no quote.
- OPENAI_API_KEY is present, but live requests return AI_KEY_FORMAT_INVALID. The configured value contains a character outside printable non-space ASCII after trimming. Its value was not inspected or logged. No OpenAI HTTP response has been obtained.
- The same format error persisted after explicitly redeploying to apply saved configuration. Latest measured failed request: 6633ms including network overhead. This is not GPT latency.
- Live GPT quote accuracy, live confirmation/PDF/replay flow and GPT p50/p95: BLOCKED; no performance or accuracy claim.
- Browser: demo-a page loads the correct fake profile and accurate configured-key wording. Fixed server-mode single-column layout and send-in-flight guard. Static checks confirm responsive breakpoint, 16px server textarea, 44px sample buttons and closing HTML tags. Samsung Chrome/Samsung Internet physical-device and keyboard/PDF testing are NOT verified.
- Free-instance sandbox order storage remains ephemeral. Multi-SKU messages and a real customer rollout remain outside this validated prototype.

Next: replace the environment value with a complete OpenAI secret key copied directly at creation, save and deploy, then run python tests/live-sandbox.py. That test calls only the named sandbox with fake profiles, takes 20 real GPT samples, verifies pricing, creates two unpaid TEST orders, checks duplicate protection/customer isolation and extracts Unicode PDF text. It stops on API unavailability. Do not substitute mock timings for real GPT performance.
