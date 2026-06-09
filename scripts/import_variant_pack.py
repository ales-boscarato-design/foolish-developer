#!/usr/bin/env python3
"""
Import variant descriptions and pack data for core Foolish products.
5 languages: it, en, fr, de, es

Phase 1: IT — create packs for products that don't have them yet + variant descriptions
Phase 2: Fetch new pack IDs
Phase 3: EN, FR, DE, ES — write translations
"""

from __future__ import annotations

import json
import sys
import time

import httpx

PAYLOAD_URL = "https://cms-production-1dda.up.railway.app"
EMAIL = "boscaratoa@icloud.com"
PASS = "admin"
LOCALES = ["en", "fr", "de", "es"]

# ── Variant descriptions per locale ──────────────────────────────────────────

VARIANTS = {
    # ── T-Sheet DBL ──────────────────────────────────────────────────────────
    "t-sheet-dbl": {
        "TS-A5": {
            "it": "Stai acquistando un foglio 20×15×0,4cm — il formato ideale per mani, collo e zone delicate.",
            "en": "You are buying a 20×15×0.4cm sheet — the ideal size for hands, neck and delicate areas.",
            "fr": "Vous achetez une feuille 20×15×0,4cm — le format idéal pour les mains, le cou et les zones délicates.",
            "de": "Du kaufst ein Blatt 20×15×0,4cm — das ideale Format für Hände, Hals und empfindliche Bereiche.",
            "es": "Estás comprando una lámina de 20×15×0,4cm — el formato ideal para manos, cuello y zonas delicadas.",
        },
        "TS-A4": {
            "it": "Stai acquistando un foglio 30×20×0,4cm — il formato ideale per braccia e gambe.",
            "en": "You are buying a 30×20×0.4cm sheet — the ideal size for arms and legs.",
            "fr": "Vous achetez une feuille 30×20×0,4cm — le format idéal pour les bras et les jambes.",
            "de": "Du kaufst ein Blatt 30×20×0,4cm — das ideale Format für Arme und Beine.",
            "es": "Estás comprando una lámina de 30×20×0,4cm — el formato ideal para brazos y piernas.",
        },
        "TS-XXL": {
            "it": "Stai acquistando un foglio 40×30×0,4cm — il formato ideale per schiena, petto e cosce.",
            "en": "You are buying a 40×30×0.4cm sheet — the ideal size for back, chest and thighs.",
            "fr": "Vous achetez une feuille 40×30×0,4cm — le format idéal pour le dos, la poitrine et les cuisses.",
            "de": "Du kaufst ein Blatt 40×30×0,4cm — das ideale Format für Rücken, Brust und Oberschenkel.",
            "es": "Estás comprando una lámina de 40×30×0,4cm — el formato ideal para espalda, pecho y muslos.",
        },
        "TS-XXXL": {
            "it": "Stai acquistando un foglio 60×40×0,4cm — il formato ideale per schiena completa e progetti grandi.",
            "en": "You are buying a 60×40×0.4cm sheet — the ideal size for full back and large projects.",
            "fr": "Vous achetez une feuille 60×40×0,4cm — le format idéal pour un dos complet et les grands projets.",
            "de": "Du kaufst ein Blatt 60×40×0,4cm — das ideale Format für den gesamten Rücken und große Projekte.",
            "es": "Estás comprando una lámina de 60×40×0,4cm — el formato ideal para espalda completa y proyectos grandes.",
        },
        "TS-EL": {
            "it": "Stai acquistando un foglio 80×60×0,4cm — il formato ideale per sleeve e composizioni ampie.",
            "en": "You are buying a 80×60×0.4cm sheet — the ideal size for sleeves and wide compositions.",
            "fr": "Vous achetez une feuille 80×60×0,4cm — le format idéal pour les sleeves et les compositions larges.",
            "de": "Du kaufst ein Blatt 80×60×0,4cm — das ideale Format für Sleeves und breite Kompositionen.",
            "es": "Estás comprando una lámina de 80×60×0,4cm — el formato ideal para mangas y composiciones amplias.",
        },
        "TS-VB": {
            "it": "Stai acquistando un foglio 120×60×0,4cm — il formato ideale per full body suit e mega progetti.",
            "en": "You are buying a 120×60×0.4cm sheet — the ideal size for full body suits and mega projects.",
            "fr": "Vous achetez une feuille 120×60×0,4cm — le format idéal pour les full body suit et les méga projets.",
            "de": "Du kaufst ein Blatt 120×60×0,4cm — das ideale Format für Full Body Suits und Mega-Projekte.",
            "es": "Estás comprando una lámina de 120×60×0,4cm — el formato ideal para full body suit y mega proyectos.",
        },
    },
    # ── Duoskin ──────────────────────────────────────────────────────────────
    "duoskin": {
        "DS-A5": {
            "it": "Stai acquistando un foglio 20×15×0,6cm — il formato ideale per zone delicate e pratica mirata.",
            "en": "You are buying a 20×15×0.6cm sheet — the ideal size for delicate areas and focused practice.",
            "fr": "Vous achetez une feuille 20×15×0,6cm — le format idéal pour les zones délicates et la pratique ciblée.",
            "de": "Du kaufst ein Blatt 20×15×0,6cm — das ideale Format für empfindliche Bereiche und gezieltes Üben.",
            "es": "Estás comprando una lámina de 20×15×0,6cm — el formato ideal para zonas delicadas y práctica enfocada.",
        },
        "DS-A4": {
            "it": "Stai acquistando un foglio 30×20×0,6cm — il formato ideale per braccia e gambe.",
            "en": "You are buying a 30×20×0.6cm sheet — the ideal size for arms and legs.",
            "fr": "Vous achetez une feuille 30×20×0,6cm — le format idéal pour les bras et les jambes.",
            "de": "Du kaufst ein Blatt 30×20×0,6cm — das ideale Format für Arme und Beine.",
            "es": "Estás comprando una lámina de 30×20×0,6cm — el formato ideal para brazos y piernas.",
        },
        "DS-A3": {
            "it": "Stai acquistando un foglio 40×30×0,8cm — il formato ideale per schiena e progetti ampi.",
            "en": "You are buying a 40×30×0.8cm sheet — the ideal size for back and large projects.",
            "fr": "Vous achetez une feuille 40×30×0,8cm — le format idéal pour le dos et les grands projets.",
            "de": "Du kaufst ein Blatt 40×30×0,8cm — das ideale Format für den Rücken und große Projekte.",
            "es": "Estás comprando una lámina de 40×30×0,8cm — el formato ideal para espalda y proyectos grandes.",
        },
    },
    # ── Alex's Hand ──────────────────────────────────────────────────────────
    "t-3d-alexs-hand": {
        "3D-HAND": {
            "it": "Formato standard — il pezzo anatomico in 3D per esercitarti su superfici curve e dettagli.",
            "en": "Standard size — the 3D anatomical piece to practice on curved surfaces and fine details.",
            "fr": "Format standard — la pièce anatomique 3D pour t'exercer sur les surfaces courbes et les détails.",
            "de": "Standardformat — das 3D-anatomische Stück zum Üben auf gekrümmten Oberflächen und feinen Details.",
            "es": "Formato estándar — la pieza anatómica en 3D para practicar en superficies curvas y detalles finos.",
        },
    },
    # ── P-3D Face ────────────────────────────────────────────────────────────
    "p-3d-skin-face-starter-kit": {
        "PMU-FACE-KIT": {
            "it": "Kit completo per esercitarti su viso 3D — include tutto l'occorrente per simulare tatuaggi facciali.",
            "en": "Complete kit to practice on a 3D face — includes everything you need to simulate facial tattoos.",
            "fr": "Kit complet pour t'exercer sur un visage 3D — comprend tout le nécessaire pour simuler des tatouages faciaux.",
            "de": "Komplettes Kit zum Üben auf einem 3D-Gesicht — enthält alles, was du für die Simulation von Gesichtstattoos brauchst.",
            "es": "Kit completo para practicar en un rostro 3D — incluye todo lo necesario para simular tatuajes faciales.",
        },
    },
    # ── Rotolo ───────────────────────────────────────────────────────────────
    "t-sheet-dbl-in-rotolo": {
        "TR-ROLL": {
            "it": "Rotolo continuo di T-Sheet DBL — ideale per scuole, corsi e formazione professionale.",
            "en": "Continuous roll of T-Sheet DBL — ideal for schools, courses and professional training.",
            "fr": "Rouleau continu de T-Sheet DBL — idéal pour les écoles, les cours et la formation professionnelle.",
            "de": "Endlosrolle T-Sheet DBL — ideal für Schulen, Kurse und berufliche Ausbildung.",
            "es": "Rollo continuo de T-Sheet DBL — ideal para escuelas, cursos y formación profesional.",
        },
    },
}

