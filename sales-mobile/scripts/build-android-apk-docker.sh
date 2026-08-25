#!/usr/bin/env bash
# Local release APK build via Docker (no Expo cloud login required).
# Usage (Git Bash / WSL): bash scripts/build-android-apk-docker.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export EXPO_PUBLIC_STAFF_API_URL="${EXPO_PUBLIC_STAFF_API_URL:-https://staff.dunyozamin.com}"
export EXPO_PUBLIC_DEFAULT_TENANT="${EXPO_PUBLIC_DEFAULT_TENANT:-default}"

mkdir -p credentials dist-native

# Prefer env (Play-safe). Fallback is local-dev only — never upload that keystore to Play.
STORE_PASS="${ANDROID_KEYSTORE_PASSWORD:-dunyozamin-sales-change-me}"
KEY_PASS="${ANDROID_KEY_PASSWORD:-$STORE_PASS}"
KEY_ALIAS="${ANDROID_KEY_ALIAS:-dunyozamin-sales}"

if [[ ! -f credentials/release.keystore ]]; then
  echo "==> Generating release keystore..."
  if [[ -z "${ANDROID_KEYSTORE_PASSWORD:-}" ]]; then
    echo "WARNING: ANDROID_KEYSTORE_PASSWORD not set — using local-dev placeholder. Do NOT upload to Play Store."
  fi
  docker run --rm -v "$ROOT/credentials:/out" eclipse-temurin:17-jdk \
    keytool -genkeypair -v \
      -storetype PKCS12 \
      -keystore /out/release.keystore \
      -alias "$KEY_ALIAS" \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass "$STORE_PASS" \
      -keypass "$KEY_PASS" \
      -dname "CN=DZ Sotuvchi, OU=DunyoZamin, O=DunyoZamin, L=Tashkent, ST=Tashkent, C=UZ"
  cat > credentials/keystore.properties <<EOF
storeFile=../credentials/release.keystore
storePassword=${STORE_PASS}
keyAlias=${KEY_ALIAS}
keyPassword=${KEY_PASS}
EOF
fi

echo "==> expo prebuild (android)..."
npx expo prebuild --platform android --clean --non-interactive

# Wire release signing into gradle if not present
GRADLE_APP="$ROOT/android/app/build.gradle"
if ! grep -q 'dunyozamin-sales\|keystore.properties\|release.keystore' "$GRADLE_APP" 2>/dev/null; then
  echo "==> Patching android/app/build.gradle for release signing..."
  python3 - <<'PY'
from pathlib import Path
p = Path("android/app/build.gradle")
text = p.read_text(encoding="utf-8")
signing_block = """
def keystorePropertiesFile = rootProject.file("../credentials/keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
"""
if "keystorePropertiesFile" not in text:
    text = text.replace("android {", signing_block + "\nandroid {", 1)

release_signing = """
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
            }
        }
    }
"""
if "signingConfigs {" not in text:
    text = text.replace("buildTypes {", release_signing + "\n    buildTypes {", 1)

if "signingConfig signingConfigs.release" not in text:
    text = text.replace(
        "release {",
        "release {\n            signingConfig signingConfigs.release",
        1,
    )
p.write_text(text, encoding="utf-8")
print("patched", p)
PY
fi

echo "==> Gradle assembleRelease in Docker..."
docker run --rm \
  -v "$ROOT:/project" \
  -w /project/android \
  -e EXPO_PUBLIC_STAFF_API_URL \
  -e EXPO_PUBLIC_DEFAULT_TENANT \
  reactnativecommunity/react-native-android \
  bash -lc "./gradlew assembleRelease --no-daemon"

APK=$(find "$ROOT/android/app/build/outputs/apk/release" -name "*.apk" | head -n 1)
if [[ -z "$APK" ]]; then
  echo "APK not found"
  exit 1
fi
cp -f "$APK" "$ROOT/dist-native/dz-sotuvchi-1.0.0.apk"
echo "==> Done: dist-native/dz-sotuvchi-1.0.0.apk"
ls -la "$ROOT/dist-native/dz-sotuvchi-1.0.0.apk"
