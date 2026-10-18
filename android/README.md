# Circle for Android

A Trusted Web Activity (TWA): the app opens https://rosefly.store full screen in Chrome, so every
web feature (including message push notifications) works, shown with the Circle icon.

## Build the APK

Requirements: Android SDK (Android Studio installs it) and **JDK 17 or 21** (Gradle 8.14 does not
run on JDK 25).

```powershell
cd android
$env:JAVA_HOME = "C:\path\to\jdk-21"
.\gradlew.bat assembleRelease
copy app\build\outputs\apk\release\app-release.apk ..\client\public\downloads\circle.apk
```

Signing uses `keystore.properties` + `circle-release.jks` (not in git). **Back them up**: updates to
the installed app must be signed with the same key. If the key changes, update the SHA-256
fingerprint in `client/public/.well-known/assetlinks.json`
(`keytool -list -v -keystore circle-release.jks`).

For each release, raise `versionCode` / `versionName` in `app/build.gradle`.

## Full screen (no address bar)

Chrome hides the address bar once `https://rosefly.store/.well-known/assetlinks.json` is served
and matches the signing key. Until then the app still works, with a small URL bar on top.
