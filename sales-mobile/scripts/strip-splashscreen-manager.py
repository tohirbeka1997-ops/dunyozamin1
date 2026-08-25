#!/usr/bin/env python3
"""Remove SplashScreenManager from MainActivity after expo prebuild.

expo-splash-screen's SplashScreenManager.registerOnActivity has caused
immediate launch crashes (InflateException) on multiple Android versions.
1.1.1 launched without it; 1.1.2/1.1.3 that injected it would not open.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN = (
    ROOT
    / "android"
    / "app"
    / "src"
    / "main"
    / "java"
    / "com"
    / "dunyozamin"
    / "sales"
    / "MainActivity.kt"
)


def main() -> int:
    if not MAIN.is_file():
        print(f"Missing {MAIN}", file=sys.stderr)
        return 1

    text = MAIN.read_text(encoding="utf-8").replace("\r\n", "\n")
    original = text

    text = re.sub(
        r"^import expo\.modules\.splashscreen\.SplashScreenManager\s*\n",
        "",
        text,
        flags=re.M,
    )
    text = re.sub(
        r"[ \t]*// @generated begin expo-splashscreen.*?// @generated end expo-splashscreen\n",
        "",
        text,
        flags=re.S,
    )
    text = re.sub(
        r"[ \t]*SplashScreenManager\.registerOnActivity\(this\)\s*\n",
        "",
        text,
    )

    if text != original:
        MAIN.write_text(text, encoding="utf-8", newline="\n")
        print(f"stripped SplashScreenManager from {MAIN}")
    else:
        print("MainActivity already clean (no SplashScreenManager)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
