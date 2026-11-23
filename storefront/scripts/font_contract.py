"""Shared assertions for the checked-in and production-rendered font contract."""
from html.parser import HTMLParser
from pathlib import Path
import hashlib
import re

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_FACE_SHA256 = "e3903a9c1157bd0abca81af602a4560621ea3600b58d95bb52f07a7dbf80c438"
PRELOADS = [
    "/fonts/google/1b99372b3eaef0c8-s.p.1gsd1jahc5dg_.woff2",
    "/fonts/google/8bd76523131fa0fc-s.p.1pvupmngxrt5z.woff2",
    "/fonts/google/01e4147cff8141ee-s.p.3huc2loe0ie8a.woff2",
]


def _strip_comments(css: str) -> str:
    out: list[str] = []
    index = 0
    quote: str | None = None
    while index < len(css):
        char = css[index]
        if quote:
            out.append(char)
            if char == "\\" and index + 1 < len(css):
                index += 1
                out.append(css[index])
            elif char == quote:
                quote = None
        elif char in ("'", '"'):
            quote = char
            out.append(char)
        elif css.startswith("/*", index):
            end = css.find("*/", index + 2)
            if end < 0:
                raise ValueError("unterminated CSS comment")
            index = end + 1
        else:
            out.append(char)
        index += 1
    return "".join(out)


def _font_faces(css: str) -> list[str]:
    faces = re.findall(r"@font-face\s*\{[^}]*\}", _strip_comments(css))
    return [
        face for face in faces
        if re.search(r"font-family:(?:Outfit|Cormorant Garamond)(?: Fallback)?(?:;|,)", face)
    ]


def _normalized_face_hash(faces: list[str]) -> str:
    normalized = [
        re.sub(
            r"url\(([^)]+)\)",
            lambda match: "url(" + Path(match.group(1).strip("\\\"' ")).name + ")",
            face,
        )
        for face in faces
    ]
    return hashlib.sha256("\n".join(normalized).encode()).hexdigest()


def _rule_blocks(css: str) -> list[tuple[str, str]]:
    uncommented = _strip_comments(css)
    return [
        (selector.strip(), body)
        for selector, body in re.findall(r"(?:(?<=\A)|(?<=[{}]))\s*([^{}]+)\{([^{}]*)\}", uncommented)
    ]


def _declarations(body: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in body.split(";"):
        if ":" not in item:
            continue
        name, value = item.split(":", 1)
        result[name.strip().lower()] = re.sub(r"\s+", " ", value.strip())
    return result


def _selectors(selector_text: str) -> set[str]:
    return {selector.strip() for selector in selector_text.split(",")}


def _effective_property(css: str, selectors: set[str], property_name: str) -> str | None:
    value = None
    for selector_text, body in _rule_blocks(css):
        if _selectors(selector_text) & selectors:
            declarations = _declarations(body)
            if property_name in declarations:
                value = declarations[property_name]
    return value


def _validate_variables_and_uses(css: str) -> None:
    expected_variables = {
        "--font-outfit": '"Outfit", "Outfit Fallback"',
        "--font-cormorant": '"Cormorant Garamond", "Cormorant Garamond Fallback"',
    }
    for name, expected in expected_variables.items():
        actual = _effective_property(css, {":root", ":host"}, name)
        if actual != expected:
            raise ValueError(f"effective {name} declaration missing or incorrect: {actual!r}")

    expected_uses = {
        "body": ("font-family", "var(--font-outfit),system-ui,-apple-system,sans-serif"),
        ".font-display": ("font-family", "var(--font-cormorant),\"Georgia\",serif"),
        ".font-artisan": ("font-family", "var(--font-cormorant),\"Georgia\",serif"),
        ".stat-number": ("font-family", "var(--font-cormorant),serif"),
    }
    for selector, (property_name, expected) in expected_uses.items():
        actual = _effective_property(css, {selector}, property_name)
        normalized_actual = actual.replace("'", '"').replace(" ", "") if actual else None
        normalized_expected = expected.replace("'", '"').replace(" ", "")
        if normalized_actual != normalized_expected:
            raise ValueError(f"compiled {selector} {property_name} does not use the required font variable")

    fallback_faces = {
        declarations.get("font-family"): declarations
        for face in _font_faces(css)
        for declarations in [_declarations(face[face.find("{") + 1:-1])]
        if declarations.get("font-family", "").endswith("Fallback")
    }
    expected_fallbacks = {
        "Outfit Fallback": {
            "font-family": "Outfit Fallback",
            "src": "local(Arial)",
            "ascent-override": "100.18%",
            "descent-override": "26.05%",
            "line-gap-override": "0.0%",
            "size-adjust": "99.82%",
        },
        "Cormorant Garamond Fallback": {
            "font-family": "Cormorant Garamond Fallback",
            "src": "local(Times New Roman)",
            "ascent-override": "95.27%",
            "descent-override": "29.59%",
            "line-gap-override": "0.0%",
            "size-adjust": "96.98%",
        },
    }
    for family, expected in expected_fallbacks.items():
        if fallback_faces.get(family) != expected:
            raise ValueError(f"compiled fallback face differs for {family}")


def validate_compiled_css(css: str) -> None:
    faces = _font_faces(css)
    if len(faces) != 54:
        raise ValueError(f"compiled CSS has {len(faces)} font faces, expected 54")
    if _normalized_face_hash(faces) != EXPECTED_FACE_SHA256:
        raise ValueError("compiled font faces or unicode ranges differ from baseline")
    _validate_variables_and_uses(css)


def validate_google_css_import(globals_css: str) -> None:
    if not re.search(r'@import\s+["\']\./google-fonts\.css["\']\s*;', globals_css):
        raise ValueError("globals.css does not import google-fonts.css")


class _PreloadParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.font_preloads: list[dict[str, str | None]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        rels = (values.get("rel") or "").lower().split()
        if tag == "link" and "preload" in rels and values.get("as") == "font":
            self.font_preloads.append(values)


def validate_preload_html(html: str) -> None:
    parser = _PreloadParser()
    parser.feed(html)
    preloads = parser.font_preloads
    if len(preloads) != len(PRELOADS):
        raise ValueError(f"rendered HTML has {len(preloads)} font preloads, expected {len(PRELOADS)}")
    actual = [entry.get("href") for entry in preloads]
    if actual != PRELOADS:
        raise ValueError(f"rendered font preload hrefs differ: {actual}")
    for entry in preloads:
        if entry.get("type") != "font/woff2" or entry.get("crossorigin") != "anonymous":
            raise ValueError("rendered font preload has incorrect type/crossorigin")
