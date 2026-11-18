"""Fast failure-path tests. No release credentials or publishing/network operations."""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZipFile

import prepare as release
import publish

PIN = '1' * 64
VERSION = json.loads(Path('package.json').read_text())['version']
APK = dict(applicationId=release.PKG, versionCode=9, versionName=VERSION, certificateSha256=PIN, sha256='2' * 64)


class ReleaseGate(unittest.TestCase):
    def test_legacy_cannot_be_a_production_baseline(self):
        legacy = dict(tag='v3.3.1', files=['ft-pdf-debug.apk', 'SHA256SUMS.txt'])
        files = ['ft-pdf.apk', 'production.json', 'SHA256SUMS.txt']
        prior = dict(tag='v3.4.0', files=files)
        def latest(*entries):
            with patch.object(release, 'command', return_value='\n'.join(map(json.dumps, entries))):
                return release.latest_production('test/fixture')
        self.assertIsNone(latest(legacy))
        self.assertEqual(latest(prior, legacy, dict(tag='v3.10.0', files=files)), 'v3.10.0')
        with self.assertRaisesRegex(ValueError, 'Missing assets'):
            latest(prior, dict(tag='v3.5.0', files=[]))

    def test_production_has_no_generated_key_fallback(self):
        with TemporaryDirectory() as d, patch.dict(os.environ, dict(RUNNER_TEMP=d, RELEASE_INPUT=d), clear=True):
            trust = Path(d, 'certificate.sha256')
            with patch.object(release, 'PIN', trust), patch.object(release, 'sign') as sign:
                for n, cause in enumerate(('PUBLIC certificate pin', 'Missing android-production', 'differs from')):
                    os.environ['RELEASE_WORK'] = str(Path(d, str(n)))
                    if n == 1:
                        trust.write_text(PIN)
                    if n == 2:  # mock keystore material; no key is created or uploaded
                        os.environ.update(FT_PDF_RELEASE_P12_BASE64='dGVzdA==', FT_PDF_RELEASE_PASSWORD='test')
                    with self.subTest(cause=cause), patch.object(release, 'latest_production', return_value=None), \
                         patch.object(release, 'command', return_value=b'another public certificate'), self.assertRaisesRegex(ValueError, cause):
                        release.prepare('production')
                sign.assert_not_called()
                self.assertFalse(list(Path(d).glob('ft-sign-*')))
                self.assertFalse(list(Path(d).rglob('ft-pdf.apk')))

    def test_actual_apk_checks_not_just_build_configuration(self):
        signature = (f'Signer #1 certificate SHA-256 digest: {PIN}\nSigner #1 certificate DN: CN=Production\n'
                     'Verified using v2 scheme (APK Signature Scheme v2): true\n')
        badging = "package: name='studio.ftpdf.app' versionCode='9' versionName='" + VERSION + "'"
        with TemporaryDirectory() as d, patch.object(release, 'tools', side_effect=lambda n: n):
            apk = Path(d, 'app.apk')
            with ZipFile(apk, 'w') as z:
                for entry in ['studio/index.html', 'studio/ocr/english-model.bin', 'creator-contacts.json']:
                    z.writestr('assets/' + entry, b'fixture')
            for sig, pkg, manifest, ok in (
                (signature, badging, '', True),
                (signature.replace(PIN, '0' * 64), badging, '', False),
                (signature.replace('CN=Production', 'CN=Android Debug'), badging, '', False),
                (signature.replace('CN=Production', 'CN=' + release.QA_DN), badging, '', False),
                (signature, badging.replace('studio.ftpdf.app', 'different.app'), '', False),
                (signature, badging, 'android:debuggable(0x0101000f)=true', False),
                (signature, badging, 'android:testOnly(0x01010272)=true', False),
                (signature, badging + "\nuses-permission: name='android.permission.INTERNET'", '', False),
            ):
                with self.subTest(sig=sig, pkg=pkg, manifest=manifest), patch.object(release, 'command', side_effect=[sig, pkg, manifest]):
                    if ok:
                        info = release.apk_info(apk, PIN)
                        self.assertEqual(info['sha256'], release.sha(apk.read_bytes()))
                        self.assertEqual(info['versionCode'], 9)
                    else:
                        with self.assertRaises(ValueError):
                            release.apk_info(apk, PIN)

    def test_version_must_advance_and_signer_must_stay(self):
        old = dict(APK, versionCode=8)
        release.verify_update(old, APK, VERSION)
        for changes in [dict(versionCode=8), dict(versionCode=7), dict(versionName=VERSION+'-upgrade-fixture'),
                        dict(certificateSha256='0'*64), dict(applicationId='different.app')]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                release.verify_update(old, dict(APK, **changes), VERSION)

    def test_rehearsal_or_modified_artifact_cannot_publish(self):
        with TemporaryDirectory() as d:
            out = Path(d)
            trust = out / 'pin'
            trust.write_text(PIN)
            for channel, checksum, reason in [('rehearsal', APK['sha256'], 'Not the tested production artifact'),
                                              ('production', '0'*64, 'checksum mismatch')]:
                (out / 'production.json').write_text(json.dumps(dict(APK, channel=channel)))
                (out / 'SHA256SUMS.txt').write_text(checksum + '  ft-pdf.apk\n')
                with self.subTest(channel=channel), patch.object(publish, 'PIN', trust), \
                     patch.object(publish, 'apk_info', return_value=APK), patch.object(publish, 'command') as gh, \
                     self.assertRaisesRegex(ValueError, reason):
                    publish.publish(out)
                    # The first write would be a GitHub draft.
                gh.assert_not_called()


if __name__ == '__main__':
    unittest.main()
