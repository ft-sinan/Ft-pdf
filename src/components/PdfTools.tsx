import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  FilePlus2,
  Files,
  ListChecks,
  RotateCw,
  Save,
  Trash2,
} from 'lucide-react';
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
  degrees,
} from 'pdf-lib';
import { Empty, ErrorNote, Modal, Spin } from './UI';
import { message } from '../types';
type Sheet = { key: string; source: number | null; turn: number };
type Field = {
  name: string;
  kind: 'text' | 'check' | 'choice' | 'multiple';
  choices?: string[];
  value: string | boolean | string[];
  readOnly: boolean;
  maxLength?: number;
};
export default function PdfTools({
  load,
  commit,
  close,
  hasMarks,
  saveLabel = 'Save PDF changes',
}: {
  load: () => Promise<Blob>;
  commit: (blob: Blob) => Promise<void>;
  close: () => void;
  hasMarks: boolean;
  saveLabel?: string;
}) {
  const [original, setOriginal] = useState<Uint8Array<ArrayBuffer> | null>(null),
    [pages, setPages] = useState<Sheet[]>([]),
    [fields, setFields] = useState<Field[]>([]),
    [tab, setTab] = useState<'pages' | 'fields'>('pages'),
    [err, setErr] = useState(''),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [values, setValues] = useState<Record<string, Field['value']>>({});
  useEffect(() => {
    let live = true;
    (async () => {
      const b = new Uint8Array(await (await load()).arrayBuffer()),
        pdf = await PDFDocument.load(b);
      const items: Field[] = [];
      for (const f of pdf.getForm().getFields()) {
        const name = f.getName(),
          readOnly = f.isReadOnly();
        if (f instanceof PDFTextField)
          items.push({
            name,
            readOnly,
            kind: 'text',
            value: f.getText() || '',
            maxLength: f.getMaxLength(),
          });
        else if (f instanceof PDFCheckBox)
          items.push({ name, readOnly, kind: 'check', value: f.isChecked() });
        else if (f instanceof PDFRadioGroup)
          items.push({
            name,
            readOnly,
            kind: 'choice',
            choices: f.getOptions(),
            value: f.getSelected() || '',
          });
        else if (f instanceof PDFDropdown || f instanceof PDFOptionList)
          items.push({
            name,
            readOnly,
            kind: f.isMultiselect() ? 'multiple' : 'choice',
            choices: f.getOptions(),
            value: f.isMultiselect() ? f.getSelected() : f.getSelected()[0] || '',
          });
      }
      if (live) {
        setPages(pdf.getPages().map((_, i) => ({ key: String(i), source: i, turn: 0 })));
        setFields(items);
        setOriginal(b);
      }
    })().catch((e) => {
      if (live) setErr(message(e));
    });
    return () => {
      live = false;
    };
  }, [load]);
  const change = (next: Sheet[]) => {
    setPages(next);
    setDirty(true);
  };
  const move = (i: number, dir: number) => {
    const next = [...pages];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    change(next);
  };
  const save = async () => {
    if (!original || busy) return;
    setBusy(true);
    setErr('');
    try {
      const pdf = await PDFDocument.load(original),
        form = pdf.getForm();
      for (const [name, v] of Object.entries(values)) {
        const field = form.getField(name);
        if (field instanceof PDFTextField) field.setText(String(v));
        else if (field instanceof PDFCheckBox) {
          if (v) field.check();
          else field.uncheck();
        } else if (field instanceof PDFRadioGroup) {
          if (v) field.select(String(v));
          else field.clear();
        } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
          if (typeof v === 'boolean' || !v.length) field.clear();
          else field.select(v as string | string[]);
        }
      }
      if (Object.keys(values).length) {
        const [fontkit, r] = await Promise.all([
          import('@pdf-lib/fontkit'),
          fetch('/fonts/document-sans.ttf'),
        ]);
        if (!r.ok) throw new Error('Could not load the form font. Try again.');
        pdf.registerFontkit(fontkit.default);
        form.updateFieldAppearances(await pdf.embedFont(await r.arrayBuffer(), { subset: true }));
      }
      if (dirty) {
        const before = pdf.getPages();
        for (let i = before.length - 1; i >= 0; i--) pdf.removePage(i);
        for (const s of pages) {
          const page = s.source === null ? pdf.addPage([595, 842]) : pdf.addPage(before[s.source]);
          if (s.turn) page.setRotation(degrees((page.getRotation().angle + s.turn) % 360));
        }
      }
      await commit(new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' }));
      close();
    } catch (e) {
      setErr(message(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title="PDF tools"
      kicker="DOCUMENT STUDIO"
      subtitle="Organize pages or complete a fillable PDF form."
      onClose={() => !busy && close()}
    >
      {!original ? (
        <div className="modal-body">
          {err ? (
            <ErrorNote text={err} />
          ) : (
            <div className="pdf-tool-loading">
              <Spin />
              Preparing document…
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="settings-tabs">
            <button className={tab === 'pages' ? 'active' : ''} onClick={() => setTab('pages')}>
              <Files size={15} />
              Page layout
            </button>
            <button className={tab === 'fields' ? 'active' : ''} onClick={() => setTab('fields')}>
              <ListChecks size={15} />
              Form fields ({fields.length})
            </button>
          </div>
          <div className="modal-body">
            {tab === 'pages' ? (
              <>
                <div className="manage-pages">
                  {pages.map((s, i) => (
                    <div key={s.key}>
                      <span className="mini-sheet">{i + 1}</span>
                      <span className="page-name">
                        <strong>
                          {s.source === null ? 'Blank page' : `Original page ${s.source + 1}`}
                        </strong>
                        <small>{s.turn ? `Rotate ${s.turn}° clockwise` : 'Keep orientation'}</small>
                      </span>
                      <button
                        className="icon-btn"
                        title="Move up"
                        aria-label={`Move page ${i + 1} up`}
                        disabled={!i || busy}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Move down"
                        aria-label={`Move page ${i + 1} down`}
                        disabled={i === pages.length - 1 || busy}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Rotate 90°"
                        aria-label={`Rotate page ${i + 1}`}
                        disabled={busy}
                        onClick={() =>
                          change(
                            pages.map((p, j) =>
                              j === i ? { ...p, turn: (p.turn + 90) % 360 } : p,
                            ),
                          )
                        }
                      >
                        <RotateCw size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Remove page"
                        aria-label={`Remove page ${i + 1}`}
                        disabled={pages.length === 1 || busy}
                        onClick={() => change(pages.filter((_, j) => i !== j))}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="btn secondary add-page"
                  disabled={busy}
                  onClick={() =>
                    change([...pages, { key: `blank-${Date.now()}`, source: null, turn: 0 }])
                  }
                >
                  <FilePlus2 size={15} />
                  Add blank page
                </button>
              </>
            ) : fields.length ? (
              <div className="pdf-fields">
                {fields.map((f) => {
                  const v = values[f.name] ?? f.value;
                  const put = (x: Field['value']) =>
                    setValues((prev) => ({ ...prev, [f.name]: x }));
                  return (
                    <label
                      className={f.kind === 'check' ? 'field checkbox-field' : 'field'}
                      key={f.name}
                    >
                      {f.name}
                      {f.readOnly ? ' (read-only)' : ''}
                      {f.kind === 'check' ? (
                        <input
                          type="checkbox"
                          checked={!!v}
                          disabled={busy || f.readOnly}
                          onChange={(e) => put(e.target.checked)}
                        />
                      ) : f.kind === 'text' ? (
                        <input
                          value={String(v)}
                          maxLength={f.maxLength}
                          disabled={busy || f.readOnly}
                          onChange={(e) => put(e.target.value)}
                        />
                      ) : (
                        <select
                          value={v as string | string[]}
                          multiple={f.kind === 'multiple'}
                          disabled={busy || f.readOnly}
                          onChange={(e) =>
                            put(
                              f.kind === 'multiple'
                                ? Array.from(e.target.selectedOptions, (x) => x.value)
                                : e.target.value,
                            )
                          }
                        >
                          {f.kind === 'choice' && <option value="">Not selected</option>}
                          {f.choices?.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      )}
                    </label>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="No fillable fields"
                body="This PDF has no supported form fields. Use the Text tool to write directly on a page."
                icon={<ListChecks />}
              />
            )}
            <p className="pdf-tools-note">
              {hasMarks
                ? 'Saving also includes your pending annotations.'
                : 'Changes are applied to the workspace copy when you save.'}
            </p>
            <ErrorNote text={err} />
          </div>
          <div className="modal-footer">
            <button className="btn secondary" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={busy || (!dirty && !Object.keys(values).length)}
              onClick={() => void save()}
            >
              {busy ? <Spin /> : <Save size={15} />}
              {saveLabel}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
