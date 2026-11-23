#!/usr/bin/env python3
"""Regression tests for missing font variables, CSS, and SSR preload links."""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.dont_write_bytecode = True
from font_contract import validate_compiled_css, validate_google_css_import, validate_preload_html, PRELOADS  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def synthetic_compiled_css(global_css: str | None = None) -> str:
    font_css = (ROOT / "src/app/google-fonts.css").read_text()
    if global_css is None:
        global_css = (ROOT / "src/app/globals.css").read_text()
    global_css = re.sub(r"@import[^;]*;", "", global_css)
    return font_css + global_css


def baseline_preload_html() -> str:
    links = "".join(
        f'<link rel="preload" href="{href}" as="font" type="font/woff2" crossorigin="anonymous">'
        for href in PRELOADS
    )
    return f"<!doctype html><html><head>{links}</head><body></body></html>"


class FontContractMutationTests(unittest.TestCase):
    def test_baseline_import_and_compiled_css_pass(self) -> None:
        global_css = (ROOT / "src/app/globals.css").read_text()
        validate_google_css_import(global_css)
        validate_compiled_css(synthetic_compiled_css(global_css))

    def test_commented_out_outfit_variable_is_rejected(self) -> None:
        global_css = (ROOT / "src/app/globals.css").read_text()
        declaration = '--font-outfit: "Outfit", "Outfit Fallback";'
        mutant = global_css.replace(declaration, f"/* {declaration} */", 1)
        self.assertNotEqual(mutant, global_css)
        with self.assertRaisesRegex(ValueError, "effective --font-outfit declaration"):
            validate_compiled_css(synthetic_compiled_css(mutant))

    def test_commented_out_cormorant_variable_is_rejected(self) -> None:
        global_css = (ROOT / "src/app/globals.css").read_text()
        declaration = '--font-cormorant: "Cormorant Garamond", "Cormorant Garamond Fallback";'
        mutant = global_css.replace(declaration, f"/* {declaration} */", 1)
        self.assertNotEqual(mutant, global_css)
        with self.assertRaisesRegex(ValueError, "effective --font-cormorant declaration"):
            validate_compiled_css(synthetic_compiled_css(mutant))

    def test_removing_google_font_css_import_is_rejected(self) -> None:
        global_css = (ROOT / "src/app/globals.css").read_text()
        mutant = global_css.replace('@import "./google-fonts.css";', "", 1)
        self.assertNotEqual(mutant, global_css)
        with self.assertRaisesRegex(ValueError, "does not import"):
            validate_google_css_import(mutant)

    def test_css_import_removal_compiled_output_is_rejected(self) -> None:
        global_css = (ROOT / "src/app/globals.css").read_text()
        # A removed import emits the rest of global CSS but none of these font faces.
        no_import_output = re.sub(r"@font-face\{[^}]*\}", "", synthetic_compiled_css(global_css))
        with self.assertRaisesRegex(ValueError, "font faces"):
            validate_compiled_css(no_import_output)

    def test_baseline_ssr_preload_html_passes(self) -> None:
        validate_preload_html(baseline_preload_html())

    def test_false_and_preload_mutation_rendered_without_links_is_rejected(self) -> None:
        layout = (ROOT / "src/app/[locale]/layout.tsx").read_text()
        self.assertIn("fontPreloads.map", layout)
        mutant_layout = layout.replace("fontPreloads.map", "false && fontPreloads.map", 1)
        self.assertIn("false && fontPreloads.map", mutant_layout)
        # This is the SSR result of the mutation: React renders no link elements.
        mutant_ssr_html = "<!doctype html><html><head></head><body></body></html>"
        with self.assertRaisesRegex(ValueError, "font preloads, expected 3"):
            validate_preload_html(mutant_ssr_html)


if __name__ == "__main__":
    unittest.main(verbosity=2)
