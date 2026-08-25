#!/usr/bin/env python3
"""Harden Android launch after expo prebuild (1.1.6+).

Evidence from APK forensics:
- 1.1.2/1.1.3: SplashScreenManager in DEX + Theme.App.SplashScreen → instant crash
- 1.1.4: SplashScreenManager stripped but activity still Splash theme → inflate risk
- 1.1.5: AppTheme + no SplashScreenManager (correct), but MlKitInitProvider still
  runs before first Activity (expo-camera). Disable eager ML Kit init; camera still
  works when user opens scanner (lazy init).
- Also: solid windowBackground, NEVER updates check, sync versionCode from package.json
"""
from __future__ import annotations

import json
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
MANIFEST = ROOT / "android" / "app" / "src" / "main" / "AndroidManifest.xml"
STYLES = ROOT / "android" / "app" / "src" / "main" / "res" / "values" / "styles.xml"
APP_GRADLE = ROOT / "android" / "app" / "build.gradle"
PKG_JSON = ROOT / "package.json"
APP_JSON = ROOT / "app.json"


def strip_splash_manager(text: str) -> str:
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
    return text


def simplify_main_activity(text: str) -> str:
    text = strip_splash_manager(text)
    text = text.replace(
        """  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }""",
        """  override fun onCreate(savedInstanceState: Bundle?) {
    // 1.1.6: plain AppTheme - no SplashScreenManager / splash plugin.
    setTheme(R.style.AppTheme)
    super.onCreate(null)
  }""",
    )
    # Also normalize any prior 1.1.5 comment variant
    text = re.sub(
        r"  override fun onCreate\(savedInstanceState: Bundle\?\) \{.*?\n  \}",
        """  override fun onCreate(savedInstanceState: Bundle?) {
    // 1.1.6: plain AppTheme - no SplashScreenManager / splash plugin.
    setTheme(R.style.AppTheme)
    super.onCreate(null)
  }""",
        text,
        count=1,
        flags=re.S,
    )
    return text


SOLID_STYLES = """\
<resources xmlns:tools="http://schemas.android.com/tools">
  <!-- Solid colors only — no drawable inflate on cold start (1.1.6). -->
  <style name="AppTheme" parent="Theme.AppCompat.Light.NoActionBar">
    <item name="android:windowBackground">@color/splashscreen_background</item>
    <item name="android:textColor">@android:color/black</item>
    <item name="colorPrimary">@color/colorPrimary</item>
    <item name="android:statusBarColor">#166534</item>
  </style>
  <style name="Theme.App.SplashScreen" parent="AppTheme">
    <item name="android:windowBackground">@color/splashscreen_background</item>
  </style>
</resources>
"""


def harden_styles(_text: str) -> str:
    return SOLID_STYLES


def harden_manifest(text: str) -> str:
    if 'xmlns:tools=' not in text:
        text = text.replace(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">',
            1,
        )
    text = text.replace(
        'android:theme="@style/Theme.App.SplashScreen"',
        'android:theme="@style/AppTheme"',
    )
    text = text.replace(
        'android:value="ALWAYS"',
        'android:value="NEVER"',
    )
    # Remove eager ML Kit ContentProvider (runs before Activity; camera still lazy-inits).
    remove_provider = """    <provider
      android:name="com.google.mlkit.common.internal.MlKitInitProvider"
      android:authorities="${applicationId}.mlkitinitprovider"
      tools:node="remove"/>
"""
    if "MlKitInitProvider" not in text or 'tools:node="remove"' not in text:
        # Insert before closing </application>
        if "MlKitInitProvider" in text and 'tools:node="remove"' in text:
            pass
        elif "</application>" in text and 'tools:node="remove"' not in text:
            # Drop any previous remove block duplication
            text = re.sub(
                r"\s*<provider[^>]*MlKitInitProvider[^/]*/>\s*",
                "\n",
                text,
            )
            text = text.replace("</application>", remove_provider + "  </application>", 1)
    return text


def sync_version() -> None:
    version = "1.1.6"
    code = 8
    if PKG_JSON.is_file():
        version = json.loads(PKG_JSON.read_text(encoding="utf-8")).get("version") or version
    if APP_JSON.is_file():
        expo = json.loads(APP_JSON.read_text(encoding="utf-8")).get("expo") or {}
        android = expo.get("android") or {}
        if android.get("versionCode"):
            code = int(android["versionCode"])
        if expo.get("version"):
            version = str(expo["version"])

    if not APP_GRADLE.is_file():
        print("skip version sync — no app/build.gradle")
        return
    g = APP_GRADLE.read_text(encoding="utf-8").replace("\r\n", "\n")
    g2 = re.sub(r"versionCode\s+\d+", f"versionCode {code}", g, count=1)
    g2 = re.sub(r'versionName\s+"[^"]*"', f'versionName "{version}"', g2, count=1)
    if g2 != g:
        APP_GRADLE.write_text(g2, encoding="utf-8", newline="\n")
        print(f"synced versionName={version} versionCode={code}")
    else:
        print(f"version already {version} / {code}")


def main() -> int:
    if not MAIN.is_file():
        print(f"Missing {MAIN}", file=sys.stderr)
        return 1

    main_txt = MAIN.read_text(encoding="utf-8").replace("\r\n", "\n")
    main_new = simplify_main_activity(main_txt)
    if main_new != main_txt:
        MAIN.write_text(main_new, encoding="utf-8", newline="\n")
        print(f"hardened {MAIN}")
    else:
        print("MainActivity already clean")

    if STYLES.is_file():
        STYLES.write_text(SOLID_STYLES, encoding="utf-8", newline="\n")
        print(f"hardened {STYLES}")

    if MANIFEST.is_file():
        mf = MANIFEST.read_text(encoding="utf-8").replace("\r\n", "\n")
        mf2 = harden_manifest(mf)
        if mf2 != mf:
            MANIFEST.write_text(mf2, encoding="utf-8", newline="\n")
            print(f"hardened {MANIFEST}")
        else:
            print("AndroidManifest already hardened")

    sync_version()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
