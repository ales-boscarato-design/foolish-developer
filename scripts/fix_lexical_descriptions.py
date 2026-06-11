#!/usr/bin/env python3
"""
Convert plain-string descriptions to Lexical JSON for the B-Side product.
Run: python3 scripts/fix_lexical_descriptions.py
"""
import json
import psycopg2

DB_URL = "postgresql://postgres:yRvHQCeRpKZDXlURNKNCFKdWEmwTPeyi@junction.proxy.rlwy.net:18293/railway"


def text_to_lexical(text: str) -> dict:
    """Convert a plain text string (with \\n\\n paragraph breaks) to Lexical JSON."""
    paragraphs = text.split("\n\n")
    children = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        children.append({
            "children": [
                {
                    "detail": 0,
                    "format": 0,
                    "mode": "normal",
                    "style": "",
                    "text": para,
                    "type": "text",
                    "version": 1
                }
            ],
            "direction": "ltr",
            "format": "",
            "indent": 0,
            "type": "paragraph",
            "version": 1
        })
    return {
        "root": {
            "children": children,
            "direction": "ltr",
            "format": "",
            "indent": 0,
            "type": "root",
            "version": 1
        }
    }


def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # Get the product ID
    cur.execute("SELECT id FROM products WHERE slug = 't-3d-art-woman-b-side-tattoo-skin'")
    row = cur.fetchone()
    if not row:
        print("Product not found!")
        return
    product_id = row[0]
    print(f"Product ID: {product_id}")

    # Get all locales with plain string descriptions
    cur.execute("""
        SELECT id, _locale, description::text
        FROM products_locales
        WHERE _parent_id = %s
          AND description IS NOT NULL
          AND jsonb_typeof(description) != 'object'
    """, (product_id,))
    rows = cur.fetchall()
    print(f"Rows to fix: {len(rows)}")

    for row_id, locale, raw_json in rows:
        # raw_json is a JSON-encoded string (has surrounding quotes, escaped \\n)
        plain_text = json.loads(raw_json)
        lexical = text_to_lexical(plain_text)
        cur.execute(
            "UPDATE products_locales SET description = %s WHERE id = %s",
            (json.dumps(lexical), row_id)
        )
        print(f"  Fixed locale={locale} (row {row_id}), {len(plain_text)} chars → {len(lexical['root']['children'])} paragraphs")

    conn.commit()
    cur.close()
    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
