# Foolish Storefront — Project State

## Snapshot metadata

- **Last verified:** 2026-08-16T15:10:03Z
- **Verification scope:** repository files, package manifests, project contracts, local documentation, Git working-tree state, public HTTP endpoints, DNS resolution, Railway production deployment metadata/metrics/logs, PostgreSQL service state, Stripe webhook HTTP-log evidence, and Alfred internal services on the Raspberry Pi.
- **Live verification:** public Storefront, CMS admin, Alfred public/local health, Railway deployments, build logs, runtime/deploy logs, cron schedules, and Alfred systemd units were queried read-only.
- **Current confidence:** high for deployment state, public reachability, build success, Alfred core services, and observed cron calls; medium for database health and runtime error interpretation; low/unverified for Stripe delivery because no webhook delivery record was visible and no Stripe-dashboard/API query was performed.

## Identity and topology

- Primary repository: `/home/ab/dev/foolish-storefront`
- Git remote documented locally: `ales-boscarato-design/foolish-developer`
- Customer storefront: `storefront/`, Next.js 16.3.1, React 19, `next-intl`, local port 3000.
- CMS: `cms/`, Payload 3.88.0 + Next.js, local port 3001.
- B2B application: `b2b/`, Next.js 16.3.1, local port 3002.
- Shared production data boundary: PostgreSQL through Payload/direct SQL paths; exact live connection is not verified here.

## Production topology documented locally

These facts come from `memory/architecture.md` and require live confirmation before incident decisions:

- Storefront public domain: `thefoolishbutcher.com`.
- CMS Railway hostname documented: `cms-production-1e56.up.railway.app`.
- Railway services include Storefront, CMS, B2B, PostgreSQL, Valkey, and independent Stripe cron services.
- Alfred runtime is on the Raspberry Pi; local staging/configuration reference: `/home/ab/nano-py`; remote runtime path documented as `/home/nanobot-admin/foolish-core`.
- Alfred public endpoint documented: `https://alfred.thefoolishbutcher.com`.
- Frank is legacy and excluded from the current operational architecture.

## Live evidence — 2026-08-16

The public HTTP checks below used `curl`; all checks in this state snapshot were read-only. No credentials, webhook mutations, database writes, or external actions were used.

| Check | Result | Interpretation |
|---|---|---|
| `https://thefoolishbutcher.com` | HTTP `307` → `/it`, final HTTP `200` | Canonical root redirect and rendered Storefront response work. |
| `https://www.thefoolishbutcher.com` | HTTP `301` → canonical host, final HTTP `200` | `www` canonicalization works. |
| `/it`, `/en`, `/fr`, `/de`, `/es` | HTTP `200` each | Localized routes render and contain Next.js markers. |
| `https://alfred.thefoolishbutcher.com/health` | HTTP `200`, `{"status": "ok"}` | Alfred public health endpoint responds. |
| `https://alfred.thefoolishbutcher.com/` | HTTP `404` | Expected root behavior; not the health route. |
| `https://cms-production-1e56.up.railway.app/admin` | HTTP `200`, Payload/Next.js headers | CMS admin application responds. |
| CMS root `/` | HTTP `404` | No root route; not evidence that CMS is down. |
| CMS `/api/health` | HTTP `404` JSON route-not-found | No valid health endpoint at this path; do not use it as CMS health probe. |
| DNS | Storefront/Alfred resolve through Cloudflare; CMS hostname resolves directly | DNS resolution succeeded at check time. |

## Railway live evidence — 2026-08-16

The authenticated Railway project is `Foolish Developer`, environment
`production`. A temporary directory was linked for read-only CLI queries; the
Storefront repository was not modified or linked.

### Deployment state

| Service group | Live result |
|---|---|
| Storefront | `SUCCESS`, `stopped=false`, deployment `8bb9a13a-77e0-4155-a7a0-29d222d809e0` |
| CMS | `SUCCESS`, `stopped=false`, deployment `f7a958aa-fe42-4ce9-bbec-e2aec341cac5` |
| B2B | `SUCCESS`, `stopped=false`, deployment `880e66de-4e2f-4f6f-9011-61728b1a61d3` |
| Postgres, Postgres-SQwE, Valkey, umami | `SUCCESS`, `stopped=false` |
| Seven cron services | deployment `SUCCESS`, `stopped=true`; expected for terminating `restartPolicy=NEVER` jobs, validated against recent endpoint calls where available |

