# Foolish Storefront — Project State

## Snapshot metadata

- **Last verified locally:** 2026-08-16
- **Verification scope:** repository files, package manifests, project contracts, local documentation, Git working-tree state.
- **Live verification:** not performed in this snapshot. Do not treat this file as proof that Railway, the public site, Alfred, Stripe, or the database are healthy.
- **Current confidence:** high for repository topology and policy; medium for operational status because the runtime was not queried live.

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
- **Open:** live health/deploy verification is not part of this snapshot.
- **Open:** the historical `agent.md` still contains Frank transition references; it is classified as historical and should be reconciled into a dedicated operations runbook before being treated as current authority.
- **Open:** local documentation records an unresolved CMS custom-domain item; verify whether it remains relevant before changing DNS/Railway.
- **Open:** the repository working tree is dirty with many pre-existing modifications and untracked files. No promotion is allowed until the intended change set is isolated and the tree is clean for that promotion.

## Sources

- `PROJECT_CONTRACT.md` — current Hermes/Codex contract.
- `AGENTS.md` — current technical rules.
- `memory/architecture.md` — local architecture and integration facts.
- `agent.md` — historical roadmap/verification record; not authoritative where it conflicts with the contract.
- `storefront/package.json`, `cms/package.json`, `b2b/package.json` — local commands and versions.
- `/home/ab/.hermes/plans/project-drift-ledger.md` — cross-project drift and decision ledger.
