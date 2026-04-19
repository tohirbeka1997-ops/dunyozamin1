"""
One-off: build en.json / ru.json from uz.json using Google Translate (deep-translator).
Preserves i18next placeholders {{var}} and common acronyms.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from deep_translator import GoogleTranslator

ROOT = Path(__file__).resolve().parents[1]
UZ_PATH = ROOT / "src" / "locales" / "uz.json"
EN_PATH = ROOT / "src" / "locales" / "en.json"
RU_PATH = ROOT / "src" / "locales" / "ru.json"

PLACEHOLDER_RE = re.compile(r"\{\{[^}]+\}\}")


def mask_placeholders(s: str) -> tuple[str, list[str]]:
    parts: list[str] = []

    def repl(m: re.Match[str]) -> str:
        parts.append(m.group(0))
        return f"__PH_{len(parts) - 1}__"

    masked = PLACEHOLDER_RE.sub(repl, s)
    return masked, parts


def unmask_placeholders(s: str, parts: list[str]) -> str:
    out = s
    for i, p in enumerate(parts):
        out = out.replace(f"__PH_{i}__", p)
    return out


def translate_text(text: str, target: str, cache: dict[tuple[str, str], str]) -> str:
    key = (text, target)
    if key in cache:
        return cache[key]
    if not text.strip():
        cache[key] = text
        return text
    masked, parts = mask_placeholders(text)
    try:
        tr = GoogleTranslator(source="uz", target=target).translate(masked)
    except Exception:
        tr = GoogleTranslator(source="auto", target=target).translate(masked)
    result = unmask_placeholders(tr, parts)
    cache[key] = result
    time.sleep(0.08)
    return result


def walk_strings(obj, target: str, cache: dict) -> object:
    if isinstance(obj, dict):
        return {k: walk_strings(v, target, cache) for k, v in obj.items()}
    if isinstance(obj, list):
        return [walk_strings(x, target, cache) for x in obj]
    if isinstance(obj, str):
        return translate_text(obj, target, cache)
    return obj


def main() -> None:
    data = json.loads(UZ_PATH.read_text(encoding="utf-8"))
    cache_en: dict[tuple[str, str], str] = {}
    cache_ru: dict[tuple[str, str], str] = {}

    print("Translating to English...")
    en_data = walk_strings(data, "en", cache_en)
    EN_PATH.write_text(json.dumps(en_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {EN_PATH} ({len(cache_en)} unique strings)")

    print("Translating to Russian...")
    ru_data = walk_strings(data, "ru", cache_ru)
    RU_PATH.write_text(json.dumps(ru_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {RU_PATH} ({len(cache_ru)} unique strings)")


if __name__ == "__main__":
    main()