# ── Pack definition per product (IT creates first, then all locales) ────────

PACKS_DATA = {
    "t-sheet-dbl": [  # existing packs — update name/badge in other locales
        {"qty": 5, "disc": 10,
         "name_it": "Starter Pack",     "badge_it": "Pratica full time",
         "name_en": "Starter Pack",     "badge_en": "Full time practice",
         "name_fr": "Pack Débutant",    "badge_fr": "Pratique à plein temps",
         "name_de": "Starter-Pack",     "badge_de": "Vollzeit-Übung",
         "name_es": "Pack Inicial",     "badge_es": "Práctica a tiempo completo"},
        {"qty": 10, "disc": 15,
         "name_it": "Pro Bundle",       "badge_it": "Il preferito",
         "name_en": "Pro Bundle",       "badge_en": "Best seller",
         "name_fr": "Pack Pro",         "badge_fr": "Le préféré",
         "name_de": "Pro-Bundle",       "badge_de": "Der Favorit",
         "name_es": "Pack Pro",         "badge_es": "El favorito"},
        {"qty": 20, "disc": 22,
         "name_it": "Master Pack",       "badge_it": "Risparmio max",
         "name_en": "Master Pack",       "badge_en": "Max savings",
         "name_fr": "Pack Master",       "badge_fr": "Économie max",
         "name_de": "Master-Pack",       "badge_de": "Maximal sparen",
         "name_es": "Pack Master",       "badge_es": "Ahorro máximo"},
    ],
}

