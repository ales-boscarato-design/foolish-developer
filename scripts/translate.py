#!/usr/bin/env python3
"""
Generate i18n translations for foolish-storefront using Claude API.
Usage: python3 scripts/translate.py [--locale en,fr,es,de]

Reads messages/it.json as source of truth.
Outputs messages/{locale}.json for each target locale.
"""

import json
import os
import sys
import time
import argparse
from pathlib import Path

try:
    import anthropic
except ImportError:
    print("Install anthropic: pip install anthropic")
    sys.exit(1)

LOCALES = {
    "en": "English",
    "fr": "French",
    "es": "Spanish",
    "de": "German",
}

SYSTEM_PROMPT = """You are a professional translator for an Italian artisanal e-commerce brand called "The Foolish Butcher" that sells synthetic skin for tattoo and PMU practice.

Brand voice: direct, no corporate fluff, artisanal pride without pretension, technical respect for the tattoo artist's craft.

Rules:
- Translate ONLY the string values, never the JSON keys
- Preserve all {placeholder} variables exactly as-is (e.g. {amount}, {country}, {year}, {qty}, {value})
- Keep brand names unchanged: "The Foolish Butcher", "Stripe", "Telegram", "Apple Pay", "Google Pay", "PMU", "Packlink"
- Keep technical terms: "DBL", "DuoSkin", "T-Sheet Skin", "flock", "P.IVA", "GDPR"
- "P.IVA IT12475480013 · Tutti i prezzi IVA inclusa · Chieri (TO), Italia" → translate only the Italian words, keep P.IVA, IT12475480013, Chieri (TO), Italia as-is
- Copyright line: keep "The Foolish Butcher" and "Tutti i diritti riservati" translated
- For legal/GDPR references, use the correct terminology for the target language
- Emoji stay as-is (✓, ⚠️, 🔥, ←)
- Return ONLY valid JSON, no markdown, no explanation
"""


def translate_messages(source: dict, target_lang: str, lang_name: str, client) -> dict:
    source_json = json.dumps(source, ensure_ascii=False, indent=2)

    prompt = f"""Translate this JSON from Italian to {lang_name}.
Keep all JSON keys unchanged. Only translate string values.
Preserve all {{placeholder}} variables exactly.

Italian source:
{source_json}

Return only the translated JSON:"""

    message = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
        system=SYSTEM_PROMPT,
    )

    content = message.content[0].text.strip()

    # Strip markdown code blocks if present
    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

    return json.loads(content)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--locale", default=",".join(LOCALES.keys()),
                        help="Comma-separated locales to generate (default: all)")
    args = parser.parse_args()

    target_locales = [l.strip() for l in args.locale.split(",") if l.strip() in LOCALES]
    if not target_locales:
        print(f"No valid locales. Choose from: {', '.join(LOCALES)}")
        sys.exit(1)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ANTHROPIC_API_KEY not set")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    messages_dir = Path(__file__).parent.parent / "messages"
    source_path = messages_dir / "it.json"

    if not source_path.exists():
        print(f"Source file not found: {source_path}")
        sys.exit(1)

    source = json.loads(source_path.read_text(encoding="utf-8"))
    print(f"Source: {source_path} ({len(json.dumps(source))} chars)")

    for locale in target_locales:
        lang_name = LOCALES[locale]
        out_path = messages_dir / f"{locale}.json"

        print(f"\nTranslating → {lang_name} ({locale})...", end="", flush=True)
        start = time.time()

        try:
            translated = translate_messages(source, locale, lang_name, client)
            out_path.write_text(
                json.dumps(translated, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            elapsed = time.time() - start
            print(f" ✅ {elapsed:.1f}s → {out_path.name}")
        except json.JSONDecodeError as e:
            print(f" ❌ JSON parse error: {e}")
        except Exception as e:
            print(f" ❌ Error: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
