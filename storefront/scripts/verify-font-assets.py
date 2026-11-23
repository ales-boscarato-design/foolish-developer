#!/usr/bin/env python3
"""Verify vendored font CSS/assets against the captured Next Google-font baseline."""
from collections import Counter
from hashlib import sha256
from pathlib import Path
import re
import subprocess
import sys
sys.dont_write_bytecode = True
from font_contract import validate_compiled_css, validate_google_css_import

ROOT = Path(__file__).resolve().parents[1]
CSS_PATH = ROOT / "src/app/google-fonts.css"
LAYOUT_PATH = ROOT / "src/app/[locale]/layout.tsx"
GLOBALS_PATH = ROOT / "src/app/globals.css"
FONT_DIR = ROOT / "public/fonts/google"
EXPECTED_FACE_SHA256 = "e3903a9c1157bd0abca81af602a4560621ea3600b58d95bb52f07a7dbf80c438"
PRELOADS = [
    "1b99372b3eaef0c8-s.p.1gsd1jahc5dg_.woff2",
    "8bd76523131fa0fc-s.p.1pvupmngxrt5z.woff2",
    "01e4147cff8141ee-s.p.3huc2loe0ie8a.woff2",
]
ASSETS = {
    "01e4147cff8141ee-s.p.3huc2loe0ie8a.woff2": "5d618c462b7a5b74f442e1548880086af71764d9cc7d35c16ab45353da934621",
    "0926c12c4384550f-s.1-qpv3jvnkkyl.woff2": "06bc9a8c179afaf7dd5d3b4987ad2f4a82ca85a542c9e498b18bf32ad0257d8e",
    "1b99372b3eaef0c8-s.p.1gsd1jahc5dg_.woff2": "92684e4acde79ef07758cd09380b7e01e9824d8b061eddeda046f78c166d7b12",
    "1f9e983605289f29-s.3aak_kra40y8r.woff2": "9dc38267bdee93a653200ef3c1e8060e3f1399073432c415c683b419d3b50464",
    "591574edbe85c69b-s.2cu8l7zf4s4ec.woff2": "3170a883f1968a2d1135259e40fd88508da70c20337e491f171f9405d0749053",
    "8bd76523131fa0fc-s.p.1pvupmngxrt5z.woff2": "e6d6d1d73858aa9b66f3a3539f9dec22faab2276e61ad1d813bc04dd59c9c122",
    "9cc5c0547f229dea-s.00y8kskkn0hyx.woff2": "d04439363ec805132dc6c6e6a925f76efe17646f9811af8e10e218ea3dba5335",
    "acf349172f10b359-s.0gv8q2vqi14yg.woff2": "3512ad3b4ddd21fa75ab44296867da1f82948350ffba678a04afbb511015cb08",
    "b0947914c9718a1e-s.1xjn85gt7t6qs.woff2": "d81372bae1f872f1418c0b7eb412f8a92a156a950fda8d2383701c75d38969df",
    "b2ea385cb5ae8625-s.1spbknb88wd48.woff2": "9e38b3f1575daba3435ef09d33a202585ed5bd204bd0a8c744955c750c2b9091",
    "d0b60be57f16ee32-s.1xtu7gopqv2u0.woff2": "826f73ca737feec0eb1004808629973d6b611fddc2bd2a689b5fe331f6be6427",
    "d8cddd76dbfeaef0-s.1mblz1wog092a.woff2": "919a7720ae1671f06ebdd4f65bb9c2f0d619f81f805d85aec025c89139536292",
}


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def faces_from(css: str) -> list[str]:
    return re.findall(r"@font-face\{[^}]*\}", css)


def normalize_face(face: str) -> str:
    return re.sub(
        r"url\(([^)]+)\)",
        lambda m: "url(" + Path(m.group(1).strip("\\\"' ")).name + ")",
        face,
    )


def unicode_range_contains(face: str, codepoint: int) -> bool:
    match = re.search(r"unicode-range:([^;]+)", face)
    if not match:
        return True
    for token in match.group(1).rstrip("}").split(","):
        token = token.strip().removeprefix("U+")
        if "-" in token:
            lo, hi = token.split("-", 1)
            if int(lo, 16) <= codepoint <= int(hi, 16):
                return True
        elif "?" in token:
            low = int(token.replace("?", "0"), 16)
            high = int(token.replace("?", "F"), 16)
            if low <= codepoint <= high:
                return True
        elif int(token, 16) == codepoint:
            return True
    return False


css = CSS_PATH.read_text()
layout = LAYOUT_PATH.read_text()
globals_css = GLOBALS_PATH.read_text()
try:
    validate_google_css_import(globals_css)
except ValueError as exc:
    fail(str(exc))
