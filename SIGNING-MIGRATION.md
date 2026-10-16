# Signing migration — action required

The formerly committed signing key is exposed and must not be treated as a private production key. Removing it from the current tree does not revoke it or erase Git history / old APKs.

The build now requires four GitHub Actions secrets: ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD. Missing secrets stop the build; there is no silent fallback key. Do not paste signing secrets into chat or commit them.

The owner must choose an Android signing-key migration strategy before distributing an update. A newly generated key normally cannot update installations signed by the old key. Preserve/export user data and plan the migration; do not claim upgrade compatibility without installing over the old APK on a device. The current published APKs have not been replaced by this change.
