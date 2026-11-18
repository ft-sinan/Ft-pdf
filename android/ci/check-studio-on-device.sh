#!/usr/bin/env bash
# Install the very same signed file offered for download; never rebuild the app in this job.
set -euo pipefail
pkg=studio.ftpdf.app
(cd "$APK_DIR" && sha256sum -c SHA256SUMS.txt)
adb install -r -t "$APK_DIR/ft-pdf-debug.apk"
adb install -r -t "$APK_DIR/test.apk"
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
# Do not hide ANRs or auto-click system dialogs. Pixel Launcher on the Google APIs
# image can itself ANR offline and cover DocumentsUI. Use a test-only, inert HOME
# between cases on the disposable Actions emulator; keep the real pickers/permissions.
if [[ "${GITHUB_ACTIONS:-false}" == true ]]; then
  home="$pkg.test/.IdleHome"
  adb shell cmd package set-home-activity --user 0 "$home"
  if ! adb shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME | grep -Fq "$pkg.test/"; then
    echo '::error::Test-only home was not selected on the CI emulator'; exit 1
  fi
  adb shell am force-stop com.google.android.apps.nexuslauncher
  adb shell am start -W -a android.intent.action.MAIN -c android.intent.category.HOME
fi
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
for err in (errors or [log[-1700:]])[:6]:
    print('::error title=Installed APK test '+pathlib.Path(sys.argv[1]).stem+'::'+(err[:250]+' ... '+err[-1400:] if len(err)>1800 else err).replace('%','%25').replace('\r','').replace('\n','%0A')+' '+extra.replace('%','%25'))
PY
    exit 1
  fi
}
failures=0
# Keep diagnostic coverage independent. Every failed case still blocks publication.
required_case() { (run_case "$@") || failures=1; }
adb shell pm clear "$pkg"
required_case "$pkg.LocalProfileTest#createProfileAndCollection" 1 first-launch
adb exec-out run-as "$pkg" cat cache/first-launch.png > "$report/first-launch.png" || true
adb shell am force-stop "$pkg"
required_case "$pkg.LocalProfileTest#recoverProfileAndEnforceIsolation" 1 cold-restart
adb shell pm clear "$pkg"
required_case "$pkg.OfflineStudioTest#createEditAndReopenPDF" 1 pdf-editor
required_case "$pkg.OfflineStudioTest#htmlSourceIsEditableAndPreviewIsSandboxed" 1 html-editor
required_case "$pkg.OfflineStudioTest#textRoundTripsThroughTheSystemFilesPicker" 1 files-roundtrip
required_case "$pkg.OfflineStudioTest#wordFilesOpenWithAndroidEditAndSerializeOffline" 1 word-formats
required_case "$pkg.ReaderSpaceTest#scrollPdfThenEditAndReadAgain" 1 scroll-reader
required_case "$pkg.ReaderSpaceTest#creatorCardOpensOnlyTheSelectedContactOutsideStudio" 1 creator-space
required_case "$pkg.LocalPdfWriterTest" 2 pdf-renderer
# Test permission granted and denied in separate processes. Never waive app-level opt-in.
adb shell pm clear "$pkg"
adb shell appops set --uid "$pkg" MANAGE_EXTERNAL_STORAGE allow
required_case "$pkg.PhoneToolsTest#sharedFilesAppearOnHomeAndOriginalIsUntouched" 1 shared-storage
adb shell appops set --uid "$pkg" MANAGE_EXTERNAL_STORAGE deny
required_case "$pkg.PhoneToolsTest#folderGrantWorksWithoutAllFilesAccess" 1 folder-access
required_case "$pkg.PhoneToolsTest#orderAndRotatePhotosFromAndroidFiles" 1 image-pdf
required_case "$pkg.PhoneToolsTest#mergeAndExportSplitZipViaFiles" 1 toolbox-export
required_case "$pkg.PhoneToolsTest#offlineOcrProducesSearchablePages" 1 offline-ocr
required_case "$pkg.PhoneToolsTest#passwordProtectedCopyRoundTrip" 1 password-roundtrip
exit "$failures"