faces = faces_from(css)
if len(faces) != 54:
    fail(f"expected 54 @font-face rules, found {len(faces)}")
if sha256("\n".join(normalize_face(face) for face in faces).encode()).hexdigest() != EXPECTED_FACE_SHA256:
    fail("face descriptors or unicode ranges differ from baseline fingerprint")

family_counts = Counter(re.search(r"font-family:([^;]+)", face).group(1) for face in faces)
expected_families = Counter({"Cormorant Garamond": 50, "Outfit": 2, "Outfit Fallback": 1, "Cormorant Garamond Fallback": 1})
if family_counts != expected_families:
    fail(f"unexpected family/face counts: {family_counts}")
if sum("font-display:swap" in face for face in faces if "Fallback" not in face) != 52:
    fail("display:swap missing from one or more primary font faces")

weights_styles = Counter()
for face in faces:
    family = re.search(r"font-family:([^;]+)", face).group(1)
    style = re.search(r"font-style:([^;]+)", face)
    weight = re.search(r"font-weight:([^;]+)", face)
    if family in {"Outfit", "Cormorant Garamond"}:
        weights_styles[(family, style.group(1) if style else "normal", weight.group(1) if weight else "normal")] += 1
if weights_styles[("Outfit", "normal", "100 900")] != 2:
    fail("Outfit variable weight/style faces differ")
for style in ("normal", "italic"):
    for weight in ("300", "400", "500", "600", "700"):
        if weights_styles[("Cormorant Garamond", style, weight)] != 5:
            fail(f"Cormorant Garamond face mismatch: {style} {weight}")

urls = set()
for face in faces:
    for url in re.findall(r"url\(([^)]+)\)", face):
        path = url.strip("\\\"' ")
        if not path.startswith("/fonts/google/"):
            fail(f"non-local font URL: {path}")
        filename = Path(path).name
        if not (FONT_DIR / filename).is_file():
            fail(f"font asset missing: {filename}")
        urls.add(filename)
if urls != set(ASSETS):
    fail(f"font asset set differs: {sorted(urls ^ set(ASSETS))}")
for filename, expected in ASSETS.items():
    actual = sha256((FONT_DIR / filename).read_bytes()).hexdigest()
    if actual != expected:
        fail(f"font binary checksum mismatch: {filename}")

preloads = re.findall(r"'/fonts/google/([^']+)'", layout)
if preloads != PRELOADS:
    fail(f"latin preload list differs: {preloads}")
if "next/font/google" in layout or "next/font/local" in layout:
    fail("layout still imports a next/font loader")
if "fonts.googleapis.com" in css or "fonts.gstatic.com" in css:
    fail("font CSS contains remote Google Fonts URLs")
if '--font-outfit: "Outfit", "Outfit Fallback"' not in globals_css:
    fail("Outfit CSS variable differs")
if '--font-cormorant: "Cormorant Garamond", "Cormorant Garamond Fallback"' not in globals_css:
    fail("Cormorant CSS variable differs")

outfit_faces = [face for face in faces if re.search(r"font-family:Outfit;", face)]
for glyph, cp in (("←", 0x2190), ("✓", 0x2713)):
    if any(unicode_range_contains(face, cp) for face in outfit_faces):
        fail(f"Outfit Google subsets unexpectedly cover {glyph} U+{cp:04X}")

compiled_css = [
    path for path in (ROOT / ".next/static").rglob("*.css")
    if "font-family:Outfit" in path.read_text(errors="ignore")
    and "font-family:Cormorant Garamond" in path.read_text(errors="ignore")
]
if not compiled_css:
    fail("no compiled CSS contains both font families")
for path in compiled_css:
    try:
        validate_compiled_css(path.read_text())
    except ValueError as exc:
        fail(f"compiled CSS {path.relative_to(ROOT)}: {exc}")

print("PASS: 54 baseline @font-face rules and all unicode ranges fingerprint-match")
print(f"PASS: {len(compiled_css)} compiled CSS file(s) contain the fingerprint-matching faces")
print("PASS: Outfit variable 100–900; Cormorant Garamond 300–700 × normal/italic")
print("PASS: all 12 WOFF2 assets match baseline SHA-256 values")
print("PASS: three original latin preloads, fallback metrics, display:swap, variables")
print("PASS: Outfit Google subsets route ← (U+2190) and ✓ (U+2713) to fallback")
print("PASS: no next/font loader or Google Fonts URL in font runtime")

rendered = subprocess.run(
    [sys.executable, str(ROOT / "scripts/verify-font-rendering.py")],
    cwd=ROOT,
    check=False,
)
if rendered.returncode:
    fail("production-rendered HTML/CSS font verification failed")
