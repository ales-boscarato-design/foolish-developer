# Railway Cron Jobs — Email Marketing

Configure these 3 cron jobs in Railway dashboard → Cron Jobs.

All jobs require `CRON_SECRET` env var set on the service.

---

## 1. Abandoned Cart (every 15 minutes)

**Name:** `email-abandoned-cart`  
**Schedule:** `*/15 * * * *`  
**Command:**
```bash
curl -sf -H "Authorization: Bearer $CRON_SECRET" https://$RAILWAY_PUBLIC_DOMAIN/api/cron/abandoned-cart
```

Sends abandoned cart emails to subscribers who started checkout 1+ hour ago without completing.

---

## 2. Review Request (every hour)

**Name:** `email-review-request`  
**Schedule:** `0 * * * *`  
**Command:**
```bash
curl -sf -H "Authorization: Bearer $CRON_SECRET" https://$RAILWAY_PUBLIC_DOMAIN/api/cron/review-request
```

Sends review request emails to customers whose order was delivered 7+ days ago.

---

## 3. Re-engagement (Mondays 09:00 CET)

**Name:** `email-reengagement`  
**Schedule:** `0 8 * * 1`  (UTC — CET is UTC+1; adjust to `0 7 * * 1` during CEST/summer UTC+2)  
**Command:**
```bash
curl -sf -H "Authorization: Bearer $CRON_SECRET" https://$RAILWAY_PUBLIC_DOMAIN/api/cron/reengagement
```

Sends re-engagement emails to active subscribers with no purchase in 90+ days and no email in last 30 days. Runs weekly, max 100 recipients per run.

---

## Environment Variables Required

Add these to the `foolish-storefront` Railway service:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (same DB as Payload CMS) |
| `RESEND_API_KEY` | Resend API key (dashboard → API Keys) |
| `RESEND_FROM` | `The Foolish Butcher <noreply@thefoolishbutcher.com>` |
| `RESEND_WEBHOOK_SECRET` | From Resend dashboard → Webhooks → signing secret |
| `CRON_SECRET` | Generate: `openssl rand -hex 32` |
| `UNSUBSCRIBE_SECRET` | Generate: `openssl rand -hex 32` |
| `FRANK_WEBHOOK_URL` | Frank agentmail.to webhook URL |

---

## Resend Webhook

Register in Resend dashboard → Webhooks → Add endpoint:
- **URL:** `https://<your-railway-domain>/api/email/resend-webhook`
- **Events:** `email.bounced`, `email.complained`
- Copy the signing secret → `RESEND_WEBHOOK_SECRET`

---

## DB Migration

Run once via Railway Postgres shell before first deploy:

```bash
# Via Railway CLI
railway connect postgres

# Then paste contents of:
# storefront/scripts/migrate-marketing.sql
```

Or use Railway dashboard → Data → Query → paste the SQL.
