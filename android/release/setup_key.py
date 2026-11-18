#!/usr/bin/env python3
"""One-time maintainer operation on a trusted computer, NEVER in CI or the chat workspace."""
import argparse
import base64
import getpass
import json
import os
from pathlib import Path
import subprocess
import sys

from prepare import ALIAS, PIN, QA_DN, command, latest_production, require, sha

REPO = 'ft-sinan/Ft-pdf'
ENVIRONMENT = 'android-production'
KEY_SECRET = 'FT_PDF_RELEASE_P12_BASE64'
PASS_SECRET = 'FT_PDF_RELEASE_PASSWORD'


def locations(repo, working, backup):
    for p in (working, backup):
        require(repo != p and repo not in p.parents, 'Keep both key files OUTSIDE this checkout.')
        require(p.parent.is_dir(), 'Both parent directories must already exist. Is the encrypted backup volume mounted?')
    require(working != backup and working.parent.stat().st_dev != backup.parent.stat().st_dev,
            'Specify working and backup files on different mounted volumes, not two copies on the same disk.')


def setup(mode, working, backup):
    require(not os.getenv('CI') and sys.stdin.isatty(), 'Run interactively on the key owner’s trusted computer, not a runner.')
    os.umask(0o077)
    repo = Path(__file__).resolve().parents[2]
    os.chdir(repo)
    working, backup = working.expanduser().resolve(), backup.expanduser().resolve()
    locations(repo, working, backup)
    require(mode != 'create' or (not working.exists() and not backup.exists() and not PIN.exists()),
            'Refusing to create a replacement key. Use restore with the existing keystore and verified backup.')
    require(mode != 'restore' or working.is_file(), 'Missing existing PKCS12 keystore.')
    environment = json.loads(command('gh', 'api', f'repos/{REPO}/environments/{ENVIRONMENT}'))
    require(environment.get('deployment_branch_policy'), 'Restrict android-production to trusted deployment branches in GitHub Settings first.')
    prior = latest_production(REPO)
    configured = command('gh', 'api', '--paginate', f'repos/{REPO}/environments/{ENVIRONMENT}/secrets?per_page=100', '--jq', '.secrets[].name').splitlines()
    require(PIN.is_file() or (not prior and not {KEY_SECRET, PASS_SECRET}.intersection(configured)),
            'Production already exists or signing secrets are configured. Recover the previously approved PUBLIC pin before continuing.')
    print(f'Target: {REPO}, environment: {ENVIRONMENT}. Keep the keystore password in a password manager separate from the disks.')
    password = getpass.getpass('PKCS12 password (not echoed; use at least 16 characters): ')
    require(len(password) >= 16 and '\n' not in password and '\r' not in password and '\0' not in password,
            'Use a strong password of at least 16 characters.')
    env = {**os.environ, 'FT_KEY_PASS': password}

    def keytool(store, *args):
        return subprocess.check_output(['keytool', *args, '-keystore', store, '-storetype', 'PKCS12',
                                        '-alias', ALIAS, '-storepass:env', 'FT_KEY_PASS'], env=env, stdin=subprocess.DEVNULL)

    if mode == 'create':
        require(getpass.getpass('Confirm password: ') == password, 'Password confirmation did not match.')
        keytool(working, '-genkeypair', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '14600',
                '-dname', 'CN=Ft PDF Android Release', '-sigalg', 'SHA256withRSA')
    cert = keytool(working, '-exportcert')
    fingerprint = sha(cert)
    if PIN.exists():
        require(PIN.read_text().strip() == fingerprint, 'Different key from the committed pin. Do not replace the production signer.')
    if prior:
        # Even a stale or modified checkout must not overwrite a working production secret.
        published = json.loads(command('gh', 'release', 'download', prior, '--repo', REPO, '--pattern', 'production.json', '--output', '-'))
        require(published['certificateSha256'] == fingerprint, 'Different key from the last published production release.')
    subject = subprocess.check_output(['openssl', 'x509', '-inform', 'DER', '-noout', '-subject', '-checkend', '31536000'], input=cert).decode().lower()
    require('android debug' not in subject and QA_DN.lower() not in subject, 'Debug and rehearsal keys are not eligible.')
    encoded = working.read_bytes()
    if not backup.exists():
        with backup.open('xb') as f:
            f.write(encoded)
            f.flush()
            os.fsync(f.fileno())
    require(backup.read_bytes() == encoded and keytool(backup, '-exportcert') == cert, 'Backup read-back failed. Existing files are never overwritten.')
    keytool(backup, '-certreq', '-keypass:env', 'FT_KEY_PASS')  # Prove it can use the private key, not just list its certificate.
    print(f'Backup verified. PUBLIC certificate SHA-256: {fingerprint}')
    require(input(f'Enter {ENVIRONMENT} to send both encrypted secrets to GitHub: ').strip() == ENVIRONMENT, 'Cancelled; no secrets uploaded.')
    if not PIN.exists():
        with PIN.open('x') as f:
            f.write(fingerprint + '\n')
    for name, value in ((KEY_SECRET, base64.b64encode(encoded)), (PASS_SECRET, password.encode())):
        # gh encrypts before sending. No secret in shell history, process arguments, or stdout.
        subprocess.run(['gh', 'secret', 'set', name, '--repo', REPO, '--env', ENVIRONMENT], input=value, check=True)
    print(f'Configured. Disconnect and secure the backup volume. Review and commit ONLY {PIN}. Never commit either keystore or password.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['create', 'restore'], help='Create once; restore reuses a pre-existing PKCS12 with alias ft-pdf.')
    parser.add_argument('working', type=Path)
    parser.add_argument('backup', type=Path)
    args = parser.parse_args()
    try:
        setup(args.mode, args.working.absolute(), args.backup.absolute())
    except (OSError, ValueError, subprocess.CalledProcessError, EOFError, KeyboardInterrupt) as exc:
        sys.exit('Stopped: ' + str(exc) + '\nIf a key was already created, keep it and rerun with restore. Do not generate another key.')
