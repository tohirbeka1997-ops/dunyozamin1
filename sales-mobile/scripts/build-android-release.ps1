# Build signed Android release APK locally (no Expo account required).
# Requires: JDK 17, Android SDK (cmdline-tools), Node deps installed.
#
# Optional env for release signing (recommended for production):
#   ANDROID_KEYSTORE_PATH  вЂ” absolute path to .keystore / .jks
#   ANDROID_KEYSTORE_PASSWORD
#   ANDROID_KEY_ALIAS
#   ANDROID_KEY_PASSWORD
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$jdk = Get-ChildItem 'C:\Program Files\Microsoft' -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $jdk) { throw 'JDK 17 not found. Install Microsoft.OpenJDK.17 via winget.' }
if (-not (Test-Path $sdkRoot)) { throw "Android SDK not found at $sdkRoot" }

$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:NODE_ENV = 'production'
$env:EXPO_PUBLIC_STAFF_API_URL = if ($env:EXPO_PUBLIC_STAFF_API_URL) { $env:EXPO_PUBLIC_STAFF_API_URL } else { 'https://staff.dunyozamin.com' }
$env:EXPO_PUBLIC_DEFAULT_TENANT = if ($env:EXPO_PUBLIC_DEFAULT_TENANT) { $env:EXPO_PUBLIC_DEFAULT_TENANT } else { 'default' }
$env:Path = "$($env:JAVA_HOME)\bin;$sdkRoot\platform-tools;" + $env:Path

New-Item -ItemType Directory -Force -Path credentials, dist-native | Out-Null

$storePass = $env:ANDROID_KEYSTORE_PASSWORD
$keyAlias = if ($env:ANDROID_KEY_ALIAS) { $env:ANDROID_KEY_ALIAS } else { 'dunyozamin-sales' }
$keyPass = if ($env:ANDROID_KEY_PASSWORD) { $env:ANDROID_KEY_PASSWORD } else { $storePass }
$keystorePath = if ($env:ANDROID_KEYSTORE_PATH) { $env:ANDROID_KEYSTORE_PATH } else { Join-Path $Root 'credentials\release.keystore' }

if (-not $storePass) {
  Write-Host 'WARNING: ANDROID_KEYSTORE_PASSWORD not set - using local-dev placeholder. Do NOT upload this keystore to Play Store.'
  # Must match scripts/build-android-apk-docker.sh fallback (existing local keystore).
  $storePass = 'dunyozamin-sales-change-me'
  $keyPass = $storePass
}

if (-not (Test-Path $keystorePath)) {
  $genDir = Split-Path -Parent $keystorePath
  New-Item -ItemType Directory -Force -Path $genDir | Out-Null
  & keytool -genkeypair -v -storetype PKCS12 -keystore $keystorePath `
    -alias $keyAlias -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $storePass -keypass $keyPass `
    -dname 'CN=DZ Sotuvchi, OU=DunyoZamin, O=DunyoZamin, L=Tashkent, ST=Tashkent, C=UZ'
}

