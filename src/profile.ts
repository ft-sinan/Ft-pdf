import { api, onDevice, type User } from './types';
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const key = (id: string) => `ft.profile.${id}.birthday`;
export function birthday(user: User) {
  if (onDevice) return user.birthDate || '';
  try {
    return localStorage.getItem(key(user.id)) || '';
  } catch {
    return '';
  }
}
export async function saveProfile(user: User, name: string, birthDate: string) {
  name = name.trim();
  if (!name || name.length > 64) throw Error('Enter a display name of 1–64 characters.');
  if (birthDate) {
    const d = new Date(birthDate + 'T00:00:00Z');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
      birthDate < '0001-01-01' ||
      birthDate > today() ||
      !Number.isFinite(d.getTime()) ||
      d.toISOString().slice(0, 10) !== birthDate
    )
      throw Error('Choose a valid birth date that is not in the future.');
  }
  const payload = { expectedOwner: user.id, name };
  if (onDevice) return api<User>('/profile', 'PATCH', { ...payload, birthDate });
  // Do not transmit a birthday, even when registering or editing a web profile.
  const k = key(user.id),
    previous = birthday(user),
    update = (s: string) => (s ? localStorage.setItem(k, s) : localStorage.removeItem(k));
  if (previous !== birthDate) {
    try {
      update(birthDate);
    } catch {
      throw Error('This browser cannot store the birth date. Leave it blank to continue.');
    }
  }
  try {
    return await api<User>('/profile', 'PATCH', payload);
  } catch (e) {
    try {
      if (previous !== birthDate && birthday(user) === birthDate) update(previous);
    } catch {
      /* storage no longer available */
    }
    throw e;
  }
}
