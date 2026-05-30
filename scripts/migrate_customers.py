#!/usr/bin/env python3
"""
migrate_customers.py
Migra i clienti da WooCommerce → Payload CMS.

Strategia: migra solo i clienti che hanno almeno un ordine (acquirenti reali),
non tutti i 2800+ utenti registrati su WordPress.

Uso:
    python3 scripts/migrate_customers.py [--dry-run] [--all]

    --dry-run   Stampa cosa farebbe senza scrivere su Payload
    --all       Migra tutti i clienti WooCommerce (inclusi quelli senza ordini)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any

import httpx

# ── Config ─────────────────────────────────────────────────────────────────────
WOO_BASE     = os.getenv("FOOLISH_WOO_BASE_URL", "https://thefoolishbutcher.com")
WOO_KEY      = os.getenv("FOOLISH_WOO_CONSUMER_KEY", "")
WOO_SECRET   = os.getenv("FOOLISH_WOO_CONSUMER_SECRET", "")
PAYLOAD_URL  = os.getenv("FOOLISH_PAYLOAD_URL", "http://localhost:3001")
PAYLOAD_EMAIL = os.getenv("FOOLISH_PAYLOAD_EMAIL", "")
PAYLOAD_PASS = os.getenv("FOOLISH_PAYLOAD_PASSWORD", "")

WOO_AUTH = (WOO_KEY, WOO_SECRET)


def payload_login(client: httpx.Client) -> str:
    r = client.post(f"{PAYLOAD_URL}/api/users/login", json={
        "email": PAYLOAD_EMAIL,
        "password": PAYLOAD_PASS,
    })
    r.raise_for_status()
    token = r.json().get("token", "")
    if not token:
        raise RuntimeError("Payload login fallito")
    return token


def woo_paginate(client: httpx.Client, endpoint: str, **params) -> list[dict]:
    """Scarica tutte le pagine da un endpoint WooCommerce."""
    results = []
    page = 1
    while True:
        r = client.get(
            f"{WOO_BASE}/wp-json/wc/v3/{endpoint}",
            auth=WOO_AUTH,
            params={"per_page": 100, "page": page, **params},
            timeout=30,
        )
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        results.extend(batch)
        total_pages = int(r.headers.get("X-WP-TotalPages", 1))
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.2)
    return results


def map_customer(woo: dict) -> dict:
    """Converte un customer WooCommerce nel formato Payload."""
    first = woo.get("first_name", "").strip()
    last  = woo.get("last_name", "").strip()
    name  = f"{first} {last}".strip() or woo.get("username", "")

    billing = woo.get("billing", {})
    country = billing.get("country", "") or woo.get("shipping", {}).get("country", "")

    return {
        "email": woo.get("email", "").lower().strip(),
        "name":  name,
        "country": country[:2].upper() if country else None,
    }


def get_customer_emails_with_orders(client: httpx.Client) -> set[str]:
    """Ritorna le email dei clienti che hanno almeno un ordine."""
    print("  Recupero ordini WooCommerce per filtrare clienti reali...")
    orders = woo_paginate(client, "orders", status="any")
    emails = {
        o.get("billing", {}).get("email", "").lower().strip()
        for o in orders
        if o.get("billing", {}).get("email")
    }
    print(f"  Trovati {len(emails)} acquirenti unici negli ordini")
    return emails


def customer_exists_in_payload(client: httpx.Client, email: str, token: str) -> bool:
    r = client.get(
        f"{PAYLOAD_URL}/api/customers",
        params={"where[email][equals]": email, "limit": 1},
        headers={"Authorization": f"JWT {token}"},
        timeout=15,
    )
    if r.status_code != 200:
        return False
    return r.json().get("totalDocs", 0) > 0


def create_customer(client: httpx.Client, data: dict, token: str) -> dict:
    r = client.post(
        f"{PAYLOAD_URL}/api/customers",
        json=data,
        headers={"Authorization": f"JWT {token}"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--all", action="store_true", help="Migra tutti, non solo acquirenti")
    args = parser.parse_args()

    if not WOO_KEY or not PAYLOAD_EMAIL:
        print("ERRORE: Variabili d'ambiente mancanti (FOOLISH_WOO_CONSUMER_KEY, FOOLISH_PAYLOAD_EMAIL, ...)")
        sys.exit(1)

    print(f"WooCommerce: {WOO_BASE}")
    print(f"Payload CMS: {PAYLOAD_URL}")
    if args.dry_run:
        print("Modalità: DRY RUN (nessuna scrittura)")
    print()

    with httpx.Client(timeout=30) as client:
        # Login Payload
        if not args.dry_run:
            print("Login Payload CMS...")
            token = payload_login(client)
            print("  OK\n")
        else:
            token = "dry-run"

        # Scarica clienti WooCommerce
        if args.all:
            print("Scarico TUTTI i clienti WooCommerce...")
            woo_customers = woo_paginate(client, "customers", role="customer")
            print(f"  Trovati: {len(woo_customers)}\n")
        else:
            # Solo chi ha ordinato
            buyer_emails = get_customer_emails_with_orders(client)
            print("Scarico clienti WooCommerce...")
            woo_customers = woo_paginate(client, "customers", role="customer")
            woo_customers = [c for c in woo_customers if c.get("email", "").lower().strip() in buyer_emails]
            print(f"  Filtrati a acquirenti reali: {len(woo_customers)}\n")

        created = skipped = errors = 0

        for woo in woo_customers:
            payload_data = map_customer(woo)
            email = payload_data.get("email", "")

            if not email:
                errors += 1
                print(f"  SKIP (no email): id={woo.get('id')}")
                continue

            if args.dry_run:
                print(f"  [DRY] Creerebbe: {email} — {payload_data.get('name')} ({payload_data.get('country','-')})")
                created += 1
                continue

            if customer_exists_in_payload(client, email, token):
                print(f"  SKIP (già esiste): {email}")
                skipped += 1
                continue

            try:
                create_customer(client, payload_data, token)
                print(f"  OK: {email}")
                created += 1
            except httpx.HTTPStatusError as e:
                print(f"  ERRORE {e.response.status_code} per {email}: {e.response.text[:100]}")
                errors += 1

            time.sleep(0.1)

        print(f"\n{'─'*40}")
        print(f"Creati:   {created}")
        print(f"Skippati: {skipped}")
        print(f"Errori:   {errors}")


if __name__ == "__main__":
    main()
