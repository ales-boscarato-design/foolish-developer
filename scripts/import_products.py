#!/usr/bin/env python3
"""
import_products.py
Importa i 27 prodotti da WooCommerce CSV (exportfoolishproducts.csv)
verso Payload CMS tramite REST API.

Uso:
    python3 scripts/import_products.py [--dry-run]

Il CSV deve trovarsi in /home/ab/foolish_HM/exportfoolishproducts.csv
(o nel percorso configurato in WOOCOMMERCE_CSV).

Per ogni prodotto crea uno o più record in Payload CMS con:
  - name, slug, section, active, limitedStock
  - shortDescription (post_excerpt stripped)
  - description (plain text — non Lexical, così funziona meglio in admin)
  - variants (una o più varianti quando i prezzi sono noti)
  - images (vuoto — da caricare manualmente)

Le immagini non vengono scaricate automaticamente; il campo image
resta vuoto e va compilato a mano nell'interfaccia admin.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import httpx

# ── Config ────────────────────────────────────────────────────────────────────

PAYLOAD_URL   = os.getenv("PAYLOAD_PUBLIC_URL",  "http://localhost:3001")
PAYLOAD_EMAIL = os.getenv("PAYLOAD_ADMIN_EMAIL", "admin@thefoolishbutcher.com")
PAYLOAD_PASS  = os.getenv("PAYLOAD_ADMIN_PASSWORD", "admin")

CSV_PATH = os.getenv("WOOCOMMERCE_CSV", "/home/ab/foolish_HM/exportfoolishproducts.csv")

# ── Varianti note (slug → list of variants) ──────────────────────────────────
# Changelog WooCommerce:
#   T-Sheet DBL (t-sheet-dbl) — variantehero singola nel seed, prezzi confermati
#   T-Sheet DBL Pro Kit A5 — solo formato A5
#   Starter/Pro/Master Pack — multipli formati
#   DUOSKIN — A5/A4/A3 Pelle+Bianco
#   T-Sheet DBL rotolo — rotolo solo

_KNOWN_VARIANTS: dict[str, list[dict]] = {

    "t-sheet-skin-dbl-in-rotolo-per-scuole-e-corsi-di-tattoo": [
        {"sku": "DBL-A5",    "label": "A5",    "price": 15,    "stockStatus": "available"},
        {"sku": "DBL-A4",    "label": "A4",    "price": 28,    "stockStatus": "available"},
        {"sku": "DBL-L",     "label": "L",     "price": 50,    "stockStatus": "available"},
        {"sku": "DBL-XXL",   "label": "XXL",   "price": 69.95, "stockStatus": "available"},
        {"sku": "DBL-ROLL",  "label": "Rotolo", "price": 320.964, "stockStatus": "available"},
    ],

    "duoskin-starter-kit": [
        {"sku": "DUO-A5-PELLE",  "label": "A5 — Pelle",  "price": 24, "stockStatus": "available"},
        {"sku": "DUO-A5-BIANCO", "label": "A5 — Bianco", "price": 24, "stockStatus": "available"},
        {"sku": "DUO-A4-PELLE",  "label": "A4 — Pelle",  "price": 38, "stockStatus": "available"},
        {"sku": "DUO-A4-BIANCO", "label": "A4 — Bianco", "price": 38, "stockStatus": "available"},
        {"sku": "DUO-A3-PELLE",  "label": "A3 — Pelle",  "price": 50, "stockStatus": "available"},
        {"sku": "DUO-A3-BIANCO", "label": "A3 — Bianco", "price": 50, "stockStatus": "available"},
    ],

"subscription": [  # Starter Pack
        {"sku": "PKG-START-A5", "label": "4× A5 + 1× A4", "price": 73.9, "stockStatus": "available"},
    ],

    "pro-pack-push-your-limits": [  # Pro Pack
        {"sku": "PKG-PRO-A5A4", "label": "8× A5 + 4× A4 + 1× XXL", "price": 190.05, "stockStatus": "available"},
    ],

    "master-pack-no-excuses": [  # Master Pack
        {"sku": "PKG-MASTER-A5A4", "label": "20× A5 + 2× A4 + 1× XXL", "price": 204.35, "stockStatus": "available"},
    ],

    "pro-pack-8-fogli-di-pelle-formato-a5-4-a4-1xxl": [
        {"sku": "PKG-PRO-A5A4", "label": "8× A5 + 4× A4 + 1× XXL", "price": 190.05, "stockStatus": "available"},
    ],

    "master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl": [
        {"sku": "PKG-MASTER-A5A4", "label": "20× A5 + 2× A4 + 1× XXL", "price": 204.35, "stockStatus": "available"},
    ],

    "t-sheet-skin-dbl-pro-kit-a5": [
        {"sku": "PROKIT-A5", "label": "10× A5 + Stencil Pack", "price": 114.99, "stockStatus": "available"},
    ],

    "t-3d-woman-back": [
        {"sku": "WOMAN-BACK-S",  "label": "S",  "price": 92.66, "stockStatus": "available"},
    ],

    "t-3d-feet": [
        {"sku": "FEET-S",  "label": "S",  "price": 72.00, "stockStatus": "available"},
    ],
}


# ── Auth ──────────────────────────────────────────────────────────────────────

def payload_login() -> str:
    """Ottiene un Bearer token da Payload CMS."""
    resp = httpx.post(
        f"{PAYLOAD_URL}/api/users/login",
        json={"email": PAYLOAD_EMAIL, "password": PAYLOAD_PASS},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("token") or data.get("user", {}).get("token")
    if not token:
        raise RuntimeError(f"Payload login failed: {data}")
    return token


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ── CSV parsing ───────────────────────────────────────────────────────────────

def slug_from_title(title: str) -> str:
    """Genera uno slug URL-safe da un titolo."""
    s = title.lower()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def strip_html(text: str) -> str:
    """Rimuove tag HTML da una stringa."""
    if not text:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_categories(cat_string: str) -> tuple[str, bool]:
    """
    Estrae section ('tattoo' | 'pmu') e limitedStock (bool) dalla stringa
    pipe-delimited delle categorie WooCommerce.
    """
    cats = [c.strip() for c in cat_string.split("|")]
    section = "pmu" if any("PMU" in c for c in cats) else "tattoo"
    limited = any("Edizione Limitata" in c for c in cats)
    return section, limited


def _stock_status(stock_status: str, stock: str) -> str:
    """Mappa lo stato stock WooCommerce a Payload stockStatus."""
    if stock_status == "outofstock":
        return "unavailable"
    if stock_status == "instock":
        if stock and int(stock) <= 3:
            return "low"
        return "available"
    return "available"


def sku_from_slug(slug: str) -> str:
    """Genera un SKU placeholder da uno slug."""
    return f"WF-{slug[:12].upper()}"


def row_to_products(row: dict[str, str]) -> list[dict[str, Any]]:
    """
    Trasforma una riga CSV WooCommerce in una lista di dict pronti per Payload.
    Restituisce 1 dict per prodotto, o N dict se il prodotto ha varianti note.
    """
    title   = row["post_title"].strip()
    slug    = row["post_name"].strip() or slug_from_title(title)
    price   = row["regular_price"].strip()
    stock   = row["stock"].strip()
    status  = row["stock_status"].strip()
    section, limited = parse_categories(row["tax:product_cat"])
    active  = row["post_status"] == "publish"

    short_desc = strip_html(row.get("post_excerpt", ""))
    if len(short_desc) > 120:
        short_desc = short_desc[:117] + "..."

    description = strip_html(row.get("post_content", ""))
    if len(description) > 2000:
        description = description[:1997] + "..."

    known = _KNOWN_VARIANTS.get(slug, [])

    if known:
        # Prodotto con varianti note — UN solo prodotto con tutte le varianti
        return [{
            "name":             title,
            "slug":             slug,
            "section":          section,
            "active":           active,
            "limitedStock":     limited,
            "order":            99,
            "shortDescription": short_desc,
            "description":      None,  # ricaricare a mano in admin (Lexical richText)
            "variants":         known,  # tutte le varianti in un solo prodotto
            "images":           [],
        }]

    # Una singola variante
    sku = row["sku"].strip() or sku_from_slug(slug)
    price_val = float(price) if price else 0

    return [{
        "name":             title,
        "slug":             slug,
        "section":          section,
        "active":           active,
        "limitedStock":     limited,
        "order":            99,
        "shortDescription": short_desc,
        "description":      None,  # ricaricare a mano in admin (Lexical richText)
        "variants": [{
            "sku":         sku,
            "label":       "Default",
            "price":       price_val,
            "stockStatus": _stock_status(status, stock),
        }],
        "images": [],
    }]


# ── Payload API ─────────────────────────────────────────────────────────────

def payload_find_products(token: str, slug: str) -> list[dict]:
    """Cerca prodotti per slug (depth=0)."""
    params = {"where": json.dumps({"slug": {"equals": slug}}), "limit": 1, "depth": 0}
    resp = httpx.get(
        f"{PAYLOAD_URL}/api/products",
        params=params,
        headers=auth_headers(token),
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json().get("docs", [])


def payload_create_product(token: str, data: dict) -> dict:
    """Crea un prodotto in Payload CMS."""
    resp = httpx.post(
        f"{PAYLOAD_URL}/api/products",
        json=data,
        headers=auth_headers(token),
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json().get("doc", resp.json())


def payload_update_product(token: str, product_id: str, data: dict) -> dict:
    """Aggiorna un prodotto esistente in Payload CMS."""
    resp = httpx.patch(
        f"{PAYLOAD_URL}/api/products/{product_id}",
        json=data,
        headers=auth_headers(token),
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json().get("doc", resp.json())


def payload_delete_product(token: str, product_id: str) -> None:
    """Elimina un prodotto da Payload CMS."""
    resp = httpx.delete(
        f"{PAYLOAD_URL}/api/products/{product_id}",
        headers=auth_headers(token),
        timeout=20,
    )
    resp.raise_for_status()


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Importa prodotti WooCommerce in Payload CMS")
    parser.add_argument("--dry-run", action="store_true", help="Simula senza scrivere nulla")
    parser.add_argument("--csv", metavar="FILE", help="Percorso del CSV (default: env WOOCOMMERCE_CSV)")
    parser.add_argument("--replace", action="store_true",
                        help="Elimina e ricrea i prodotti già presenti (usa con cautela)")
    args = parser.parse_args()

    csv_path = Path(args.csv or CSV_PATH)
    if not csv_path.exists():
        print(f"❌ CSV non trovato: {csv_path}")
        sys.exit(1)

    print(f"⏳ Leggo CSV: {csv_path}")
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    print(f"   → {len(rows)} prodotti trovati\n")

    # ── Login ───────────────────────────────────────────────────────────────
    if args.dry_run:
        print("🔍 [DRY RUN] — nessuna modifica verrà scritta\n")
        token = None
    else:
        print("🔐 Login a Payload CMS...")
        token = payload_login()
        print(f"   ✅ Loggato come {PAYLOAD_EMAIL}\n")

    # ── Preview ───────────────────────────────────────────────────────────
    print("=" * 70)
    print(f"{'#':>3}  {'SECTION':<6}  {'ACTIVE':<7}  {'VARS':<5}  {'SLUG':<30}  NAME")
    print("=" * 70)
    for i, row in enumerate(rows, 1):
        section, limited = parse_categories(row["tax:product_cat"])
        active = row["post_status"] == "publish"
        slug = row["post_name"].strip() or "(no slug)"
        name = row["post_title"].strip()[:40]
        flag = " 🔥" if limited else ""
        products = row_to_products(row)
        n_vars = len(products[0]["variants"])
        print(f"{i:3}.  {section.upper():<6}  {str(active):<7}  {n_vars:<5}  {slug:<30}  {name}{flag}")
    print("=" * 70)
    print()

    if args.dry_run:
        print("✅ Dry run completato. Nessuna modifica scritta.")
        sys.exit(0)

    # ── Import ───────────────────────────────────────────────────────────
    created = updated = skipped = deleted = 0
    errors = []

    for i, row in enumerate(rows, 1):
        title = row["post_title"].strip()
        slug = row["post_name"].strip() or slug_from_title(title)

        products_data = row_to_products(row)
        n_vars = sum(len(p["variants"]) for p in products_data)

        try:
            existing = payload_find_products(token, slug)
        except Exception as e:
            errors.append(f"[{i}] {title}: errore ricerca — {e}")
            continue

        if existing:
            if args.replace:
                try:
                    payload_delete_product(token, existing[0]["id"])
                    deleted += 1
                except Exception as e:
                    errors.append(f"[{i}] {title}: delete failed — {e}")
                    continue
            else:
                skipped += 1
                print(f"  ⏭  [{i}] Skip (esiste): {title} ({n_vars} vars)")
                continue

        for pd in products_data:
            try:
                result = payload_create_product(token, pd)
                created += 1
                v_labels = [v["label"] for v in pd["variants"]]
                print(f"  ✅ [{i}] Creato: {title} | varianti: {v_labels}")
            except Exception as e:
                errors.append(f"[{i}] {title}: create failed — {e}")
                print(f"  ❌ [{i}] ERRORE: {title} — {e}")

        time.sleep(0.15)

    # ── Riepilogo ──────────────────────────────────────────────────────────
    print()
    print("=" * 50)
    print(f"✅ Creati:    {created}")
    print(f"🔄 Aggiornati: {updated}")
    print(f"⏭  Saltati:   {skipped} (già presenti — skip)")
    print(f"🗑  Eliminati:  {deleted}")
    print("=" * 50)

    if errors:
        print(f"\n❌ Errori ({len(errors)}):")
        for e in errors:
            print(f"   {e}")
        sys.exit(1)
    else:
        print("\n🎉 Import completato.")
        print("⚠️  Le immagini devono essere ricaricate manualmente nel CMS.")


if __name__ == "__main__":
    main()