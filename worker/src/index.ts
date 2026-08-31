import PostalMime from 'postal-mime';
import sanitizeHtml from 'sanitize-html';

interface Env {
  DB: D1Database;
  MAIL_DOMAIN: string;
  WEB_ORIGIN: string;
  MAILBOX_TTL_SECONDS?: string;
}

type MailboxRow = {
  id: string;
  address: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
};

type MessageRow = {
  id: string;
  mailbox_id: string;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string;
  text_body: string;
  html_body: string | null;
  received_at: number;
};

const MAX_RAW_MESSAGE_BYTES = 1_000_000;
const MAX_BODY_CHARS = 500_000;
const DEFAULT_TTL_SECONDS = 15 * 60;
const SAFE_EMAIL_CSS_VALUE =
  /^(?!.*(?:url\s*\(|expression\s*\(|@import|javascript\s*:|data\s*:))[-#(),.%/'"!\w\s]+$/i;
const SAFE_EMAIL_STYLE_PROPERTIES = [
  'background-color',
  'border',
  'border-bottom',
  'border-collapse',
  'border-color',
  'border-left',
  'border-radius',
  'border-right',
  'border-spacing',
  'border-style',
  'border-top',
  'border-width',
  'color',
  'direction',
  'display',
  'float',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'height',
  'letter-spacing',
  'line-height',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'overflow-wrap',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'table-layout',
  'text-align',
  'text-decoration',
  'text-indent',
  'text-transform',
  'vertical-align',
  'white-space',
  'width',
  'word-break',
] as const;

const SAFE_EMAIL_STYLES = Object.fromEntries(
  SAFE_EMAIL_STYLE_PROPERTIES.map((property) => [property, [SAFE_EMAIL_CSS_VALUE]]),
);

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request, env);

    try {
      const response = await routeRequest(request, env);
      return withCors(response, request, env);
    } catch (error) {
      console.error('Request failed', error);
      return withCors(json({ error: 'Unexpected server error.' }, 500), request, env);
    }
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    if (message.rawSize > MAX_RAW_MESSAGE_BYTES) {
      message.setReject('Message is too large. Attachments are not supported.');
      return;
    }

    const recipient = message.to.toLowerCase();
    const now = unixTime();
    const mailbox = await env.DB.prepare(
      'SELECT id, address, token_hash, created_at, expires_at FROM mailboxes WHERE address = ? AND expires_at > ? LIMIT 1',
    )
      .bind(recipient, now)
      .first<MailboxRow>();

    if (!mailbox) {
      message.setReject('This temporary mailbox does not exist or has expired.');
      return;
    }

    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await new PostalMime().parse(raw);
    const htmlBody = parsed.html ? cleanEmailHtml(parsed.html).slice(0, MAX_BODY_CHARS) : null;
    const textBody = (parsed.text ?? '').slice(0, MAX_BODY_CHARS);
    const from = parsed.from;

    await env.DB.prepare(
      `INSERT INTO messages (
        id, mailbox_id, from_address, from_name, to_address, subject, text_body, html_body, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        mailbox.id,
        (from?.address || message.from).toLowerCase(),
        from?.name || null,
        recipient,
        (parsed.subject || '(No subject)').slice(0, 500),
        textBody,
        htmlBody,
        now,
      )
      .run();
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await env.DB.prepare('DELETE FROM mailboxes WHERE expires_at <= ?').bind(unixTime()).run();
    await env.DB.prepare('PRAGMA optimize').run();
  },
};

export default worker;

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'GET' && path === '/api/health') {
    return json({ ok: true, service: 'thundermail-api' });
  }

  if (request.method === 'POST' && path === '/api/mailboxes') {
    return createMailbox(env);
  }

  const listMatch = path.match(/^\/api\/mailboxes\/([^/]+)\/messages$/);
  if (request.method === 'GET' && listMatch) {
    return getMessages(request, env, decodeURIComponent(listMatch[1]));
  }

  const messageMatch = path.match(/^\/api\/mailboxes\/([^/]+)\/messages\/([^/]+)$/);
  if (request.method === 'GET' && messageMatch) {
    return getMessage(request, env, decodeURIComponent(messageMatch[1]), decodeURIComponent(messageMatch[2]));
  }

  const mailboxMatch = path.match(/^\/api\/mailboxes\/([^/]+)$/);
  if (request.method === 'DELETE' && mailboxMatch) {
    return removeMailbox(request, env, decodeURIComponent(mailboxMatch[1]));
  }

  return json({ error: 'Not found.' }, 404);
}

async function createMailbox(env: Env): Promise<Response> {
  const now = unixTime();
  const ttl = parsePositiveInt(env.MAILBOX_TTL_SECONDS, DEFAULT_TTL_SECONDS);
  const id = crypto.randomUUID();
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const address = `${randomAddressPart()}@${env.MAIL_DOMAIN}`.toLowerCase();
  const expiresAt = now + ttl;

  await env.DB.prepare(
    'INSERT INTO mailboxes (id, address, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, address, tokenHash, now, expiresAt)
    .run();

  return json({ id, address, token, createdAt: now, expiresAt }, 201);
}

async function getMessages(request: Request, env: Env, mailboxId: string): Promise<Response> {
  const mailbox = await authorizeMailbox(request, env, mailboxId);
  if (!mailbox) return json({ error: 'Mailbox not found, expired, or unauthorized.' }, 404);

  const result = await env.DB.prepare(
    `SELECT id, from_address, from_name, subject,
      substr(CASE WHEN text_body != '' THEN text_body ELSE 'HTML message' END, 1, 180) AS preview,
      received_at
    FROM messages
    WHERE mailbox_id = ?
    ORDER BY received_at DESC
    LIMIT 100`,
  )
    .bind(mailboxId)
    .all<{
      id: string;
      from_address: string;
      from_name: string | null;
      subject: string;
      preview: string;
      received_at: number;
    }>();

  return json({
    messages: result.results.map((row) => ({
      id: row.id,
      fromAddress: row.from_address,
      fromName: row.from_name,
      subject: row.subject,
      preview: row.preview.replace(/\s+/g, ' ').trim(),
      receivedAt: row.received_at,
    })),
  });
}

async function getMessage(request: Request, env: Env, mailboxId: string, messageId: string): Promise<Response> {
  const mailbox = await authorizeMailbox(request, env, mailboxId);
  if (!mailbox) return json({ error: 'Mailbox not found, expired, or unauthorized.' }, 404);

  const row = await env.DB.prepare(
    `SELECT id, mailbox_id, from_address, from_name, to_address, subject, text_body, html_body, received_at
    FROM messages WHERE id = ? AND mailbox_id = ? LIMIT 1`,
  )
    .bind(messageId, mailboxId)
    .first<MessageRow>();

  if (!row) return json({ error: 'Message not found.' }, 404);

  return json({
    id: row.id,
    fromAddress: row.from_address,
    fromName: row.from_name,
    toAddress: row.to_address,
    subject: row.subject,
    preview: row.text_body.slice(0, 180).replace(/\s+/g, ' ').trim(),
    textBody: row.text_body,
    htmlBody: row.html_body,
    receivedAt: row.received_at,
  });
}

async function removeMailbox(request: Request, env: Env, mailboxId: string): Promise<Response> {
  const mailbox = await authorizeMailbox(request, env, mailboxId);
  if (!mailbox) return json({ error: 'Mailbox not found, expired, or unauthorized.' }, 404);
  await env.DB.prepare('DELETE FROM mailboxes WHERE id = ?').bind(mailboxId).run();
  return json({ ok: true });
}

async function authorizeMailbox(request: Request, env: Env, mailboxId: string): Promise<MailboxRow | null> {
  const authorization = request.headers.get('Authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return null;

  return env.DB.prepare(
    'SELECT id, address, token_hash, created_at, expires_at FROM mailboxes WHERE id = ? AND token_hash = ? AND expires_at > ? LIMIT 1',
  )
    .bind(mailboxId, await sha256(token), unixTime())
    .first<MailboxRow>();
}

function cleanEmailHtml(input: string): string {
  const body = sanitizeHtml(input, {
    allowedTags: [
      'p', 'div', 'span', 'a', 'b', 'strong', 'i', 'em', 'u', 'br', 'hr',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
      'pre', 'code', 'center', 'table', 'caption', 'thead', 'tbody', 'tfoot',
      'tr', 'th', 'td',
    ],
    allowedAttributes: {
      '*': ['style', 'dir', 'lang', 'title'],
      a: ['href', 'title'],
      ol: ['start', 'type'],
      li: ['value'],
      table: ['width', 'height', 'align', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'role'],
      tr: ['height', 'align', 'valign', 'bgcolor'],
      td: ['width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor'],
      th: ['width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor'],
    },
    allowedStyles: { '*': SAFE_EMAIL_STYLES },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: 'a',
        attribs: { ...attributes, target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
    },
  });

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>html{color-scheme:light}body{font:14px/1.65 system-ui,sans-serif;color:#18181b;background:#fff;margin:24px;overflow-wrap:anywhere}a{color:#6d28d9}table{max-width:100%;border-collapse:collapse}td,th{vertical-align:top}pre{white-space:pre-wrap}</style></head><body>${body}</body></html>`;
}

function withCors(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get('Origin');
  const allowedOrigin = origin && isAllowedOrigin(origin, env.WEB_ORIGIN) ? origin : env.WEB_ORIGIN;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  headers.set('Vary', 'Origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isAllowedOrigin(origin: string, productionOrigin: string): boolean {
  if (origin === productionOrigin) return true;
  try {
    const url = new URL(origin);
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function unixTime(): number {
  return Math.floor(Date.now() / 1000);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function randomAddressPart(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function randomToken(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
