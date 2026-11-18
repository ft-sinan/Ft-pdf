#!/usr/bin/env python3
"""Publish ONLY the artifact that passed device-upgrade.sh in this production run."""
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

from prepare import PIN, VERSION, apk_info, command, latest_production, require


def publish(out):
    version = json.loads(Path('package.json').read_text())['version']
    tag = 'v' + version
    require(VERSION.fullmatch(version), 'Invalid tag.')
    apk = out / 'ft-pdf.apk'
    actual = apk_info(apk, PIN.read_text().strip())  # No private key is used by this job.
    tested = json.loads((out / 'production.json').read_text())
    require(actual['versionName'] == version and actual['versionCode'] > 8 and
            tested['channel'] == 'production' and all(tested[k] == v for k, v in actual.items()),
            'Not the tested production artifact for this version and certificate.')
    require((out / 'SHA256SUMS.txt').read_text() == actual['sha256'] + '  ft-pdf.apk\n', 'APK checksum mismatch.')
    prior = tested['previousProduction']
    require(latest_production() == prior, 'A different release was published while this candidate was being tested. Retest against it.')
    repo = os.environ['GITHUB_REPOSITORY']
    commit = os.environ['GITHUB_SHA']
    require(not command('gh', 'api', '--paginate', f'repos/{repo}/releases?per_page=100',
                        '--jq', f'.[] | select(.tag_name == "{tag}") | .id').strip(), 'A release/draft with that version already exists. Not overwriting it.')
    def existing_tag():
        return command('gh', 'api', f'repos/{repo}/git/matching-refs/tags/{tag}',
                            '--jq', f'.[] | select(.ref == "refs/tags/{tag}") | .ref').strip()
    require(not existing_tag(), 'Tag already exists. Refusing to retarget it.')
    files = [apk, out / 'SHA256SUMS.txt', out / 'production.json']
    baseline = f'the published **{prior}** APK' if prior else 'a lower-version test build signed with the same production key (not v3.3.1)'
    notes = f'''Install **ft-pdf.apk** on Android 8.0 or later. This is a non-debuggable release of `studio.ftpdf.app`, version code **{actual['versionCode']}**.

**Update check:** Installed {baseline}, saved a private text document, installed this exact APK over it without clearing data, and reopened the saved content offline. [Android test run](https://github.com/{repo}/actions/runs/{os.environ['GITHUB_RUN_ID']}).

**Coming from the legacy 3.3.1 debug download?** That APK uses a different signer. Before uninstalling, use **Save a copy to Files** on every important document and open the exported files to verify them. Uninstalling erases the private library, including its collections, profiles and settings. Then install this APK and import your copies. For subsequent production updates, install over the current production app; do not uninstall first.

Signing certificate SHA-256: `{actual['certificateSha256']}`
APK SHA-256: `{actual['sha256']}`
'''
    command('gh', 'release', 'create', tag, '--repo', repo, '--target', commit, '--draft',
            '--title', 'Ft PDF ' + version, '--notes', notes, *files)
    draft = json.loads(command('gh', 'release', 'view', tag, '--repo', repo, '--json', 'isDraft,targetCommitish,assets'))
    require(draft['isDraft'] and draft['targetCommitish'] == commit and
            {a['name'] for a in draft['assets']} == {f.name for f in files}, 'Unexpected draft; leaving unpublished.')
    with TemporaryDirectory() as staged:
        command('gh', 'release', 'download', tag, '--repo', repo, '--dir', staged)
        for f in files:
            require(Path(staged, f.name).read_bytes() == f.read_bytes(), 'Staged asset mismatch: ' + f.name)
    if existing_tag():
        require(command('gh', 'api', f'repos/{repo}/commits/{tag}', '--jq', '.sha').strip() == commit, 'Draft tag points to a different commit; not publishing.')
    print(command('gh', 'release', 'edit', tag, '--repo', repo, '--draft=false', '--latest'))


if __name__ == '__main__':
    try:
        publish(Path(sys.argv[1]))
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        sys.exit('Publication stopped: ' + str(exc))
