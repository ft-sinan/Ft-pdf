# Android release signing and updates

The legacy [3.3.1 download](https://github.com/ft-sinan/Ft-pdf/releases/tag/v3.3.1) is a **debug** APK (`studio.ftpdf.app`, code 8). The first production candidate is **3.4.0**, code **9**, with the same application ID. It is not available just because the source version has changed. Only a published `ft-pdf.apk` that passed the production workflow is an official production download.

## One-time setup — key owner, on a trusted computer

Use a local checkout of the intended release branch, Python 3.9+, JDK 17 `keytool`, OpenSSL, and `gh` authenticated as a maintainer allowed to manage environment secrets. **Do not run key setup in an Actions runner or hosted agent. Do not paste a keystore, password, token, or base64 into chat, issues or Git.**

1. In [repository Settings → Environments](https://github.com/ft-sinan/Ft-pdf/settings/environments), create **`android-production`**. Restrict deployments to the trusted release branch; add a required reviewer where available. Protect that branch and review changes to the workflow and `android/release/` before allowing it to use the key. If releasing from a branch other than the default, also set the **repository Actions variable** `FT_PDF_RELEASE_BRANCH` to its exact name. Do not configure any signing credentials as repository secrets or in the `android-rehearsal` environment.
2. Mount a separate encrypted backup volume. Prepare a private directory on your working disk and a directory on the mounted volume. Choose a strong, unique password and store it in your password manager. For example, on Linux, with the backup already mounted at `/media/$USER/FT-Backup`:

   ```sh
   mkdir -m 700 -p "$HOME/.ft-pdf-keys"
   python3 android/release/setup_key.py create \
     "$HOME/.ft-pdf-keys/ft-pdf.p12" "/media/$USER/FT-Backup/ft-pdf.p12"
   ```

   Substitute the actual mount path (e.g. `/Volumes/FT-Backup` on macOS). Run **`create` only once**. To use an existing long-lived non-debug PKCS12, or retry after a partial setup, use **`restore`** in the same command. It expects alias `ft-pdf` and the same password for the store and private key. If your existing production key is in another format, use `keytool -importkeystore` **locally** to copy that same key into a new PKCS12 with this alias; changing the private key is not a conversion.
3. The helper creates or reads the working key, reads back the backup from the other volume, and makes a certificate request with the **backup private key** to check it and the password work. It refuses to overwrite an existing key or mismatched backup. Check the public fingerprint it prints, then confirm the upload locally. `gh` encrypts and sends `FT_PDF_RELEASE_P12_BASE64` and `FT_PDF_RELEASE_PASSWORD` to the `android-production` environment via stdin. Neither secret is a workflow input. GitHub is **not** your recovery copy. Periodically test a restore with the password from your password manager.
4. The only file to commit is **`android/release/certificate.sha256`**: one lowercase, 64-character SHA-256 fingerprint of the DER signing certificate. It is public and **not** the APK checksum. Check it independently on the backup (the password prompt is local):

   ```sh
   keytool -exportcert -keystore "/media/$USER/FT-Backup/ft-pdf.p12" -alias ft-pdf | openssl dgst -sha256
   cat android/release/certificate.sha256
   ```

   Disconnect and secure the backup volume. Review and commit the pin on the approved release branch. Never change the pin to “fix” a failed update. The workflow has no production key-generation or fallback path.

## Build, verify and publish

In **Actions → Android production APK → Run workflow**, choose the trusted branch and **`production`**. If the workflow hasn't landed on the default branch yet, use a trusted push whose **head commit message** includes `[release-android]` instead (this can be the commit adding the reviewed public pin). For a trial use `rehearsal` or `[test-android-update]`; **it needs no secrets and cannot publish its APK**.

- Build: Gradle assembles `:app:assembleRelease` with no signing credentials. A separate package, `studio.ftpdf.updatecheck`, drives the visible UI; neither it nor instrumentation is part of the shipping APK.
- Sign: the production step requires the environment keystore, password and committed fingerprint. It checks the certificate before signing. `apksigner verify` and `aapt2` inspect the **actual APK**: one pinned signer, v2 signature, production version, `studio.ftpdf.app`, not debuggable/test-only, expected offline resources and no internet/microphone permission. The APK SHA-256 is recorded separately.
- Upgrade: on a clean Android 15 emulator in airplane mode, install the baseline, create a text document with fresh random content, save it, and stop the app. Install **the candidate bytes** with `adb install -r` (no uninstall, clear, downgrade or `-t`). Open the existing library and compare the saved document content. Android's package manager is also queried for the installed certificate and version before and after.
- **First production release only:** the baseline is a lower-code, non-debuggable fixture from the same source, signed with the same production key, **not the published 3.3.1 APK**. Subsequent productions must use the previous **published** `ft-pdf.apk`, checking its checksum, signature, version and strictly increasing code. If that baseline is missing or incompatible the workflow fails rather than quietly substituting a fixture.
- Publish: only after the installed test passes, a separate job without the private key rechecks the tested APK, creates a **new draft**, downloads and compares all staged bytes, then publishes it as Latest. It never rebuilds, re-signs, retargets a tag, or overwrites 3.3.1. The assets are `ft-pdf.apk`, `SHA256SUMS.txt`, and `production.json` (public signer, APK and baseline identifiers). If staging fails, leave the draft unpublished; inspect it rather than overwriting existing assets.

For the next version, advance `package.json` and its lockfile (e.g. `npm version patch --no-git-tag-version`) **and** `productionCode` in `android/app/build.gradle`. Keep the application ID, keystore and certificate pin unchanged. A routine Android production update means installing the newer APK **over** the old production app, not uninstalling it first. This process is for the directly distributed APK; a Play App Signing build signed by a different key is a separate update channel.

## For people using 3.3.1

Its signing certificate SHA-256 is `460c7dbaa5adda0957cfb0f751c19bb3fd23c39a29d94acfc47164e048909692` (Android Debug). The production workflow rejects that signer. **Do not uninstall while the private library is your only copy.** For every important document, use **Save a copy to Files**, choose a location outside the app, and open the exported file to verify it. Only then, when the production APK is available, uninstall the debug app, install production, and import the files. Uninstalling erases local profiles, collections, settings and private documents; exporting documents does not back up that metadata. You can keep using 3.3.1 until you are ready.
