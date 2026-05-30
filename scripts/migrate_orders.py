#!/usr/bin/env python3
"""
migrate_orders.py
Migra gli ordini da WooCommerce → Payload CMS.

Uso:
    python3 scripts/migrate_orders.py [--dry-run] [--status STATUS]

    --dry-run        Stampa senza scrivere
    --status STATUS  Filtra per stato WooCommerce (default: any)
                     Es: completed, processing, on-hold
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

import httpx

# ── Config ─────────────────────────────────────────────────────────────────────
WOO_BASE      = os.getenv("FOOLISH_WOO_BASE_URL", "https://thefoolishbutcher.com")
WOO_KEY       = os.getenv("FOOLISH_WOO_CONSUMER_KEY", "")
WOO_SECRET    = os.getenv("FOOLISH_WOO_CONSUMER_SECRET", "")
PAYLOAD_URL   = os.getenv("FOOLISH_PAYLOAD_URL", "http://localhost:3001")
PAYLOAD_EMAIL = os.getenv("FOOLISH_PAYLOAD_EMAIL", "")
PAYLOAD_PASS  = os.getenv("FOOLISH_PAYLOAD_PASSWORD", "")

WOO_AUTH = (WOO_KEY, WOO_SECRET)

# Mappa stati WooCommerce → pipelineState Payload
STATUS_MAP = {
    "pending":    "received",
    "processing": "in_production",
    "on-hold":    "eta_pending",
    "completed":  "closed",
    "cancelled":  "closed",
    "refunded":   "closed",
    "failed":     "closed",
}


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


def map_order(woo: dict) -> dict:
    """Converte un ordine WooCommerce nel formato Payload."""
    billing  = woo.get("billing", {})
    shipping = woo.get("shipping", {}) or billing

    first = billing.get("first_name", "").strip()
    last  = billing.get("last_name",  "").strip()
    name  = f"{first} {last}".strip()

    # line_items
    line_items = [
        {
            "productId":  str(item.get("product_id", "")),
            "variationId": str(item.get("variation_id", "")) if item.get("variation_id") else None,
            "name":       item.get("name", ""),
            "sku":        item.get("sku", ""),
            "quantity":   item.get("quantity", 1),
            "price":      float(item.get("price", 0)),
            "subtotal":   float(item.get("subtotal", 0)),
        }
        for item in woo.get("line_items", [])
    ]

    # tracking da meta_data
    tracking_number  = None
    tracking_carrier = None
    for meta in woo.get("meta_data", []):
        key = meta.get("key", "")
        if key in ("_tracking_number", "tracking_number", "_wc_shipment_tracking_items"):
            val = meta.get("value")
            if isinstance(val, str):
                tracking_number = val
            elif isinstance(val, list) and val:
                tracking_number  = val[0].get("tracking_number")
                tracking_carrier = val[0].get("tracking_provider")

    woo_status = woo.get("status", "pending")
    pipeline   = STATUS_MAP.get(woo_status, "received")

    shipping_addr = {
        "name":       shipping.get("first_name", "") + " " + shipping.get("last_name", ""),
        "address1":   shipping.get("address_1", "") or billing.get("address_1", ""),
        "address2":   shipping.get("address_2", "") or billing.get("address_2", ""),
        "city":       shipping.get("city", "") or billing.get("city", ""),
        "postalCode": shipping.get("postcode", "") or billing.get("postcode", ""),
        "country":    shipping.get("country", "") or billing.get("country", ""),
    }

    total         = float(woo.get("total", 0))
    shipping_cost = float(woo.get("shipping_total", 0))

    return {
        "orderNumber":    f"WOO-{woo['id']}",
        "source":         "woocommerce",
        "customerEmail":  billing.get("email", "").lower().strip(),
        "customerName":   name,
        "lineItems":      line_items,
        "total":          total,
        "shippingCost":   shipping_cost,
        "shippingAddress": shipping_addr,
        "pipelineState":  pipeline,
        **({"trackingNumber": tracking_number}  if tracking_number  else {}),
        **({"trackingCarrier": tracking_carrier} if tracking_carrier else {}),
        "notes": f"Importato da WooCommerce. Stato originale: {woo_status}. "
                 f"Data ordine: {woo.get('date_created', '')}",
    }


def order_exists(client: httpx.Client, order_number: str, token: str) -> bool:
    r = client.get(
        f"{PAYLOAD_URL}/api/orders",
        params={"where[orderNumber][equals]": order_number, "limit": 1},
        headers={"Authorization": f"JWT {token}"},
        timeout=15,
    )
    if r.status_code != 200:
        return False
    return r.json().get("totalDocs", 0) > 0


def create_order(client: httpx.Client, data: dict, token: str) -> dict:
    r = client.post(
        f"{PAYLOAD_URL}/api/orders",
        json=data,
        headers={"Authorization": f"JWT {token}"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--status", default="any")
    args = parser.parse_args()

    if not WOO_KEY or not PAYLOAD_EMAIL:
        print("ERRORE: Variabili d'ambiente mancanti")
        sys.exit(1)

    print(f"WooCommerce: {WOO_BASE}")
    print(f"Payload CMS: {PAYLOAD_URL}")
    print(f"Filtro stato: {args.status}")
    if args.dry_run:
        print("Modalità: DRY RUN")
    print()

    with httpx.Client(timeout=30) as client:
        if not args.dry_run:
            print("Login Payload CMS...")
            token = payload_login(client)
            print("  OK\n")
        else:
            token = "dry-run"

        print(f"Scarico ordini WooCommerce (status={args.status})...")
        orders = woo_paginate(client, "orders", status=args.status)
        print(f"  Trovati: {len(orders)}\n")

        created = skipped = errors = 0

        for woo in orders:
            order_number = f"WOO-{woo['id']}"
            try:
                payload_data = map_order(woo)
            except Exception as e:
                print(f"  ERRORE mapping {order_number}: {e}")
                errors += 1
                continue

            email = payload_data.get("customerEmail", "")
            total = payload_data.get("total", 0)

            if args.dry_run:
                items_str = ", ".join(i["name"] for i in payload_data.get("lineItems", []))
                print(f"  [DRY] {order_number} | {email} | €{total:.2f} | {payload_data['pipelineState']} | {items_str[:60]}")
                created += 1
                continue

            if order_exists(client, order_number, token):
                print(f"  SKIP (già esiste): {order_number}")
                skipped += 1
                continue

            try:
                create_order(client, payload_data, token)
                print(f"  OK: {order_number} | {email} | €{total:.2f} | {payload_data['pipelineState']}")
                created += 1
            except httpx.HTTPStatusError as e:
                print(f"  ERRORE {e.response.status_code} per {order_number}: {e.response.text[:200]}")
                errors += 1

            time.sleep(0.15)

        print(f"\n{'─'*40}")
        print(f"Creati:   {created}")
        print(f"Skippati: {skipped}")
        print(f"Errori:   {errors}")


if __name__ == "__main__":
    main()
