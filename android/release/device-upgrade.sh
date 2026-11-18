#!/usr/bin/env bash
# On a fresh disposable emulator only. Never uninstall or clear the app between installations.
set -euo pipefail
: "${RELEASE_WORK:?}" "${RELEASE_INPUT:?}"
pkg=studio.ftpdf.app; probe=studio.ftpdf.updatecheck
if adb shell pm path "$pkg" | grep -q '^package:'; then echo 'Use a clean emulator; refusing to touch an existing library.' >&2; exit 1; fi
adb install "$RELEASE_INPUT/probe.apk"
adb install -t "$RELEASE_INPUT/probe-test.apk"
adb shell cmd package set-home-activity --user 0 "$probe/.IdleHome"
adb shell am force-stop com.google.android.apps.nexuslauncher
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb shell wm size 1200x2000
adb shell wm density 180
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
adb shell svc data disable
test "$(adb shell settings get global airplane_mode_on | tr -d '\r')" = 1
nonce=$(openssl rand -hex 8)
signer=$(jq -er '.certificateSha256' "$RELEASE_WORK/out/production.json")
before=$(jq -er '.versionCode' "$RELEASE_WORK/before.json")
after=$(jq -er '.versionCode' "$RELEASE_WORK/out/production.json")
(( before < after ))
run_case() {
  local method="$1" code="$2" log="$RELEASE_WORK/$1.log"
  adb shell am instrument -w -e class "$probe.UpgradeTest#$method" -e code "$code" -e signer "$signer" -e nonce "$nonce" "$probe.test/androidx.test.runner.AndroidJUnitRunner" | tee "$log"
  if ! grep -Eq 'OK \(1 test\)' "$log"; then
    python3 - "$log" <<'PY'
import pathlib,sys
text=pathlib.Path(sys.argv[1]).read_text();print('::error title=Release update check::'+text[-2600:].replace('%','%25').replace('\r','').replace('\n','%0A'))
PY
    exit 1
  fi
}
adb install "$RELEASE_WORK/before.apk"
run_case saveBeforeUpdate "$before"
adb shell am force-stop "$pkg"
# No -t, no downgrade, no data reset. The Android installer verifies update compatibility.
adb install -r "$RELEASE_WORK/out/ft-pdf.apk"
run_case reopenAfterUpdate "$after"
echo "Passed: code $before → $after, one signer, private document reopened offline."
