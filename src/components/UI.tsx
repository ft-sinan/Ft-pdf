import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FolderOpen, LoaderCircle, AlertCircle } from 'lucide-react';
export function Modal({
  title,
  kicker,
  subtitle,
  children,
  onClose,
  wide = false,
  className = '',
}: {
  title: string;
  kicker?: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const id = useId(),
    ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const prior = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = ref.current!;
    // Focus once on mount, before the user can choose a different field. A delayed
    // focus can redirect fast password-manager or keyboard input into the name field.
    (
      el.querySelector<HTMLElement>(
        '[data-autofocus], input:not([type=hidden]):not([type=file]), textarea, select',
      ) || el
    ).focus({ preventScroll: true });
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close.current();
      }
      if (e.key === 'Tab') {
        const items = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex="0"]',
          ),
        ).filter((x) => x.offsetParent !== null);
        if (!items.length) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && (document.activeElement === items[0] || document.activeElement === el)) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0].focus();
        }
      }
    }
    document.addEventListener('keydown', key, true);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key, true);
      prior?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''} ${className}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            {kicker && <div className="eyebrow">{kicker}</div>}
            <h2 id={id}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn close-modal" aria-label="Close dialog" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export type Anchor = { left: number; top: number; bottom: number; right: number };
export function Popup({
  anchor,
  onClose,
  children,
  wide = false,
}: {
  anchor: Anchor;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchor.bottom + 6, left: anchor.right - 220 });
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const el = ref.current!,
      w = el.offsetWidth,
      h = el.offsetHeight;
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - w - 8, anchor.right - w)),
      top:
        anchor.bottom + h + 9 < window.innerHeight
          ? anchor.bottom + 6
          : Math.max(8, anchor.top - h - 5),
    });
  }, [anchor, children]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') || []);
        if (items.length) {
          e.preventDefault();
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        }
      }
    };
    const resize = () => close.current();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return createPortal(
    <div ref={ref} className={`popup ${wide ? 'wide' : ''}`} style={pos}>
      {children}
    </div>,
    document.body,
  );
}
export function Empty({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <FolderOpen size={24} />}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
export function ErrorNote({ text }: { text: string }) {
  return text ? (
    <div className="error-note" role="alert">
      <AlertCircle size={16} />
      {text}
    </div>
  ) : null;
}
export function Spin({ size = 16 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" aria-label="Loading" />;
}
