import { Download, Smartphone } from 'lucide-react';
import { Modal } from './UI';
export default function AndroidDialog({ close }: { close: () => void }) {
  return (
    <Modal
      title="Ft PDF for Android"
      kicker="ON YOUR PHONE"
      subtitle="Take a complete document studio offline."
      onClose={close}
    >
      <div className="modal-body">
        <div className="android-card">
          <span>
            <Smartphone size={26} />
          </span>
          <div>
            <strong>Ft PDF · Android edition</strong>
            <p>Android 8.0+ · Debug APK</p>
          </div>
        </div>
        <a
          className="btn primary full"
          href="/downloads/ft-pdf-debug.apk"
          download="Ft-PDF-debug.apk"
        >
          <Download size={16} />
          Download Android APK
        </a>
        <div className="android-step">
          <strong>Open the app and start editing</strong>
          <p>
            No server setup. Create PDFs, edit Word, text and HTML, and organize documents in a
            library saved on your phone.
          </p>
        </div>
        <div className="android-step">
          <strong>Move files between editions</strong>
          <p>
            The Android library and its accounts are local to the device. Export a copy from one
            edition and import it in the other; they do not sync automatically.
          </p>
        </div>
      </div>
    </Modal>
  );
}
