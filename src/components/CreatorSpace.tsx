import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  Code2,
  Copy,
  Feather,
  Globe,
  Mail,
  MessageCircle,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { version } from '../../package.json';
import contacts from '../../shared/creator-contacts.json';
import { onDevice } from '../types';
import './creator.css';

const badges = [
  {
    name: 'Creator',
    icon: Feather,
    detail: 'Designed and built by Sinan, the creator of Ft PDF and My Vault.',
  },
  {
    name: 'Your files',
    icon: ShieldCheck,
    detail:
      'Ft PDF works on a library copy. Editing or deleting that copy never changes your original in Files.',
  },
  {
    name: onDevice ? 'Offline' : 'Web edition',
    icon: BookOpen,
    detail: onDevice
      ? 'Read, edit and use the toolbox in airplane mode. The installed app needs no server or internet permission.'
      : 'This edition saves to your workspace server. The separate Android app keeps its library on your phone.',
  },
  {
    name: 'Stack',
    icon: Code2,
    detail: onDevice
      ? 'React and TypeScript for the studio; Java, SQLite and Android Files for the on-device library.'
      : 'React and TypeScript for the studio, with Node.js and SQLite behind the web library.',
  },
];
const icons: Record<string, typeof Code2> = {
  GitHub: Code2,
  Telegram: Send,
  WhatsApp: MessageCircle,
  Email: Mail,
  Website: Globe,
};
async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    /* WebViews and embedded previews may not expose Clipboard API. */
  }
  const before = document.activeElement as HTMLElement | null,
    field = document.createElement('textarea');
  field.value = value;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  document.body.append(field);
  try {
    field.select();
    return document.execCommand('copy');
  } finally {
    field.remove();
    before?.focus({ preventScroll: true });
  }
}
function Contact({
  item,
  copy,
}: {
  item: (typeof contacts)[number];
  copy: (item: (typeof contacts)[number]) => void;
}) {
  const held = useRef(false),
    Icon = icons[item.label];
  return (
    <div className={'creator-contact' + (item.label === 'Website' ? ' website' : '')}>
      <a
        href={item.url}
        target={onDevice ? '_self' : '_blank'}
        rel="noopener noreferrer"
        aria-label={`Open ${item.label}`}
        onPointerDown={() => {
          held.current = false;
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          held.current = true;
          copy(item);
        }}
        onClick={(e) => {
          if (held.current) {
            e.preventDefault();
            held.current = false;
          }
        }}
      >
        <Icon size={17} />
        <span>
          <strong>{item.label === 'Email' ? 'Send feedback' : item.label}</strong>
          <small>{item.contact.replace(/^https?:\/\//, '').replace(/\/$/, '')}</small>
        </span>
        <ArrowUpRight size={13} />
      </a>
      <button
        aria-label={`Copy ${item.label} contact`}
        title={`Copy ${item.label} contact`}
        onClick={() => copy(item)}
      >
        <Copy size={13} />
      </button>
    </div>
  );
}
/** A local Settings panel; contact URLs are the same allowlist used by Android. */
export default function CreatorSpace() {
  const [flipped, flip] = useState(false),
    [badge, select] = useState<number | null>(null),
    [feedback, say] = useState('');
  useEffect(() => {
    if (!flipped) return;
    const timer = setTimeout(() => flip(false), 2400);
    return () => clearTimeout(timer);
  }, [flipped]);
  const copy = async (item: (typeof contacts)[number]) => {
    const ok = await copyText(item.contact).catch(() => false);
    say(ok ? `${item.label} contact copied.` : `Copy this contact: ${item.contact}`);
  };
  return (
    <section className="creator-space" aria-label="Creator Space">
      <div className="maker-card">
        <button
          className="maker-coin"
          aria-label="Flip creator emblem"
          aria-pressed={flipped}
          onClick={() => flip((v) => !v)}
        >
          {flipped ? <BookOpen size={22} /> : <span>S</span>}
        </button>
        <div>
          <p className="maker-kicker">Creator Space</p>
          <h3>{flipped ? 'Read first.' : 'Made by Sinan'}</h3>
          <p className="maker-handle">{flipped ? 'Edit when you’re ready.' : '@ft-sinan'}</p>
        </div>
      </div>
      <p className="maker-note">
        Ft PDF is a place to read your documents and edit a copy when you need one.
      </p>
      <div className="maker-badges" aria-label="About the studio">
        {badges.map(({ name, icon: I }, i) => (
          <button
            key={name}
            aria-pressed={badge === i}
            onClick={() => select((b) => (b === i ? null : i))}
          >
            <I size={13} />
            {name}
          </button>
        ))}
      </div>
      {badge != null && (
        <p className="badge-detail" role="status">
          {badges[badge].detail}
        </p>
      )}
      <div className="connect-head">
        <h4>Connect with Sinan</h4>
        <p>
          {onDevice ? 'Links open in another app.' : 'Links open outside the workspace.'} Tap to
          open or hold to copy.
        </p>
      </div>
      <div className="maker-contacts">
        {[...contacts]
          .sort(
            (a, b) =>
              ['Website', 'Email', 'GitHub', 'Telegram', 'WhatsApp'].indexOf(a.label) -
              ['Website', 'Email', 'GitHub', 'Telegram', 'WhatsApp'].indexOf(b.label),
          )
          .map((item) => (
            <Contact key={item.label} item={item} copy={(item) => void copy(item)} />
          ))}
      </div>
      <p className="copy-feedback" role="status">
        {feedback}
      </p>
      <dl className="maker-stats">
        {[
          ['Version', version],
          ['Platform', onDevice ? 'Android' : 'Web'],
          ['Built with', onDevice ? 'React · Java' : 'React · Node'],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
