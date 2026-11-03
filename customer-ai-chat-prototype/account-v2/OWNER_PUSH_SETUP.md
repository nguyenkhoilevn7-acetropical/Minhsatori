# Owner push (FCM) — setup and honest guarantees

## Render secrets (V2 service)
| Name | Value |
|---|---|
| `SATORI_OWNER_PUSH_ENABLED` | `1` only after Firebase is verified (default OFF) |
| `SATORI_FCM_PROJECT_ID` | Firebase project id (same project as the Android app) |
| `SATORI_FCM_SERVICE_ACCOUNT_JSON` | service-account JSON with Firebase Cloud Messaging send permission (**Secret**) |
| `SATORI_OWNER_PUSH_WAKE_SECRET` | random ≥ 32 chars, identical to the Apps Script property below (**Secret**) |

Never commit or paste the private key into GitHub, a PR, or a chat.

## Apps Script (canonical ledger project) — optional but needed on Render Free
Add `api/OwnerPushWake.gs`, set script properties `SATORI_OWNER_PUSH_WAKE_URL`
(`https://<v2-service>/api/v2/push/wake`) and `SATORI_OWNER_PUSH_WAKE_SECRET`,
then run `installOwnerPushWakeTrigger()` once. It is a 1-minute time-driven
trigger, outside every order write; it sends no invoice data.

## What is guaranteed
* Exactly one push per canonical invoice (`invoiceNo|ledgerId`), retries with
  backoff, dead tokens disabled only on a verified FCM token error.
* >100 invoices/day: newest-first day window + exact per-number readback with a
  persisted cursor; an unreadable number holds the cursor (never skipped) and is
  reported as `PUSH_BACKFILL_UNRESOLVED`. A backlog is never truncated: above
  1,000 numbers it is flagged `PUSH_BACKFILL_LARGE` and drained over several
  passes (40 exact readbacks per pass).
* Invoices older than 48 h (restored, or found after a long outage) never alert.
  Freshness is fail-closed: missing/invalid/future `timestamp` falls back to the
  invoice date (today/yesterday, Vietnam time), then a millisecond ledger id;
  if the age cannot be established, no notification is sent.

## Latency (do not over-claim)
| Situation | Expected latency |
|---|---|
| Website V2 checkout, service awake | seconds (checkout kicks the relay) |
| Any source, service awake | ≤ 30 s relay interval |
| Gemini / ChatGPT / other writer while Render Free sleeps, wake trigger installed | ≈ 1 min trigger + 30–60 s cold start |
| Render Free asleep, wake trigger NOT installed | not until the service is woken by other traffic |

For instant delivery from every source, run the V2 service on an always-on
Render instance. Android cannot guarantee delivery after the user Force Stops
the app.
