#!/usr/bin/env bash
# The Actions summary should identify the failing device assertion or setup step, not just 'exit 1'.
set -uo pipefail
log="${RUNNER_TEMP:-/tmp}/ft-pdf-instrumentation.log"
./gradlew --no-daemon --console=plain :app:connectedDebugAndroidTest 2>&1 | tee "$log"
result=${PIPESTATUS[0]}
if [[ "$result" -ne 0 && -n "${GITHUB_ACTIONS:-}" ]]; then
  python3 - "$log" <<'PY'
import pathlib, sys, xml.etree.ElementTree as ET
failures=[]
for path in pathlib.Path('app/build/outputs/androidTest-results').rglob('*.xml'):
    try:
        for case in ET.parse(path).iter('testcase'):
            for node in list(case):
                if node.tag in ('failure','error'):
                    failures.append(case.get('name','test')+': '+str(node.get('message') or node.text or '')[:1000])
    except ET.ParseError:
        pass
if not failures:
    lines=pathlib.Path(sys.argv[1]).read_text(errors='replace').splitlines()
    start=next((i for i,l in enumerate(lines) if '* What went wrong:' in l),max(0,len(lines)-20))
    failures=[' '.join(lines[start:start+16])[:2200]]
for msg in failures[:4]:
    print('::error title=Android device test::'+msg.replace('%','%25').replace('\n','%0A').replace('\r','%0D'))
PY
fi
exit "$result"
