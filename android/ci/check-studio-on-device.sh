#!/usr/bin/env bash
# Install the very same signed file offered for download; never rebuild the app in this job.
set -euo pipefail
pkg=studio.ftpdf.app
(cd "$APK_DIR" && sha256sum -c SHA256SUMS.txt)
adb install -r -t "$APK_DIR/ft-pdf-debug.apk"
adb install -r -t "$APK_DIR/test.apk"
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
adb shell svc data disable
test "$(adb shell settings get global airplane_mode_on | tr -d '\r')" = 1
adb shell dumpsys webviewupdate | head -15
report="${RUNNER_TEMP:-/tmp}/studio-device-results"
mkdir -p "$report"
run_case() {
  local group="$1" n="$2" log="$report/$3.txt"
  adb shell am instrument -w -e class "$group" "$pkg.test/androidx.test.runner.AndroidJUnitRunner" | tee "$log"
  if ! grep -Eq "OK \($n tests?\)" "$log"; then
    adb exec-out screencap -p > "$report/failure.png" || true
    adb logcat -d -t 2500 > "$report/device.log" || true
    python3 - "$log" "$report/device.log" <<'PY'
import pathlib,sys,re
log=pathlib.Path(sys.argv[1]).read_text(errors='replace')
errors=re.findall(r'(?:AssertionError|Exception|Error):[^\n]*(?:\n(?!\s+at |\s*at |Time:|Tests run:)[^\n]*){0,25}',log)
extra='; '.join(line[-420:] for line in pathlib.Path(sys.argv[2]).read_text(errors='replace').splitlines() if 'CONSOLE(' in line)[-1200:]
print('::error title=Installed APK test failed::'+('\n'.join(errors)[:2400] or log[-1700:]).replace('%','%25').replace('\r','').replace('\n','%0A')+' '+extra.replace('%','%25'))
PY
    exit 1
  fi
}
adb shell pm clear "$pkg"
run_case "$pkg.LocalProfileTest#createProfileAndCollection" 1 first-launch
adb shell am force-stop "$pkg"
run_case "$pkg.LocalProfileTest#recoverProfileAndEnforceIsolation" 1 cold-restart
adb shell pm clear "$pkg"
run_case "$pkg.OfflineStudioTest" 4 editors-and-files
run_case "$pkg.LocalPdfWriterTest" 2 pdf-renderer
