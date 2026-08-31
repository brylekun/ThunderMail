import type { Mailbox } from './api';

const STORAGE_KEY = 'thundermail:mailbox:v1';

export function loadStoredMailbox(): Mailbox | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<Mailbox>;
    if (
      typeof value.id !== 'string' ||
      typeof value.address !== 'string' ||
      typeof value.token !== 'string' ||
      typeof value.createdAt !== 'number' ||
      typeof value.expiresAt !== 'number'
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return value as Mailbox;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function storeMailbox(mailbox: Mailbox): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mailbox));
}

export function clearStoredMailbox(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