PACKS_TEMPLATE = {
    "duoskin": [
        {"qty": 3, "disc": 10},
        {"qty": 5, "disc": 15},
        {"qty": 10, "disc": 22},
    ],
    "t-3d-alexs-hand": [
        {"qty": 3, "disc": 10},
        {"qty": 5, "disc": 15},
        {"qty": 10, "disc": 22},
    ],
    "p-3d-skin-face-starter-kit": [
        {"qty": 3, "disc": 10},
        {"qty": 5, "disc": 15},
        {"qty": 10, "disc": 22},
    ],
    "t-sheet-dbl-in-rotolo": [
        {"qty": 3, "disc": 10},
        {"qty": 5, "disc": 15},
        {"qty": 10, "disc": 22},
    ],
}

# ── Core products (with their IDs we know) ──────────────────────────────────
CORE_SLUGS = [
    "t-sheet-dbl",
    "duoskin",
    "t-3d-alexs-hand",
    "p-3d-skin-face-starter-kit",
    "t-sheet-dbl-in-rotolo",
]

PACK_NAMES_LOCALES = {
    "it": {"starter": "Starter Pack", "pro": "Pro Bundle", "master": "Master Pack"},
    "en": {"starter": "Starter Pack", "pro": "Pro Bundle", "master": "Master Pack"},
    "fr": {"starter": "Pack Débutant", "pro": "Pack Pro", "master": "Pack Master"},
    "de": {"starter": "Starter-Pack", "pro": "Pro-Bundle", "master": "Master-Pack"},
    "es": {"starter": "Pack Inicial", "pro": "Pack Pro", "master": "Pack Master"},
}

PACK_BADGE_LOCALES = {
    "it": {"starter": "Parti da qui", "pro": "Il preferito", "master": "Risparmio max"},
    "en": {"starter": "Start here", "pro": "Fan favorite", "master": "Max savings"},
    "fr": {"starter": "Pars d'ici", "pro": "Le favori", "master": "Économie max"},
    "de": {"starter": "Starte hier", "pro": "Der Favorit", "master": "Maximal sparen"},
    "es": {"starter": "Empieza aquí", "pro": "El favorito", "master": "Ahorro máximo"},
}


