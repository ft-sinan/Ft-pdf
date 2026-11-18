import { useRef, useState } from 'react';
import { ImagePlus, Camera, ArrowDown, ArrowUp, RotateCw, X, FilePlus2 } from 'lucide-react';
import { Modal, Spin, ErrorNote } from './UI';
import { CollectionField } from './Forms';
import { Collection, Doc, message } from '../types';
import { Photo, MB, preparePhoto, photoPdf } from '../tools/photos';
import { store } from '../device/bridge';
export default function PhotoForm({
  collections,
  initial,
  close,
  done,
}: {
  collections: Collection[];
  initial: string;
  close: () => void;
  done: (d: Doc) => void;
}) {
  const [pages, set] = useState<Photo[]>([]),
    [name, setName] = useState(''),
    [paper, select] = useState('a4'),
    [margin, margins] = useState(true),
    [col, folder] = useState(initial),
    [work, busy] = useState(''),
    [err, error] = useState('');
  const input = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  async function add(files: File[]) {
    if (!files.length) return;
    error('');
    const next = [...pages];
    let total = next.reduce((a, p) => a + p.jpeg.size, 0);
    try {
      if (files.length + next.length > 32) throw new Error('Choose up to 32 images.');
      for (const [i, f] of files.entries()) {
        busy(`Preparing image ${i + 1} of ${files.length}…`);
        const p = await preparePhoto(f);
        if ((total += p.jpeg.size) > 24 * MB)
          throw new Error('Use fewer images to fit the PDF file limit.');
        next.push(p);
      }
    } catch (e) {
      error(message(e));
    } finally {
      set(next);
      if (!name && next.length) setName(next[0].name.replace(/\.[^.]*$/, '').slice(0, 110));
      busy('');
    }
  }
  function move(i: number, j: number) {
    const a = [...pages];
    [a[i], a[j]] = [a[j], a[i]];
    set(a);
  }
  return (
    <Modal
      title="Images to PDF"
      kicker="CREATE ON DEVICE"
      subtitle="In Files, touch and hold to select multiple photos, then confirm. Arrange them here, one photo per page."
      onClose={() => !work && close()}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          busy('Making PDF…');
          error('');
          try {
            const pdf = await photoPdf(pages, paper, margin);
            done(
              await store<Doc>(
                { name, type: 'pdf', pages: pages.length, collectionId: col || null },
                pdf,
                '',
              ),
            );
          } catch (e) {
            error(message(e));
            busy('');
          }
        }}
      >
        <div className="modal-body">
          <input
            hidden
            ref={input}
            multiple
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const a = Array.from(e.target.files || []);
              e.target.value = '';
              void add(a);
            }}
          />
          <button
            type="button"
            className="dropzone"
            data-autofocus
            disabled={!!work}
            onClick={() => input.current?.click()}
          >
            <ImagePlus />
            <strong>{pages.length ? 'Add more images' : 'Choose images'}</strong>
            <small>JPG, PNG or WebP · up to 32 pages</small>
          </button>
          <input
            hidden
            ref={camera}
            type="file"
            capture="environment"
            accept="image/jpeg"
            onChange={(e) => {
              const a = Array.from(e.target.files || []);
              e.target.value = '';
              void add(a);
            }}
          />
          <button
            type="button"
            className="text-btn"
            disabled={!!work}
            onClick={() => camera.current?.click()}
          >
            <Camera size={16} />
            Take a photo
          </button>
          <ol className="photo-list">
            {pages.map((p, i) => (
              <li key={i}>
                <img alt="" src={p.thumb} style={{ transform: `rotate(${p.turn}deg)` }} />
                <span>
                  <small>PAGE {i + 1}</small>
                  <strong>{p.name}</strong>
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move image ${i + 1} up`}
                  disabled={!!work || !i}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowUp />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move image ${i + 1} down`}
                  disabled={!!work || i === pages.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Rotate image ${i + 1}`}
                  disabled={!!work}
                  onClick={() =>
                    set(pages.map((a, j) => (i === j ? { ...a, turn: (a.turn + 90) % 360 } : a)))
                  }
                >
                  <RotateCw />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove image ${i + 1}`}
                  disabled={!!work}
                  onClick={() => set(pages.filter((_, j) => i !== j))}
                >
                  <X />
                </button>
              </li>
            ))}
          </ol>
          <label className="field">
            PDF name
            <input
              required
              maxLength={120}
              value={name}
              placeholder="Photo document"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            Page size
            <select value={paper} onChange={(e) => select(e.target.value)}>
              <option value="a4">A4 · auto orientation</option>
              <option value="letter">Letter · auto orientation</option>
              <option value="original">Fit each image</option>
            </select>
          </label>
          <label className="tool-check">
            <input type="checkbox" checked={margin} onChange={(e) => margins(e.target.checked)} />{' '}
            Add a white margin
          </label>
          <CollectionField value={col} set={folder} collections={collections} />
          <ErrorNote text={err} />
          {work && <p role="status">{work}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn secondary" disabled={!!work} onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!pages.length || !!work}>
            {work ? <Spin /> : <FilePlus2 size={16} />}Create PDF
          </button>
        </div>
      </form>
    </Modal>
  );
}