Storefront, CMS, and B2B deployments were created from the same repository
commit `31543b531576d4826b1367afe27dfc75fa73f852`; their Railway roots are
`/storefront`, `/cms`, and `/b2b` respectively.

### Build and runtime/deploy logs

- Storefront build: exit `0`, 76 info records, no error/warning words.
- CMS build: exit `0`, 38 info records, no error/warning words.
- B2B build: exit `0`, 51 records, no error/warning words.
- Storefront deploy/runtime stream: exit `0`; historical records contain
  application-level `error` words, so the stream is not declared entirely
  clean without endpoint correlation.
- CMS deploy/runtime stream: exit `0`, two warning words, no error words.
- B2B deploy/runtime stream: exit `0`, no error/warning words.

Railway HTTP metrics for the last six hours reported one Storefront 5xx and
four CMS 5xx responses, while the queried HTTP log windows and explicit
`>=500` filters returned no matching records. This discrepancy is recorded as
an unresolved observability warning, not silently converted into either “no
errors” or “application broken”.

### Database

- Railway Postgres deployment: `SUCCESS`, active, deployment
  `fdc5d88a-2db3-4038-ad23-15829b4d5b58`.
- Six-hour resource evidence: current memory about `65 MB`, volume about
  `193 MB` of `5 GB`, no reported deadlocks.
- Railway CLI `db_stats` returned zero connections/tables/indexes; this is not
  interpreted as an empty or healthy database because the metric payload is
  insufficient to prove SQL-level state.
- A read-only `railway connect Postgres` probe did not execute: Railway
  reported that the service has no TCP proxy URL. No database write or table
  read was attempted.

### Stripe webhook delivery

- Application endpoint: `POST /api/webhook/stripe`.
- Railway Storefront HTTP logs: zero matching records in the six-hour and
  thirty-day queried windows.
- No test event was sent and no Stripe Dashboard/API access was performed.
- Delivery is therefore **unverified**, not declared successful or failed.
  `cron-stripe-reconcile` produced observed `200` calls to its reconciliation
  endpoint, but that is not evidence of Stripe webhook delivery.

### Railway cron state

| Service | Schedule | Endpoint | Current state | Observed HTTP evidence |
|---|---|---|---|---|
| abandoned-cart | `*/15 * * * *` | `/api/cron/abandoned-cart` | SUCCESS/stopped | 7 × `200` |
| pwa-invite | `*/15 * * * *` | `/api/cron/pwa-invite` | SUCCESS/stopped | 7 × `200` |
| stripe-reconcile | `*/15 * * * *` | `/api/cron/stripe-reconcile` | SUCCESS/stopped | 7 × `200` |
| push-sequences | `0 * * * *` | `/api/cron/push-sequences` | SUCCESS/stopped | 1 × `200` |
| review-request | `0 * * * *` | `/api/cron/review-request` | SUCCESS/stopped | 1 × `200` |
| reengagement | `0 9 * * 1` | `/api/cron/reengagement` | SUCCESS/stopped | no run expected on the observed Sunday; last runtime records were 2026-08-10 |
| stripe-audit-daily | `15 4 * * *` | `/api/cron/stripe-reconcile?days=365&heartbeat=1` | SUCCESS/stopped | last runtime records observed at 04:19; outside the six-hour HTTP window |

All cron deployments use `restartPolicy=NEVER`; `stopped=true` is therefore
the expected post-run state, not by itself a failure. The daily Stripe audit
and the fifteen-minute reconcile intentionally share the same route with
different query parameters.

The local `storefront/docs/railway-crons.md` documents three cron jobs, while
Railway production currently exposes seven cron services. This is a
configuration/documentation drift; the live Railway inventory is the current
operational evidence until the document is reconciled deliberately.

### Alfred internal services

Read-only SSH verification reached `raspberrypi` at the documented internal
address as user `nanobot-admin`:

- `nanobot-foolish.service`: `active`, `enabled`, main PID present, result
  `success`.
- `cloudflared-alfred.service`: `active`, `enabled`, main PID present, result
  `success`.
- local `http://127.0.0.1:18790/health`: `{"status": "ok"}`.
- `alfred-healthcheck.timer`, `alfred-railway-direct.timer`, and
  `alfred-stripe-monitor.timer`: active, recent trigger, result `success`.
- Last oneshot results for healthcheck, Railway direct, and Stripe monitor:
  exit status `0`.
