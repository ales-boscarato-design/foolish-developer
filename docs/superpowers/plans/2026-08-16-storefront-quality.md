# Storefront Quality Write-Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Storefront lint debt, replace deprecated React Email packages without changing transactional behavior, and reduce the production Docker image while preserving the existing Stripe/order flow.

**Architecture:** Treat lint, email dependencies, and Docker packaging as three independent write-sets. Keep the Storefront runtime routes and CMS integration unchanged; verify each write-set locally before combining and deploying.

**Tech Stack:** Next.js 16.3.1, TypeScript, ESLint 9, React 19, React Email, npm lockfile, Docker standalone output.

**Spec:** `agent.md` sections “Fase 1 — Aggiornamento dipendenze” and “Prossima azione concordata”.

## Global Constraints

- Do not change `admin.thefoolishbutcher.com`; it remains intentionally deferred.
- Do not change Stripe, CMS, Alfred, PEC, or production credentials in these write-sets.
- Do not use `npm audit fix --force`.
- Preserve the Storefront build, transactional email templates, and Docker runtime behavior.
- Run Storefront typecheck, order tests, lint, build, and Docker verification before publication.

### Task 1: Establish baseline

**Files:**
- Read: `storefront/package.json`, `storefront/Dockerfile`, `storefront/eslint.config.mjs`
- Read: `storefront/src/emails/`

- [x] Run `npm run lint`, record all rule/file counts: baseline 45 errors and
  22 warnings; final result is zero errors and zero warnings.
- [x] Run `npm outdated` and inspect React Email package usage/imports.
- [x] Build the current Docker image and record its size and layer causes:
  previous 1.11 GB, standalone 242 MB.

### Task 2: Lint write-set

**Files:**
- Modify: only Storefront files reported by ESLint.
- Test: existing Storefront order tests and typecheck.

- [x] Group errors by rule and root cause.
- [x] Add or update focused regression tests where behavior changed.
- [x] Apply minimal fixes, preserving runtime semantics.
- [x] Verify `npm run lint`, `npm run test:orders`, and `npx tsc --noEmit`.

### Task 3: React Email write-set

**Files:**
- Modify: `storefront/package.json`, `storefront/package-lock.json`, and email templates only when required by the supported package API.
- Test: all email template imports and Storefront build.

- [x] Identify deprecated direct packages and their supported replacement from
  the React Email 6 migration path.
- [x] Update one dependency family at a time.
- [x] Run a template import/render smoke test without sending email.
- [x] Verify audit, typecheck, order tests, and build.

### Task 4: Docker write-set

**Files:**
- Modify: `storefront/Dockerfile`, `.dockerignore`, and package scripts only if required.

- [x] Preserve required runtime assets, standalone server output, media proxy behavior, and native image dependencies.
- [x] Build the image and compare size with the baseline.
- [x] Start the image locally and smoke-test `/it/checkout` (200) and
  `/api/cron/stripe-reconcile` without credentials (401). `/it` without a
  database env returns the expected local connection error; production had
  already been verified separately.

### Task 5: Integration and release

- [x] Run the complete Storefront verification set.
- [x] Update `agent.md` with measured results and remaining non-blocking debt.
- [x] Commit each coherent write-set and push only after verification: `5215047`.
- [x] Monitor Railway deployment and repeat production smoke checks: deployment
  `653df470` succeeded; `/it`, checkout and robots returned 200, cron anonimo
  returned 401.
