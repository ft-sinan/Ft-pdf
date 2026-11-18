export type Kind = 'pdf' | 'docx' | 'txt' | 'html';
export type Theme = 'terracotta' | 'espresso' | 'forest' | 'midnight';
export type Doc = {
  id: string;
  name: string;
  type: Kind;
  collectionId: string | null;
  starred: boolean;
  trashed: boolean;
  created: number;
  updated: number;
  opened: number;
  size: number;
  pages: number | null;
  locked: boolean;
  cover: string;
};
export type Collection = { id: string; name: string; color: string };
export type User = {
  id: string;
  name: string;
  email: string | null;
  theme: Theme;
  isDemo: boolean;
};
export type Activity = { id: number; message: string; created: number };
export type Workspace = {
  user: User;
  documents: Doc[];
  collections: Collection[];
  activity: Activity[];
  quota: number;
};
export type View = 'overview' | 'documents' | 'starred' | 'trash' | `collection/${string}`;
export const labels: Record<Kind, string> = {
  pdf: 'PDF document',
  docx: 'Word document',
  txt: 'Plain text',
  html: 'HTML file',
};
export const kindNames: Record<Kind, string> = {
  pdf: 'PDF',
  docx: 'Word',
  txt: 'Text',
  html: 'HTML',
};
export const fileName = (d: Doc) => `${d.name}.${d.type}`;
export const fileURL = (d: Doc) => `/api/documents/${d.id}/file`;
export const initials = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toLocaleUpperCase();
export function sizeOf(n: number) {
  return n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
}
export function ago(t: number) {
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} ${m < 120 ? 'hour' : 'hours'} ago`;
  if (m < 2880) return 'Yesterday';
  if (m < 10080) return `${Math.floor(m / 1440)} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function editTime(t: number) {
  const a = ago(t);
  return `Edited ${a === 'Yesterday' || a === 'Just now' ? a.toLowerCase() : a}`;
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const raw = body instanceof FormData || body instanceof Blob;
  const r = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(!raw && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  if (!r.ok) {
    let message = `Request failed (${r.status}).`;
    try {
      message = (await r.json()).error || message;
    } catch {
      /* non-JSON error */
    }
    throw new Error(message);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
export const message = (e: unknown) =>
  e instanceof TypeError && e.message === 'Failed to fetch'
    ? 'Could not reach the workspace. Check your connection and try again.'
    : e instanceof Error
      ? e.message
      : 'Something went wrong. Please try again.';
export function downloadDoc(d: Doc) {
  const a = document.createElement('a');
  a.href = fileURL(d);
  a.download = fileName(d);
  document.body.append(a);
  a.click();
  a.remove();
}
