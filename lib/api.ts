export type Mailbox = {
  id: string;
  address: string;
  token: string;
  createdAt: number;
  expiresAt: number;
};

export type MessageSummary = {
  id: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  preview: string;
  receivedAt: number;
};

export type Message = MessageSummary & {
  toAddress: string;
  textBody: string;
  htmlBody: string | null;
};

const configuredApiBaseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const productionApiBaseUrl = 'https://api.thunderanticheat.app';
const API_BASE_URL =
  import.meta.env.PROD &&
  (!configuredApiBaseUrl || /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(configuredApiBaseUrl))
    ? productionApiBaseUrl
    : configuredApiBaseUrl;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

function authHeader(mailbox: Mailbox): HeadersInit {
  return { Authorization: `Bearer ${mailbox.token}` };
}

export function createMailbox(): Promise<Mailbox> {
  return request<Mailbox>('/api/mailboxes', { method: 'POST' });
}

export async function listMessages(mailbox: Mailbox): Promise<MessageSummary[]> {
  const result = await request<{ messages: MessageSummary[] }>(
    `/api/mailboxes/${encodeURIComponent(mailbox.id)}/messages`,
    { headers: authHeader(mailbox) },
  );
  return result.messages;
}

export function getMessage(mailbox: Mailbox, messageId: string): Promise<Message> {
  return request<Message>(
    `/api/mailboxes/${encodeURIComponent(mailbox.id)}/messages/${encodeURIComponent(messageId)}`,
    { headers: authHeader(mailbox) },
  );
}

export async function deleteMailbox(mailbox: Mailbox): Promise<void> {
  await request<{ ok: boolean }>(`/api/mailboxes/${encodeURIComponent(mailbox.id)}`, {
    method: 'DELETE',
    headers: authHeader(mailbox),
  });
}
