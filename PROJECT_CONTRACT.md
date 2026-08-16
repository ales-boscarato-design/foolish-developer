# Project Contract — Foolish Storefront

## Identity

Foolish Storefront is The Foolish Butcher production web stack: customer storefront plus Payload CMS sharing PostgreSQL. Hermes is the engineering director and incident coordinator. Alfred, running in Nanobot on the Pi, is the current operational automation runtime. Frank is legacy and excluded from future operations.

## Paths and architecture

- Primary repository: `/home/ab/dev/foolish-storefront`
- Customer app: `storefront/` — Next.js, production site, port 3000 locally.
- CMS: `cms/` — Payload, admin site, port 3001 locally.
- Shared production database: Railway PostgreSQL EU.
- Deploy path: repository CI/webhook to Railway, subject to Hermes review gate.
- Alfred/Nanobot runtime is external to this repository; its current state must be checked live, never inferred from old docs.

## Current stage

Production system in Alfred transition/closeout. Historical documents may mention Frank or Claude Code; those references are not operational authority. Before any incident response, verify the live site, Railway deployment, Alfred runtime, and relevant integrations.

## Hermes → Codex workflow

1. Hermes identifies the affected service and reads this contract, `AGENTS.md`, and the relevant architecture/runbook.
2. Hermes performs read-only diagnosis first: health, logs, deployment, recent commits, configuration shape, and dependency state.
3. Hermes writes a bounded task for Codex with root-cause hypothesis, affected files, constraints, acceptance tests, and rollback expectations.
4. Codex works in a dedicated branch/worktree and does not merge or push `main`.
5. Hermes reviews the diff, reruns tests, performs live verification where safe, and decides whether promotion/deploy is acceptable.

## Required checks

```bash
cd storefront && npx tsc --noEmit
cd ../cms && npx tsc --noEmit
```

Run the relevant build/lint checks and live health checks for the affected service. Report exact commands and measured results.

## Never

Do not invoke or restore Frank. Do not use Claude Code as a worker. Do not push directly to `main` from a worker. Do not modify production credentials or external services without the required approval and rollback evidence.
