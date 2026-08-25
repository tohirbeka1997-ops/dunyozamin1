#!/usr/bin/env python3
"""Wire credentials/keystore.properties into android/app/build.gradle after expo prebuild."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRADLE = ROOT / "android" / "app" / "build.gradle"

SIGNING_LOADER = """
def keystorePropertiesFile = rootProject.file("../credentials/keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
"""

OLD_SIGNING = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }"""

NEW_SIGNING = """    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (keystorePropertiesFile.exists()) {
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
                storeFile rootProject.file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
            }
        }
    }"""


def ensure_abi_filters(text: str) -> str:
    """Keep phone APKs ARM-only (matches 1.1.1 size/behavior)."""
    if "abiFilters" in text:
        return text
    text2, n = re.subn(
        r"(defaultConfig \{.*?\n)(        versionName \"[^\"]+\"\n)(    \})",
        r"\1\2        ndk {\n"
        r"            abiFilters 'armeabi-v7a', 'arm64-v8a'\n"
        r"        }\n\3",
        text,
        count=1,
        flags=re.S,
    )
    if n != 1:
        print("WARNING: could not insert ndk.abiFilters", file=sys.stderr)
        return text
    return text2


def main() -> int:
    if not GRADLE.is_file():
        print(f"Missing {GRADLE}", file=sys.stderr)
        return 1

    text = GRADLE.read_text(encoding="utf-8").replace("\r\n", "\n")
    text = ensure_abi_filters(text)

    if "keystorePropertiesFile" not in text:
        if "android {" not in text:
            print("No android { block found", file=sys.stderr)
            return 1
        text = text.replace("android {", SIGNING_LOADER + "\nandroid {", 1)

    if "storeFile rootProject.file(keystoreProperties['storeFile'])" not in text:
        if OLD_SIGNING not in text:
            print("Default signingConfigs block not found", file=sys.stderr)
            return 1
        text = text.replace(OLD_SIGNING, NEW_SIGNING, 1)

    bt = text.find("    buildTypes {")
    if bt < 0:
        print("buildTypes block not found", file=sys.stderr)
        return 1

    marker = "            signingConfig signingConfigs.debug"
    first = text.find(marker, bt)
    second = text.find(marker, first + 1) if first >= 0 else -1
    if second >= 0:
        text = (
            text[:second]
            + "            signingConfig signingConfigs.release"
            + text[second + len(marker) :]
        )
    elif "signingConfig signingConfigs.release" not in text[bt:]:
        rel = text.find("        release {", bt)
        if rel < 0:
            print("release buildType not found", file=sys.stderr)
            return 1
        insert_at = rel + len("        release {")
        text = (
            text[:insert_at]
            + "\n            signingConfig signingConfigs.release"
            + text[insert_at:]
        )

    bt2 = text.find("    buildTypes {")
    bt_end = text.find("\n    packagingOptions {", bt2)
    bt_block = text[bt2:bt_end] if bt_end > bt2 else text[bt2:]
    if "signingConfig signingConfigs.release" not in bt_block:
        print("Release buildType is not using signingConfigs.release", file=sys.stderr)
        print(bt_block, file=sys.stderr)
        return 1
    rel_i = bt_block.find("        release {")
    rel_slice = bt_block[rel_i:]
    if "signingConfig signingConfigs.debug" in rel_slice:
        print("Release buildType still references debug signing", file=sys.stderr)
        return 1
    if "keystorePropertiesFile" not in text:
        print("keystorePropertiesFile loader missing", file=sys.stderr)
        return 1

    GRADLE.write_text(text, encoding="utf-8", newline="\n")
    print(f"patched {GRADLE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
