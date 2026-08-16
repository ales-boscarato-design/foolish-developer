# Railway Cron Jobs — Foolish Storefront

Railway production currently exposes **7 cron services** in the `Foolish
Developer` project, environment `production`. This inventory was verified
read-only on 2026-08-16.

All jobs require `CRON_SECRET` configured on the calling service. Commands
below intentionally redact the bearer value.

## 1. Abandoned cart

**Service:** `cron-abandoned-cart`
**Schedule:** `*/15 * * * *`
**Endpoint:** `/api/cron/abandoned-cart`

```bash
curl -sf -H "Authorization: Bearer ***" https://$RAILWAY_PUBLIC_DOMAIN/api/cron/abandoned-cart
```

Observed live evidence: deployment `SUCCESS`, terminating state expected,
7 HTTP calls with status `200` in the verification window.

## 2. PWA invite

**Service:** `cron-pwa-invite`
**Schedule:** `*/15 * * * *`
**Endpoint:** `/api/cron/pwa-invite`

```bash
curl -sf -H "Authorization: Bearer ***" https://$RAILWAY_PUBLIC_DOMAIN/api/cron/pwa-invite
```

Observed live evidence: deployment `SUCCESS`, 7 HTTP calls with status `200`.

## 3. Push sequences

**Service:** `cron-push-sequences`
**Schedule:** `0 * * * *`
**Endpoint:** `/api/cron/push-sequences`

```bash
curl -sf -H "Authorization: Bearer ***" https://$RAILWAY_PUBLIC_DOMAIN/api/cron/push-sequences
```

Observed live evidence: deployment `SUCCESS`, 1 HTTP call with status `200` in
the verification window.

## 4. Review request

**Service:** `cron-review-request`
**Schedule:** `0 * * * *`
**Endpoint:** `/api/cron/review-request`

```bash
curl -sf -H "Authorization: Bearer ***" https://$RAILWAY_PUBLIC_DOMAIN/api/cron/review-request
```

Sends review request emails to customers whose order was delivered 7+ days
ago. Observed live evidence: deployment `SUCCESS`, 1 HTTP call with status
`200` in the verification window.

## 5. Re-engagement

**Service:** `cron-reengagement`
**Schedule:** `0 9 * * 1` (Railway cron time; verify timezone before changing)
**Endpoint:** `/api/cron/reengagement`

```bash
curl -sf -H "Authorization: Bearer ***" https://$RAILWAY_PUBLIC_DOMAIN/api/cron/reengagement
```

Runs weekly. No execution was expected on the Sunday of the live verification;
the latest runtime records observed were from 2026-08-10.

## 6. Stripe audit daily

**Service:** `cron-stripe-audit-daily`
**Schedule:** `15 4 * * *`
**Endpoint:** `/api/cron/stripe-reconcile?days=365&heartbeat=1`

```bash
curl -sf -H "Authorization: Bearer ***" "https://$RAILWAY_PUBLIC_DOMAIN/api/cron/stripe-reconcile?days=365&heartbeat=1"
```

This is the long-window reconciliation/heartbeat job. It intentionally uses
the same application route as the fifteen-minute reconciliation job.

## 7. Stripe reconcile

**Service:** `cron-stripe-reconcile`
**Schedule:** `*/15 * * * *`
**Endpoint:** `/api/cron/stripe-reconcile`

```bash
curl -sf -H "Authorization: Bearer ***" https://$RAILWAY_PUBLIC_DOMAIN/api/cron/stripe-reconcile
```

Observed live evidence: deployment `SUCCESS`, 7 HTTP calls with status `200`.

All seven Railway cron deployments use `restartPolicy=NEVER`; `stopped=true`
is the expected post-run state for these terminating jobs, not automatically a
failure.

## Environment Variables Required

Configure these on the relevant Railway services. Never print their values.

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (same DB as Payload CMS) |
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM` | Sender identity, for example `The Foolish Butcher <noreply@thefoolishbutcher.com>` |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret |
| `CRON_SECRET` | Shared secret for cron endpoint authorization |
| `UNSUBSCRIBE_SECRET` | Secret for unsubscribe tokens |
| `NANOBOT_WEBHOOK_URL` | Alfred/Nanobot webhook base URL |
| `NANOBOT_WEBHOOK_SECRET` | Signing secret for Alfred/Nanobot webhook calls |

## Alfred/Nanobot notification boundary

Cron notification code must target Alfred/Nanobot through the signed
`NANOBOT_WEBHOOK_URL` and `NANOBOT_WEBHOOK_SECRET` boundary. Historical source
naming still contains a `notifyFrank` function name, but the current
implementation delegates to `notifyNanobot`; this is a code-naming cleanup
follow-up, not a reason to reintroduce Frank or a workstation bridge.

## Resend Webhook

Register in the Resend dashboard → Webhooks → Add endpoint:

- **URL:** `https://<storefront-domain>/api/email/resend-webhook`
- **Events:** `email.bounced`, `email.complained`
- Store the signing secret as `RESEND_WEBHOOK_SECRET`; never commit it.

## DB Migration

Run migrations only through an explicitly authorized, controlled procedure.
The Railway Postgres service currently has no TCP proxy available to the local
CLI, so `railway connect postgres` was not used during the live read-only audit.
Do not paste SQL into production as part of a health check.
