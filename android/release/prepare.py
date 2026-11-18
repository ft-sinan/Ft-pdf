#!/usr/bin/env python3
"""Sign AND verify release-mode Android artifacts. Only 'production' can feed publication.

Run from the repository root. Private material lives in a temporary runner directory,
not the checkout, build tree, cache, process arguments, output bundle or job logs.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import zipfile

PKG = 'studio.ftpdf.app'
PIN = Path('android/release/certificate.sha256')  # public, owner-approved fingerprint
ALIAS = 'ft-pdf'
QA_DN = 'Ft PDF rehearsal only'
VERSION = re.compile(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)')
SHA = re.compile(r'[0-9a-f]{64}')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def command(*args, env=None, binary=False):
    return subprocess.check_output(args, text=not binary, env=env)


def tools(name):
    return Path(os.environ['ANDROID_HOME'], 'build-tools', '35.0.0', name)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def apk_info(apk, pin, rehearsal=False):
    sig = command(tools('apksigner'), 'verify', '--verbose', '--print-certs', apk)
    certs = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$', sig, re.M)
    require(certs == [pin] and SHA.fullmatch(pin), 'APK signing certificate does not match the approved SHA-256 pin.')
    require('Verified using v2 scheme (APK Signature Scheme v2): true' in sig, 'APK v2 signature required.')
    dn = re.search(r'^Signer #1 certificate DN: (.+)$', sig, re.M).group(1)
    require('android debug' not in dn.lower(), 'The Android debug signer is not a release key.')
    require((QA_DN.lower() in dn.lower()) == rehearsal, 'Rehearsal signer and production signer must be distinct.')
    badging = command(tools('aapt2'), 'dump', 'badging', apk)
    package = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging, re.M)
    require(package and package[1] == PKG, 'Unexpected application ID.')
    manifest = command(tools('aapt2'), 'dump', 'xmltree', '--file', 'AndroidManifest.xml', apk)
    require('application-debuggable' not in badging and not re.search(
        r'android:(?:debuggable|testOnly|profileableByShell)\([^)]*\)=(?:true|0xffffffff)', manifest),
        'Debug, test-only and shell-profileable builds cannot ship.')
    for perm in ('INTERNET', 'RECORD_AUDIO'):
        require(f"name='android.permission.{perm}'" not in badging, 'Unexpected permission: ' + perm)
    with zipfile.ZipFile(apk) as z:
        names = z.namelist()
        for needed in ('assets/studio/index.html', 'assets/studio/ocr/english-model.bin', 'assets/creator-contacts.json'):
            require(needed in names, 'Missing offline resource: ' + needed)
        require(not any(s.startswith('assets/seed/') or s.lower().endswith(('.p12', '.jks', '.keystore', '.pfx')) for s in names), 'Unexpected packaged content.')
    return dict(applicationId=PKG, versionCode=int(package[2]), versionName=package[3], certificateSha256=pin, sha256=sha(apk.read_bytes()))


def verify_update(old, new, version):
    require(VERSION.fullmatch(version) and new['versionName'] == version, 'Not the requested production version.')
    require(old['applicationId'] == new['applicationId'] == PKG, 'An update cannot change the application ID.')
    require(old['certificateSha256'] == new['certificateSha256'], 'An update cannot change the production signer.')
    require(new['versionCode'] > 8 and 0 < old['versionCode'] < new['versionCode'], 'Production versionCode must advance past both 3.3.1 and the baseline.')


def latest_production():
    # Never treat an API failure as a first release. Inspect published production
    # assets independently of the branch checkout, including on stale branches.
    tags = command('gh', 'api', '--paginate', f'repos/{os.environ["GITHUB_REPOSITORY"]}/releases?per_page=100',
                   '--jq', '.[] | select(.draft == false and .prerelease == false and any(.assets[]; .name == "ft-pdf.apk")) | .tag_name').splitlines()
    for tag in tags:
        require(tag.startswith('v') and VERSION.fullmatch(tag[1:]), 'Unexpected production tag: ' + tag)
    return max(tags, key=lambda t: tuple(map(int, t[1:].split('.'))), default=None)


def sign(src, dst, store, env):
    # AGP aligns the unsigned package. Never modify a package after signing it.
    subprocess.run([tools('zipalign'), '-c', '4', src], check=True)
    subprocess.run([tools('apksigner'), 'sign', '--ks', store, '--ks-key-alias', ALIAS,
                    '--ks-pass', 'env:FT_KEY_PASS', '--key-pass', 'env:FT_KEY_PASS',
                    '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true',
                    '--v4-signing-enabled', 'false', '--out', dst, src], env=env, check=True)


def prepare(mode):
    os.umask(0o077)
    rehearsal = mode == 'rehearsal'
    # Do not forward vault contents to gh, emulator or unrelated child processes.
    encoded = os.environ.pop('FT_PDF_RELEASE_P12_BASE64', '')
    password = os.environ.pop('FT_PDF_RELEASE_PASSWORD', '')
    root = Path(os.environ['RUNNER_TEMP']).resolve()
    inputs = Path(os.environ['RELEASE_INPUT']).resolve()
    work = Path(os.environ['RELEASE_WORK']).resolve()
    require(root in work.parents, 'Signing outputs must be under RUNNER_TEMP.')
    out = work / 'out'
    out.mkdir(parents=True, exist_ok=False)
    version = json.loads(Path('package.json').read_text())['version']
    require(VERSION.fullmatch(version), 'Invalid version.')
    if rehearsal:
        require(not encoded and not password, 'A rehearsal must not receive production credentials.')
        password = secrets.token_hex(32)
        prior = None
    else:
        require(PIN.is_file(), 'Set up the owner-backed key and commit its PUBLIC certificate pin first.')
        pin = PIN.read_text().strip().lower()
        require(SHA.fullmatch(pin), 'Invalid production certificate pin.')
        require(encoded and password, 'Missing android-production signing secrets. There is no fallback signer.')
        prior = latest_production()
    keyenv = {**os.environ, 'FT_KEY_PASS': password}
    with tempfile.TemporaryDirectory(dir=root, prefix='ft-sign-') as private:
        store = Path(private, 'signer.p12')
        if rehearsal:
            subprocess.run(['keytool', '-genkeypair', '-storetype', 'PKCS12', '-keystore', store,
                            '-alias', ALIAS, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '7',
                            '-dname', 'CN=' + QA_DN, '-storepass:env', 'FT_KEY_PASS'], env=keyenv, check=True)
        else:
            store.write_bytes(base64.b64decode(encoded, validate=True))
        cert = sha(command('keytool', '-exportcert', '-keystore', store, '-storetype', 'PKCS12',
                           '-alias', ALIAS, '-storepass:env', 'FT_KEY_PASS', env=keyenv, binary=True))
        if rehearsal:
            pin = cert
        else:
            require(cert == pin, 'Configured keystore differs from the independently recorded certificate. Refusing to sign.')
        old_apk = work / 'before.apk'
        if prior:
            old_dir = work / 'prior-release'
            command('gh', 'release', 'download', prior, '--repo', os.environ['GITHUB_REPOSITORY'],
                    '--pattern', 'ft-pdf.apk', '--pattern', 'SHA256SUMS.txt', '--dir', old_dir)
            shutil.copyfile(old_dir / 'ft-pdf.apk', old_apk)
            require((old_dir / 'SHA256SUMS.txt').read_text().split() == [sha(old_apk.read_bytes()), 'ft-pdf.apk'], 'Previous release checksum mismatch.')
        else:
            sign(inputs / 'upgrade-fixture-unsigned.apk', old_apk, store, keyenv)
        old = apk_info(old_apk, pin, rehearsal)
        if prior:
            require(prior == 'v' + old['versionName'] and tuple(map(int, version.split('.'))) > tuple(map(int, prior[1:].split('.'))), 'Version name must advance from the published production version.')
        else:
            require(old['versionName'] == version + '-upgrade-fixture', 'Invalid first-release test fixture.')
        candidate = out / 'ft-pdf.apk'
        sign(inputs / 'candidate-unsigned.apk', candidate, store, keyenv)
    new = apk_info(candidate, pin, rehearsal)
    verify_update(old, new, version)
    if not rehearsal and not prior:
        require(new['versionCode'] == 9, 'Missing previous production release; a fixture is only valid for the initial production code 9.')
    new.update(channel=mode, previousProduction=prior, baselineSha256=old['sha256'], baselineVersionCode=old['versionCode'],
               upgradeBaseline='published-apk' if prior else 'first-release-fixture')
    (out / 'production.json').write_text(json.dumps(new, indent=2) + '\n')
    (out / 'SHA256SUMS.txt').write_text(new['sha256'] + '  ft-pdf.apk\n')
    (work / 'before.json').write_text(json.dumps(old))
    print(f"Verified {mode}: {PKG}, codes {old['versionCode']} → {new['versionCode']}, signer SHA-256 {pin}.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['rehearsal', 'production'])
    try:
        prepare(parser.parse_args().mode)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        sys.exit('Release preparation stopped: ' + str(exc))