- `alfred-railway-bridge.service`: not installed (`not-found`) on the Pi. Its local staging artifacts and the workstation SSH-forward unit are now archived under `/home/ab/nano-py/docs/legacy/railway-bridge/`; the active Pi path is the direct Railway timer, not a bridge unit.
- The Pi direct unit uses `/home/nanobot-admin/.nanobot/railway.env` with mode `600`; only variable names were inspected, including `RAILWAY_TOKEN`. The direct script calls Railway GraphQL with `Project-Access-Token`, and its latest oneshot exited `0`. No token value was read or copied.

### CMS custom domain historical item

Historical `agent.md` records `admin.thefoolishbutcher.com` as NXDOMAIN and
not configured as a Railway custom domain, with an explicit decision to defer
it while using the Railway CMS hostname. Live DNS/HTTP verification confirms
the item is still present: `admin.thefoolishbutcher.com` does not resolve,
while `https://cms-production-1e56.up.railway.app/admin` returns HTTP `200`.
This is a deferred documentation/DNS item, not evidence that the current CMS
deployment is down. No DNS or Railway domain mutation was performed.

## Order flow

1. Storefront creates a Stripe Checkout Session through `POST /api/stripe/checkout`.
2. Stripe sends `checkout.session.completed` to `POST /api/webhook/stripe`.
3. The webhook writes the order to Payload CMS and fails explicitly when CMS confirmation is absent, allowing Stripe retry.
4. Persistence is intended to be idempotent on `orderNumber` and handles uniqueness races.
5. `cron-stripe-reconcile` rechecks recent paid orders.
6. `cron-stripe-audit-daily` performs daily reconciliation/heartbeat.
7. Payload sends customer/admin notifications through Resend.
8. Pipeline-state changes notify Alfred through the authenticated order-state webhook.

## Operational routing for an incident

When Hermes receives “the site is down”:

1. Read this file, `PROJECT_CONTRACT.md`, and `AGENTS.md`.
2. Check the public storefront HTTP response and timestamp the result.
3. Check Railway deployment status, build logs, and runtime logs.
4. Check CMS health and the storefront-to-CMS boundary.
5. Check Stripe webhook/reconciliation state if checkout or orders are affected.
6. Check Alfred only when the symptom concerns order state, notifications, or backoffice automation.
7. Classify the incident as runtime/deploy, dependency/configuration, external provider, data boundary, or application bug.
8. Perform read-only diagnosis first. Only then create a bounded Codex task.
9. Codex works in a dedicated worktree and returns diff/tests; Hermes reviews and decides promotion/deploy.

## Local verification commands

```bash
cd /home/ab/dev/foolish-storefront/storefront
npx tsc --noEmit
npm run lint
npm run build

cd /home/ab/dev/foolish-storefront/cms
npx tsc --noEmit
npm run build

cd /home/ab/dev/foolish-storefront/b2b
npm run build
```

Run only the affected application first during diagnosis; run the full relevant baseline before promotion. Never print credential values while inspecting configuration.

## Current stage and open items

- **Stage:** production system with Alfred transition/closeout documented locally; engineering policy is now Hermes → Codex → Hermes review.
- **Verified:** public Storefront routes, CMS admin, Railway deployment status, Storefront/CMS/B2B build logs, cron schedules and observed calls, reconciled seven-service cron documentation, Postgres service/resource state, Alfred core services/timers, and the deferred CMS custom-domain condition.
- **Open:** Stripe webhook delivery is unverified because no matching HTTP log records were observed and no Stripe Dashboard/API query was performed.
- **Open:** SQL-level database health is unverified because the Railway Postgres service has no TCP proxy URL for `railway connect` from this environment.
- **Open:** Railway metrics and HTTP logs disagree about a small number of historical 5xx responses; retain as an observability warning until reconciled.
- **Open:** the historical `notifyFrank` function name remains in cron source even though it delegates to Nanobot; perform a bounded code rename only after review of all callers and tests.
- **Open:** the historical `agent.md` still contains Frank transition references; it remains historical and should be reconciled into a dedicated operations runbook before being treated as current authority.
- **Open:** the repository working tree is dirty with many pre-existing modifications and untracked files. No promotion is allowed until the intended change set is isolated and the tree is clean for that promotion.

## Sources

- `PROJECT_CONTRACT.md` — current Hermes/Codex contract.
- `AGENTS.md` — current technical rules.
- `memory/architecture.md` — local architecture and integration facts.
- `agent.md` — historical roadmap/verification record; not authoritative where it conflicts with the contract.
- `storefront/package.json`, `cms/package.json`, `b2b/package.json` — local commands and versions.
- `/home/ab/.hermes/plans/project-drift-ledger.md` — cross-project drift and decision ledger.
