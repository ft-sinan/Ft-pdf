import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Feather,
  FolderOpen,
  LockKeyhole,
  Pencil,
  Star,
} from 'lucide-react';
import { Brand, FileIcon, PaperArt } from './Art';
import { ErrorNote, Spin } from './UI';
import { message, onDevice, type User } from '../types';
import { birthday, today } from '../profile';
import './welcome.css';
export type ProfileSave = (name: string, birthDate: string) => Promise<void>;
export function ProfileFields({
  user,
  first = false,
  save,
}: {
  user: User;
  first?: boolean;
  save: ProfileSave;
}) {
  const initialDate = birthday(user),
    [name, setName] = useState(first ? '' : user.name),
    [date, setDate] = useState(initialDate),
    [busy, wait] = useState(false),
    [err, error] = useState('');
  return (
    <form
      className="profile-fields"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        wait(true);
        error('');
        try {
          await save(name.trim(), date);
        } catch (e) {
          error(message(e));
        } finally {
          wait(false);
        }
      }}
    >
      <label className="field">
        {first ? 'Your name' : 'Display name'}
        <input
          required
          maxLength={64}
          name="displayName"
          autoComplete="nickname"
          placeholder="What should we call you?"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="field">
        <span>
          Date of birth <small>Optional</small>
        </span>
        <input
          name="birthday"
          type="date"
          aria-label="Date of birth"
          autoComplete="off"
          min="0001-01-01"
          max={today()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={busy}
        />
      </label>
      {date && (
        <button
          type="button"
          className="text-btn clear-birthday"
          onClick={() => setDate('')}
          disabled={busy}
        >
          Clear birth date
        </button>
      )}
      <p className="profile-note">
        <LockKeyhole size={14} />
        <span>
          Your birth date stays {onDevice ? 'on this phone' : 'in this browser'}. It isn’t needed to
          open files. Change or remove it in Settings.
        </span>
      </p>
      <ErrorNote text={err} />
      <button
        className={first ? 'btn primary' : 'btn secondary'}
        disabled={
          busy || !name.trim() || (!first && name.trim() === user.name && date === initialDate)
        }
      >
        {busy ? <Spin /> : null}
        {first ? 'Open my library' : 'Save profile'}
        {first ? <ArrowRight size={16} /> : null}
      </button>
    </form>
  );
}
const note =
  'Field notes\n\nA morning at the print studio. We laid three paper stocks by the window to compare how each one held the ink.\n\nObservations\nThe warm ivory sheet kept the small type sharp. The recycled sheet gave the illustrations a softer edge.\n\nNext visit\nBring the revised cover and test a two-colour print. Leave room in the margin for a handwritten note.';
/** Tour state belongs to this mounted card only. No document APIs or storage. */
export function PracticeFile() {
  const [editing, edit] = useState(false),
    [starred, star] = useState(false),
    [text, write] = useState(note);
  return (
    <section className="practice" aria-label="Practice document">
      <div className="practice-head">
        <FileIcon type="txt" small />
        <strong>Field notes.txt</strong>
        <button
          aria-label="Star sample"
          aria-pressed={starred}
          title="Star sample"
          onClick={() => star((v) => !v)}
        >
          <Star size={16} fill={starred ? 'currentColor' : 'none'} />
        </button>
        <button className="practice-edit" onClick={() => edit((v) => !v)}>
          {editing ? <Check size={13} /> : <Pencil size={13} />} {editing ? 'Done' : 'Edit sample'}
        </button>
      </div>
      {editing ? (
        <textarea
          aria-label="Edit practice text"
          className="practice-paper"
          value={text}
          maxLength={6000}
          onChange={(e) => write(e.target.value)}
        />
      ) : (
        <article className="practice-paper" aria-label="Read practice text" tabIndex={0}>
          {text}
        </article>
      )}
      <div className="practice-foot">
        <BookOpen size={12} />
        {editing ? 'Practice edit' : 'Reading view'}
        <span>Sample · Not saved</span>
      </div>
    </section>
  );
}
export default function Welcome({ user, save }: { user: User; save: ProfileSave }) {
  const [step, go] = useState(0),
    prev = useRef(0),
    head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (step) head.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    const back = (e: Event) => {
      if (step) {
        e.preventDefault();
        go(step === 2 ? prev.current : 0);
      }
    };
    window.addEventListener('ft:back', back);
    return () => window.removeEventListener('ft:back', back);
  }, [step]);
  const profile = () => {
    prev.current = step;
    go(2);
  };
  return (
    <main className="first-run">
      <header className="welcome-mast">
        <Brand />
        <span>DOCUMENT STUDIO</span>
      </header>
      <div className={'welcome-card w-step-' + step}>
        <aside className="welcome-art" aria-hidden="true">
          <span className="art-rule">FT &nbsp; / &nbsp; FIELD GUIDE</span>
          <PaperArt />
          <div className="art-caption">
            <Feather size={16} /> The personal library series
          </div>
        </aside>
        <div className="welcome-content">
          <ol className="welcome-steps" aria-label="Getting started">
            {['Welcome', 'Tour', 'Profile'].map((label, i) => (
              <li
                key={label}
                aria-current={i === step ? 'step' : undefined}
                className={i <= step ? 'ink' : ''}
              >
                <i />
                {label}
              </li>
            ))}
          </ol>
          <div className="welcome-kicker">
            {['01 / GETTING STARTED', '02 / GUIDED PRACTICE', '03 / YOUR DETAILS'][step]}
          </div>
          <h1 ref={head} tabIndex={-1}>
            {['Welcome to Ft PDF.', 'Try a practice file.', 'Make it yours.'][step]}
          </h1>
          <p className="welcome-lede">
            {step === 0
              ? 'Read, edit, and keep your documents together. Take a short tour, then start your own library.'
              : step === 1
                ? 'Scroll the note, tap Edit sample to change a line, or star it. This file never enters your library.'
                : 'Choose the name for your workspace. No account or password needed.'}
          </p>
          {step === 2 ? (
            <ProfileFields first user={user} save={save} />
          ) : (
            <>
              {step === 1 && <PracticeFile />}
              <div className="welcome-actions">
                <button className="btn primary" onClick={step === 0 ? () => go(1) : profile}>
                  {step === 0 ? 'Take the tour' : 'Continue to profile'}
                  <ArrowRight size={16} />
                </button>
                {step === 0 && (
                  <button className="btn secondary" onClick={profile}>
                    Skip tour
                  </button>
                )}
              </div>
            </>
          )}
          {step > 0 && (
            <button
              className="text-btn welcome-back"
              onClick={() => go(step === 1 ? 0 : prev.current)}
            >
              <ArrowLeft size={14} />
              Back
            </button>
          )}
        </div>
      </div>
      <footer className="welcome-footer">
        <FolderOpen size={14} />{' '}
        {onDevice ? 'On-device library · Works offline' : 'Web edition · Personal workspace'}
      </footer>
    </main>
  );
}
