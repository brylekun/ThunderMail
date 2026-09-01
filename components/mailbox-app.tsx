'use client';

import {
  AlertCircle,
  Check,
  Clock3,
  Copy,
  Inbox,
  LoaderCircle,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  createMailbox,
  deleteMailbox,
  getMessage,
  listMessages,
  type Mailbox,
  type Message,
  type MessageSummary,
} from '@/lib/api';
import { clearStoredMailbox, loadStoredMailbox, storeMailbox } from '@/lib/mailbox-storage';

const AUTO_CHECK_INTERVAL_MS = 10_000;
const AUTO_CHECK_DURATION_SECONDS = 3 * 60;

function formatRemaining(expiresAt: number, now: number): string {
  const seconds = Math.max(0, expiresAt - now);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatTime(timestamp: number): string {
  const elapsed = Math.floor(Date.now() / 1000) - timestamp;
  if (elapsed < 60) return 'Just now';
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp * 1000);
}

function senderName(message: MessageSummary): string {
  return message.fromName?.trim() || message.fromAddress;
}

export function MailboxApp() {
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const creatingRef = useRef(false);
  const refreshingRef = useRef(false);

  const installMailbox = useCallback((nextMailbox: Mailbox) => {
    storeMailbox(nextMailbox);
    setMailbox(nextMailbox);
    setMessages([]);
    setSelectedId(null);
    setSelectedMessage(null);
    setError(null);
    setStatus('ready');
  }, []);

  const makeMailbox = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setStatus('starting');
    setError(null);
    try {
      installMailbox(await createMailbox());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create an inbox.');
      setStatus('error');
    } finally {
      creatingRef.current = false;
    }
  }, [installMailbox]);

  useEffect(() => {
    const stored = loadStoredMailbox();
    const currentTime = Math.floor(Date.now() / 1000);
    if (stored && stored.expiresAt > currentTime) {
      installMailbox(stored);
    } else {
      clearStoredMailbox();
      void makeMailbox();
    }
  }, [installMailbox, makeMailbox]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setIsPageVisible(document.visibilityState === 'visible');
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  const refreshMessages = useCallback(
    async (showSpinner = false) => {
      if (!mailbox || mailbox.expiresAt <= Math.floor(Date.now() / 1000)) return;
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      if (showSpinner) setRefreshing(true);
      try {
        const nextMessages = await listMessages(mailbox);
        setMessages(nextMessages);
        setError(null);
        setSelectedId((current) => {
          if (current && nextMessages.some((message) => message.id === current)) return current;
          return nextMessages[0]?.id ?? null;
        });
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Inbox refresh failed.');
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    },
    [mailbox],
  );

  useEffect(() => {
    if (!mailbox || !isPageVisible || document.visibilityState !== 'visible') return;
    void refreshMessages();

    const autoCheckEndsAt = Math.min(mailbox.createdAt + AUTO_CHECK_DURATION_SECONDS, mailbox.expiresAt);
    const autoCheckRemainingMs = autoCheckEndsAt * 1_000 - Date.now();
    if (autoCheckRemainingMs <= 0) return;

    const poller = window.setInterval(() => {
      if (Date.now() >= autoCheckEndsAt * 1_000) {
        window.clearInterval(poller);
        return;
      }
      void refreshMessages();
    }, AUTO_CHECK_INTERVAL_MS);
    const stopTimer = window.setTimeout(() => window.clearInterval(poller), autoCheckRemainingMs);

    return () => {
      window.clearInterval(poller);
      window.clearTimeout(stopTimer);
    };
  }, [isPageVisible, mailbox, refreshMessages]);

  useEffect(() => {
    if (!mailbox || !selectedId) {
      setSelectedMessage(null);
      return;
    }

    let active = true;
    setMessageLoading(true);
    void getMessage(mailbox, selectedId)
      .then((message) => {
        if (active) setSelectedMessage(message);
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Message could not be opened.');
      })
      .finally(() => {
        if (active) setMessageLoading(false);
      });

    return () => {
      active = false;
    };
  }, [mailbox, selectedId]);

  useEffect(() => {
    if (mailbox && now >= mailbox.expiresAt) {
      clearStoredMailbox();
      setMailbox(null);
      void makeMailbox();
    }
  }, [mailbox, makeMailbox, now]);

  const remaining = useMemo(() => (mailbox ? formatRemaining(mailbox.expiresAt, now) : '--:--'), [mailbox, now]);
  const autoCheckEndsAt = mailbox
    ? Math.min(mailbox.createdAt + AUTO_CHECK_DURATION_SECONDS, mailbox.expiresAt)
    : 0;
  const autoCheckRemaining = autoCheckEndsAt > now ? formatRemaining(autoCheckEndsAt, now) : '00:00';
  const isAutoChecking = Boolean(mailbox && isPageVisible && autoCheckEndsAt > now);

  const copyAddress = async () => {
    if (!mailbox) return;
    await navigator.clipboard.writeText(mailbox.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const replaceMailbox = async () => {
    const previous = mailbox;
    clearStoredMailbox();
    setMailbox(null);
    if (previous) void deleteMailbox(previous).catch(() => undefined);
    await makeMailbox();
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/[0.07] bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5" aria-label="ThunderMail">
            <span className="grid size-8 place-items-center rounded-lg bg-violet-500 text-white shadow-[0_0_24px_rgba(139,92,246,0.35)]">
              <Mail className="size-4" strokeWidth={2.4} />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">ThunderMail</span>
            <Badge className="border border-white/[0.08] bg-white/[0.05] text-[10px] text-zinc-400" variant="secondary">BETA</Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="hidden sm:inline">Private by design</span><ShieldCheck className="size-4 text-emerald-400" />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-7">
        <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-violet-400">Your temporary inbox</p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Ready when you are.</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 sm:min-w-[390px]">
              {status === 'starting' ? (
                <span className="flex flex-1 items-center gap-2 text-xs text-zinc-500"><LoaderCircle className="size-3.5 animate-spin" /> Creating a private address…</span>
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-zinc-200">{mailbox?.address ?? 'Inbox unavailable'}</span>
              )}
              <Button aria-label="Copy email address" className="-mr-1 text-zinc-400 hover:text-white" disabled={!mailbox} onClick={copyAddress} size="icon-sm" suppressHydrationWarning variant="ghost">
                {copied ? <Check className="text-emerald-400" /> : <Copy />}
              </Button>
            </div>
            <Button className="h-10 bg-violet-500 px-4 text-white hover:bg-violet-400" disabled={status === 'starting'} onClick={() => void replaceMailbox()} size="lg" suppressHydrationWarning>
              <Plus data-icon="inline-start" /> New address
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-red-400/15 bg-red-400/[0.06] px-3 py-2.5 text-xs text-red-200" role="alert">
            <span className="flex items-center gap-2"><AlertCircle className="size-4" />{error}</span>
            {status === 'error' && <Button className="text-red-100" onClick={() => void makeMailbox()} size="sm" variant="ghost">Try again</Button>}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="relative flex size-2">
              {isAutoChecking && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />}
              <span className={`relative inline-flex size-2 rounded-full ${isAutoChecking ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            </span>
            <span>{isAutoChecking ? 'Checking automatically' : 'Auto-check paused'}</span>
            {isAutoChecking && <><Separator className="mx-1 h-4!" orientation="vertical" /><Clock3 className="size-3.5" /><span className="font-mono text-zinc-300">{autoCheckRemaining}</span></>}
            <Separator className="mx-1 h-4!" orientation="vertical" /><span className="text-zinc-500">Inbox</span><span className="font-mono text-zinc-300">{remaining}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button className="text-zinc-400" disabled={!mailbox || refreshing} onClick={() => void refreshMessages(true)} size="sm" suppressHydrationWarning variant="ghost">
              <RefreshCw className={refreshing ? 'animate-spin' : ''} data-icon="inline-start" /> Refresh
            </Button>
            <Button aria-label="Delete inbox" className="text-zinc-500 hover:text-red-300" disabled={!mailbox} onClick={() => void replaceMailbox()} size="icon-sm" suppressHydrationWarning variant="ghost"><Trash2 /></Button>
          </div>
        </div>

        <div className="grid min-h-[570px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0d10] shadow-[0_20px_80px_rgba(0,0,0,0.25)] lg:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="border-b border-white/[0.07] lg:border-r lg:border-b-0">
            <div className="flex h-14 items-center justify-between border-b border-white/[0.07] px-4">
              <div className="flex items-center gap-2 text-sm font-medium"><Inbox className="size-4 text-zinc-400" /> Inbox <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">{messages.length}</span></div>
              <Button aria-label="Inbox actions" className="text-zinc-500" size="icon-sm" variant="ghost"><MoreHorizontal /></Button>
            </div>

            <div className="max-h-[330px] overflow-y-auto lg:max-h-[515px]">
              {messages.map((message) => (
                <button className={`w-full border-l-2 px-4 py-4 text-left transition-colors ${selectedId === message.id ? 'border-violet-400 bg-violet-500/[0.08]' : 'border-transparent hover:bg-white/[0.025]'}`} key={message.id} onClick={() => setSelectedId(message.id)}>
                  <div className="mb-1 flex items-center justify-between gap-3"><span className="truncate text-sm font-medium text-zinc-100">{senderName(message)}</span><time className="shrink-0 text-[11px] text-zinc-500">{formatTime(message.receivedAt)}</time></div>
                  <p className="truncate text-[13px] font-medium text-zinc-300">{message.subject || '(No subject)'}</p>
                  <p className="mt-1 truncate text-xs text-zinc-500">{message.preview || 'No text preview available'}</p>
                </button>
              ))}

              {messages.length === 0 && status !== 'starting' && (
                <div className="flex flex-col items-center px-8 py-14 text-center">
                  <span className="mb-3 grid size-10 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.025]"><Check className="size-4 text-zinc-500" /></span>
                  <p className="text-xs font-medium text-zinc-400">Waiting for your first email</p><p className="mt-1 text-[11px] leading-5 text-zinc-600">{isAutoChecking ? 'Checking automatically for the first 3 minutes.' : 'Click Refresh to check for new messages.'}</p>
                </div>
              )}
            </div>
          </aside>

          <MessageViewer loading={messageLoading} message={selectedMessage} />
        </div>

        <footer className="flex flex-col items-center justify-between gap-2 px-1 pt-5 text-[11px] text-zinc-600 sm:flex-row"><p>No accounts. No tracking. Inbox data expires automatically.</p><p>temp.thunderanticheat.app</p></footer>
        <span className="sr-only" aria-live="polite">{copied ? 'Email address copied' : ''}</span>
      </section>
    </main>
  );
}

function MessageViewer({ loading, message }: { loading: boolean; message: Message | null }) {
  if (loading) {
    return <div className="grid min-h-[360px] place-items-center"><LoaderCircle className="size-5 animate-spin text-violet-400" /><span className="sr-only">Loading message</span></div>;
  }

  if (!message) {
    return (
      <div className="grid min-h-[360px] place-items-center px-6 text-center">
        <div><span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.025]"><Mail className="size-5 text-zinc-600" /></span><h2 className="text-sm font-medium text-zinc-300">No message selected</h2><p className="mt-1 text-xs text-zinc-600">Choose a message when it arrives.</p></div>
      </div>
    );
  }

  return (
    <article className="flex min-w-0 flex-col">
      <div className="border-b border-white/[0.07] px-5 py-5 sm:px-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><h2 className="truncate text-lg font-semibold tracking-[-0.02em]">{message.subject || '(No subject)'}</h2><div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500"><span className="font-medium text-zinc-300">{senderName(message)}</span><span>&lt;{message.fromAddress}&gt;</span><span className="text-zinc-700">•</span><span>to {message.toAddress}</span></div></div>
          <Badge className="border border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300" variant="outline">Safe HTML</Badge>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 py-7 sm:px-7">
        {message.htmlBody ? (
          <iframe className="min-h-[420px] w-full rounded-xl border border-white/[0.07] bg-white" referrerPolicy="no-referrer" sandbox="" srcDoc={message.htmlBody} title={`Email: ${message.subject || 'No subject'}`} />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-zinc-300">{message.textBody || 'This message has no displayable body.'}</pre>
        )}
      </div>
    </article>
  );
}