# ── API helpers ──


def login():
    r = httpx.post(f"{PAYLOAD_URL}/api/users/login", json={"email": EMAIL, "password": PASS}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def get(token, path):
    r = httpx.get(f"{PAYLOAD_URL}{path}", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    return r.json()


def patch(token, path, data, locale):
    r = httpx.patch(
        f"{PAYLOAD_URL}{path}?locale={locale}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=data,
        timeout=30,
    )
    if r.status_code >= 400:
        print(f"  ❌ PATCH error {r.status_code}: {r.text[:300]}")
        r.raise_for_status()
    result = r.json()
    # PATCH returns {"doc": {...}} in Payload
    if "doc" in result:
        return result["doc"]
    return result


def main():
    token = login()

    # ── Phase 0: Fetch current state ──
    print("=" * 60)
    print("PHASE 0: Fetch current products")
    print("=" * 60)

    products = {}
    for slug in CORE_SLUGS:
        resp = get(token, f"/api/products?where[slug][equals]={slug}&depth=2&locale=it")
        docs = resp.get("docs", [])
        if not docs:
            print(f"  ❌ {slug}: not found!")
            continue
        p = docs[0]
        products[slug] = p
        vid = [(v["id"], v["sku"]) for v in p.get("variants", [])]
        pid = [(pk["id"], pk.get("name", "")) for pk in p.get("packs", [])]
        print(f"  ✓ {slug} (id={p['id']}): {len(vid)} variants, {len(pid)} packs")

    # ── Phase 1: IT locale — write variant descriptions + create packs ──
    print("\n" + "=" * 60)
    print("PHASE 1: Write IT locale (variants + create new packs)")
    print("=" * 60)

    for slug in CORE_SLUGS:
        if slug not in products:
            continue
        p = products[slug]
        pid = p["id"]

        # Build variants array with IT descriptions
        variants_data = []
        for v in p.get("variants", []):
            vid = v["id"]
            sku = v.get("sku", "")
            if slug in VARIANTS and sku in VARIANTS[slug]:
                desc_it = VARIANTS[slug][sku]["it"]
                variants_data.append({"id": vid, "description": desc_it})
            else:
                print(f"  ⚠️  {slug}/{sku}: no IT description defined, skipping")

        # Build packs array
        packs_data = []
        existing_packs = p.get("packs", [])
        if slug in PACKS_DATA:
            # Existing packs — include IDs
            for i, pk_def in enumerate(PACKS_DATA[slug]):
                if i < len(existing_packs):
                    pk_id = existing_packs[i]["id"]
                    packs_data.append({
                        "id": pk_id,
                        "name": pk_def["name_it"],
                        "badgeText": pk_def["badge_it"],
                    })
                else:
                    print(f"  ⚠️  {slug}: pack index {i} missing, skipping")
        elif slug in PACKS_TEMPLATE:
            # New packs for Duoskin, Alex's Hand, etc
            for i, tmpl in enumerate(PACKS_TEMPLATE[slug]):
                kind = "starter" if i == 0 else ("pro" if i == 1 else "master")
                packs_data.append({
                    "name": PACK_NAMES_LOCALES["it"][kind],
                    "badgeText": PACK_BADGE_LOCALES["it"][kind],
                    "quantity": tmpl["qty"],
                    "discountPercent": tmpl["disc"],
                })
        elif existing_packs:
            # Product has packs but not in our definitions — keep as-is
            for pk in existing_packs:
                packs_data.append({"id": pk["id"]})

        payload = {}
        if variants_data:
            payload["variants"] = variants_data
        if packs_data:
            payload["packs"] = packs_data

        if not payload:
            print(f"  ⚠️  {slug}: nothing to patch")
            continue

        try:
            result = patch(token, f"/api/products/{pid}", payload, "it")
            new_packs = result.get("packs", [])
            print(f"  ✓ {slug}: variants={len(variants_data)} packs={len(packs_data)}")
            # Update products dict with new pack IDs
            if isinstance(result, dict) and "id" in result:
                products[slug] = result
            else:
                print(f"  ⚠️  PATCH result for {slug} missing 'id', keeping original")
        except Exception as e:
            print(f"  ❌ {slug}: {e}")

    # ── Phase 2: Fetch again to get new pack IDs ──
    print("\n" + "=" * 60)
    print("PHASE 2: Refresh pack IDs")
    print("=" * 60)

    for slug in CORE_SLUGS:
        if slug not in products:
            continue
        p = products[slug]
        resp = get(token, f"/api/products/{p['id']}?locale=it&depth=2")
        products[slug] = resp
        pk_info = [(pk["id"], pk.get("name", "?")) for pk in resp.get("packs", [])]
        print(f"  ✓ {slug}: packs = {pk_info}")

    # ── Phase 3: Write other locales ──
    print("\n" + "=" * 60)
    print("PHASE 3: Write EN, FR, DE, ES locales")
    print("=" * 60)

    for slug in CORE_SLUGS:
        if slug not in products:
            continue
        p = products[slug]
        pid = p["id"]

        for locale in LOCALES:
            # Build variants array
            variants_data = []
            for v in p.get("variants", []):
                vid = v["id"]
                sku = v.get("sku", "")
                if slug in VARIANTS and sku in VARIANTS[slug]:
                    desc = VARIANTS[slug][sku].get(locale, "")
                    if desc:
                        variants_data.append({"id": vid, "description": desc})

            # Build packs array
            packs_data = []
            existing_packs = p.get("packs", [])
            if slug in PACKS_DATA:
                # DBL — existing packs with known data
                for i, pk_def in enumerate(PACKS_DATA[slug]):
                    if i < len(existing_packs):
                        pk_id = existing_packs[i]["id"]
                        name_key = f"name_{locale}"
                        badge_key = f"badge_{locale}"
                        packs_data.append({
                            "id": pk_id,
                            "name": pk_def[name_key],
                            "badgeText": pk_def[badge_key],
                        })
            elif slug in PACKS_TEMPLATE:
                # New packs — all have IDs now
                for i, tmpl in enumerate(PACKS_TEMPLATE[slug]):
                    kind = "starter" if i == 0 else ("pro" if i == 1 else "master")
                    if i < len(existing_packs):
                        pk_id = existing_packs[i]["id"]
                        packs_data.append({
                            "id": pk_id,
                            "name": PACK_NAMES_LOCALES[locale][kind],
                            "badgeText": PACK_BADGE_LOCALES[locale][kind],
                        })

            payload = {}
            if variants_data:
                payload["variants"] = variants_data
            if packs_data:
                payload["packs"] = packs_data

            if not payload:
                print(f"  ⚠️  {slug}/{locale}: nothing to patch")
                continue

            try:
                patch(token, f"/api/products/{pid}", payload, locale)
                print(f"  ✓ {slug}/{locale}: variants={len(variants_data)} packs={len(packs_data)}")
            except Exception as e:
                print(f"  ❌ {slug}/{locale}: {e}")

            time.sleep(0.5)  # be gentle

    # ── Verification ──
    print("\n" + "=" * 60)
    print("VERIFICATION")
    print("=" * 60)

    for slug in CORE_SLUGS:
        if slug not in products:
            continue
        p = products[slug]
        pid = p["id"]
        for locale in ["it"] + LOCALES:
            try:
                resp = get(token, f"/api/products/{pid}?locale={locale}&depth=1")
                variants = resp.get("variants", [])
                packs = resp.get("packs", [])
                v_descs = sum(1 for v in variants if v.get("description"))
                p_names = sum(1 for pk in packs if pk.get("name") and pk.get("badgeText"))
                print(f"  {slug}/{locale}: {v_descs}/{len(variants)} var desc + {p_names}/{len(packs)} pack fields")
            except Exception as e:
                print(f"  ❌ {slug}/{locale}: {e}")

    print("\n✅ Done!")


if __name__ == "__main__":
    main()
