import { useState } from 'react';
import { ArrowRight, Check, Copy, Download, FilePlus2, Smartphone } from 'lucide-react';
import { Modal } from './UI';
export default function AndroidDialog({
  close,
  isDemo,
  register,
}: {
  close: () => void;
  isDemo: boolean;
  register: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const native = navigator.userAgent.includes('FtPDF-Android');
  const address = location.origin;
  return (
    <Modal
      title="Ft PDF for Android"
      kicker="TAKE YOUR WORKSPACE WITH YOU"
      subtitle="Open files from your phone and edit them in the same document studio."
      onClose={close}
    >
      <div className="modal-body">
        <div className="android-card">
          <span>
            <Smartphone size={26} />
          </span>
          <div>
            <strong>
              {native ? 'You’re using the Android client' : 'Android workspace client'}
            </strong>
            <p>Android 8.0+ · Debug APK</p>
          </div>
        </div>
        {navigator.userAgent.includes('FtPDF-LocalCreator/1') && (
          <button className="btn primary" onClick={() => location.assign('ftpdf://create-pdf')}>
            <FilePlus2 size={16} /> Create PDF on this device
          </button>
        )}
        {!native && (
          <a
            className="btn primary full"
            href="/downloads/ft-pdf-debug.apk"
            download="Ft-PDF-debug.apk"
          >
            <Download size={16} />
            Download Android APK
          </a>
        )}
        <div className="android-step">
          <strong>{native ? 'Connected workspace' : 'Connect to your workspace'}</strong>
          <p>
            {native
              ? 'This device is connected to the server below.'
              : 'Choose Create PDF on the Android home screen to save a PDF without a server. For the online library, connect to an HTTPS workspace address your phone can reach.'}
          </p>
        </div>
        <div className="address-field">
          <input
            aria-label="Workspace server address"
            readOnly
            value={address}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="icon-btn"
            title={copied ? 'Copied' : 'Copy workspace address'}
            aria-label="Copy workspace address"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                setCopied(true);
              } catch {
                const i = document.querySelector<HTMLInputElement>('.address-field input');
                i?.focus();
                i?.select();
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
        {isDemo && (
          <div className="android-step">
            <strong>Use your files on both devices</strong>
            <p>
              Create an account in this workspace, then sign in to it on Android. Separate demo
              sessions don’t share documents.
            </p>
            <button className="text-btn" onClick={register}>
              Create account <ArrowRight size={13} />
            </button>
          </div>
        )}
        {!native ? (
          <p className="pwa-tip">
            <strong>Prefer the web app?</strong> Open this workspace in Chrome on Android and choose{' '}
            <b>Install app</b> or <b>Add to Home screen</b> from the browser menu.
          </p>
        ) : (
          <button className="btn secondary" onClick={() => location.assign('ftpdf://settings')}>
            Change workspace address
          </button>
        )}
      </div>
    </Modal>
  );
}