$relStore = if ([System.IO.Path]::IsPathRooted($keystorePath)) {
  # Gradle rootProject is android/ вЂ” store path relative to that.
  # Use forward slashes only: backslash+\r in \release is read as CR in .properties.
  $androidDir = Join-Path $Root 'android'
  $uriAndroid = New-Object System.Uri ($androidDir + [IO.Path]::DirectorySeparatorChar)
  $uriKey = New-Object System.Uri $keystorePath
  $uriAndroid.MakeRelativeUri($uriKey).ToString().Replace('\', '/')
} else {
  $keystorePath.Replace('\', '/')
}

@"
storeFile=$relStore
storePassword=$storePass
keyAlias=$keyAlias
keyPassword=$keyPass
"@ | Set-Content -Encoding ascii 'credentials\keystore.properties'

$sdkProp = $sdkRoot.Replace('\', '\\')
Set-Content -Path 'android\local.properties' -Value "sdk.dir=$sdkProp" -Encoding ascii

# Ensure Kotlin pin survives `expo prebuild --clean` (Compose / expo-modules-core needs 1.9.25;
# RN catalog defaults to 1.9.24 and breaks release compile).
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}
$gradleProps = Join-Path $Root 'android\gradle.properties'
if (Test-Path $gradleProps) {
  $gp = Get-Content $gradleProps -Raw
  if ($gp -notmatch '(?m)^android\.kotlinVersion=') {
    Add-Content -Path $gradleProps -Value "`nandroid.kotlinVersion=1.9.25`nkotlinVersion=1.9.25`n"
  }
  # Device ABIs only - avoid x86/x86_64 bloat and emulator-only libs in phone APKs.
  if ($gp -match '(?m)^reactNativeArchitectures=') {
    $gp2 = [regex]::Replace($gp, '(?m)^reactNativeArchitectures=.*$', 'reactNativeArchitectures=armeabi-v7a,arm64-v8a')
    if ($gp2 -ne $gp) { Write-Utf8NoBom $gradleProps $gp2 }
  }
}
$rootGradle = Join-Path $Root 'android\build.gradle'
if (Test-Path $rootGradle) {
  $bg = Get-Content $rootGradle -Raw
  if ($bg -match "classpath\('org\.jetbrains\.kotlin:kotlin-gradle-plugin'\)" -and $bg -notmatch 'kotlin-gradle-plugin:\$kotlinVersion') {
    $bg = $bg -replace "classpath\('org\.jetbrains\.kotlin:kotlin-gradle-plugin'\)", 'classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion")'
    Write-Utf8NoBom $rootGradle $bg
  }
}

# CRITICAL: expo prebuild resets android/app/build.gradle to debug signing.
# Without this patch, release APKs are signed with the Android Debug keystore and
# cannot update over previous release-signed installs (install fails / "won't open").
$appGradle = Join-Path $Root 'android\app\build.gradle'
if (-not (Test-Path $appGradle)) {
  throw "Missing android/app/build.gradle - run: npx expo prebuild --platform android --clean"
}
Write-Host '==> Ensuring release signing in android/app/build.gradle'
python (Join-Path $PSScriptRoot 'patch-android-release-signing.py')
if ($LASTEXITCODE -ne 0) { throw "Signing patch failed: $LASTEXITCODE" }

# CRITICAL: SplashScreenManager.registerOnActivity crashed launch on 1.1.2/1.1.3.
# Also harden splash theme / MainActivity so cold start cannot InflateException.
Write-Host '==> Hardening Android launch (no SplashScreenManager, solid splash)'
python (Join-Path $PSScriptRoot 'harden-android-launch.py')
if ($LASTEXITCODE -ne 0) { throw "Launch harden failed: $LASTEXITCODE" }
python (Join-Path $PSScriptRoot 'strip-splashscreen-manager.py')
if ($LASTEXITCODE -ne 0) { throw "SplashScreen strip failed: $LASTEXITCODE" }

Write-Host "==> assembleRelease (API=$env:EXPO_PUBLIC_STAFF_API_URL)"
Set-Location android
& .\gradlew.bat assembleRelease --no-daemon '-PreactNativeArchitectures=armeabi-v7a,arm64-v8a'
if ($LASTEXITCODE -ne 0) { throw "Gradle failed: $LASTEXITCODE" }
Set-Location $Root

$pkgVersion = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
if (-not $pkgVersion) { $pkgVersion = '0.0.0' }
$outName = "dz-sotuvchi-$pkgVersion.apk"
$apk = Get-ChildItem 'android\app\build\outputs\apk\release\*.apk' | Select-Object -First 1
$outPath = Join-Path 'dist-native' $outName
Copy-Item -Force $apk.FullName $outPath
Write-Host "==> Done: $outPath"
Get-Item $outPath | Format-List FullName, Length, LastWriteTime

$apksigner = Get-ChildItem (Join-Path $sdkRoot 'build-tools') -Recurse -Filter 'apksigner.bat' |
  Sort-Object FullName -Descending | Select-Object -First 1
if ($apksigner) {
  Write-Host '==> apksigner verify'
  & $apksigner.FullName verify --print-certs $outPath
  if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed: $LASTEXITCODE" }
}


