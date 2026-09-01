'use client';

/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The inbox is an interactive ARIA listbox, not a form select. */

import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock3,
  Copy,
  Inbox,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  createMailbox,
  deleteMailbox,
  getMessage,
  listMessages,
  type Mailbox,
  type Message,
  type MessageSummary,
} from '@/lib/api';
import {
  clearStoredMailbox,
  loadStoredMailbox,
  storeMailbox,
} from '@/lib/mailbox-storage';

const AUTO_CHECK_INTERVAL_MS = 10_000;
const AUTO_CHECK_DURATION_SECONDS = 3 * 60;
const DEFAULT_DOCUMENT_TITLE = 'ThunderMail — Temporary email, instantly';

function formatRemaining(expiresAt: number, now: number): string {
  const seconds = Math.max(0, expiresAt - now);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatTime(timestamp: number): string {
  const elapsed = Math.floor(Date.now() / 1000) - timestamp;
  if (elapsed < 60) return 'Just now';
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp * 1000);
}

function senderName(message: MessageSummary): string {
  return message.fromName?.trim() || message.fromAddress;
}

function Countdown({
  endsAt,
  className,
}: {
  endsAt: number;
  className?: string;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const timer = window.setInterval(() => {
      const currentTime = Math.floor(Date.now() / 1000);
      setNow(currentTime);
      if (currentTime >= endsAt) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  return <span className={className}>{formatRemaining(endsAt, now)}</span>;
}

function MailboxExpiry({ mailbox }: { mailbox: Mailbox }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const warnedMailboxRef = useRef<string | null>(null);

  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    warnedMailboxRef.current = null;
    const timer = window.setInterval(() => {
      const currentTime = Math.floor(Date.now() / 1000);
      setNow(currentTime);
      if (currentTime >= mailbox.expiresAt) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [mailbox.id, mailbox.expiresAt]);

  const remaining = Math.max(0, mailbox.expiresAt - now);
  const lifetime = Math.max(1, mailbox.expiresAt - mailbox.createdAt);
  const remainingPercent = Math.min(100, (remaining / lifetime) * 100);
  const isWarning = remaining <= 60;
  const isCritical = remaining <= 20;

  useEffect(() => {
    if (
      remaining > 0 &&
      remaining <= 60 &&
      warnedMailboxRef.current !== mailbox.id
    ) {
      warnedMailboxRef.current = mailbox.id;
      toast.add({
        id: `expiry-${mailbox.id}`,
        title: 'Address expires in one minute',
        description:
          'Copy anything you still need before this inbox is replaced.',
        priority: 'high',
        timeout: 6_000,
        type: 'warning',
      });
    }
  }, [mailbox.id, remaining]);

  const progressTone = isCritical
    ? '[&_[data-slot=progress-indicator]]:bg-red-400'
    : isWarning
      ? '[&_[data-slot=progress-indicator]]:bg-amber-400'
      : '[&_[data-slot=progress-indicator]]:bg-violet-400';

  return (
    <>
      <span
        className={
          isCritical
            ? 'text-red-300 motion-safe:animate-pulse'
            : isWarning
              ? 'text-amber-300'
              : 'text-zinc-400'
        }
      >
        Inbox expires in{' '}
        <span className="font-mono text-current">
          {formatRemaining(mailbox.expiresAt, now)}
        </span>
      </span>
      <Progress
        aria-label="Mailbox lifetime remaining"
        className={`absolute inset-x-0 bottom-0 block gap-0 rounded-none [&_[data-slot=progress-indicator]]:transition-colors [&_[data-slot=progress-track]]:h-0.5 [&_[data-slot=progress-track]]:rounded-none [&_[data-slot=progress-track]]:bg-white/[0.035] ${progressTone}`}
        value={remainingPercent}
      />
    </>
  );
}

function MailboxListSkeleton() {
  return (
    <div aria-label="Creating mailbox and loading messages" role="status">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="border-b border-app-border px-5 py-4" key={index}>
          <div className="mb-2 flex items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-28 bg-white/[0.08] motion-reduce:animate-none" />
            <Skeleton className="h-2.5 w-10 bg-white/[0.06] motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-3 w-4/5 bg-white/[0.07] motion-reduce:animate-none" />
          <Skeleton className="mt-2 h-2.5 w-3/5 bg-white/[0.05] motion-reduce:animate-none" />
        </div>
      ))}
      <span className="sr-only">Creating your private address…</span>
    </div>
  );
}

export function MailboxApp() {
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>(
    'starting',
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [isAutoChecking, setIsAutoChecking] = useState(false);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(() => new Set());
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const creatingRef = useRef(false);
  const refreshingRef = useRef(false);
  const messageRowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const messageBaselineReadyRef = useRef(false);
  const arrivalTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const installMailbox = useCallback((nextMailbox: Mailbox) => {
    storeMailbox(nextMailbox);
    setMailbox(nextMailbox);
    setMessages([]);
    setSelectedId(null);
    setSelectedMessage(null);
    setReaderOpen(false);
    setUnreadIds(new Set());
    setNewMessageIds(new Set());
    knownMessageIdsRef.current = new Set();
    messageBaselineReadyRef.current = false;
    if (arrivalTimerRef.current !== null) {
      window.clearTimeout(arrivalTimerRef.current);
      arrivalTimerRef.current = null;
    }
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
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not create an inbox.',
      );
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
    const updateVisibility = () =>
      setIsPageVisible(document.visibilityState === 'visible');
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () =>
      document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    document.title = unreadIds.size
      ? `(${unreadIds.size}) ThunderMail`
      : DEFAULT_DOCUMENT_TITLE;
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [unreadIds.size]);

  useEffect(
    () => () => {
      if (arrivalTimerRef.current !== null)
        window.clearTimeout(arrivalTimerRef.current);
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    const closeMobileReader = (event: MediaQueryListEvent) => {
      if (event.matches) setReaderOpen(false);
    };
    desktopQuery.addEventListener('change', closeMobileReader);
    return () => desktopQuery.removeEventListener('change', closeMobileReader);
  }, []);

  const refreshMessages = useCallback(
    async (showSpinner = false) => {
      if (!mailbox || mailbox.expiresAt <= Math.floor(Date.now() / 1000))
        return;
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      if (showSpinner) setRefreshing(true);
      try {
        const nextMessages = await listMessages(mailbox);
        const nextIds = new Set(nextMessages.map((message) => message.id));
        const arrivingMessages = messageBaselineReadyRef.current
          ? nextMessages.filter(
              (message) => !knownMessageIdsRef.current.has(message.id),
            )
          : [];

        knownMessageIdsRef.current = nextIds;
        messageBaselineReadyRef.current = true;
        setMessages(nextMessages);
        setUnreadIds((current) => {
          const nextUnread = new Set(
            [...current].filter((messageId) => nextIds.has(messageId)),
          );
          arrivingMessages.forEach((message) => nextUnread.add(message.id));
          return nextUnread;
        });

        if (arrivingMessages.length > 0) {
          const arrivingIds = new Set(
            arrivingMessages.map((message) => message.id),
          );
          setNewMessageIds(arrivingIds);
          if (arrivalTimerRef.current !== null)
            window.clearTimeout(arrivalTimerRef.current);
          arrivalTimerRef.current = window.setTimeout(() => {
            setNewMessageIds(new Set());
            arrivalTimerRef.current = null;
          }, 1_200);

          const newestMessage = arrivingMessages[0];
          toast.add({
            id: `new-mail-${mailbox.id}`,
            title:
              arrivingMessages.length === 1
                ? 'New email received'
                : `${arrivingMessages.length} new emails received`,
            description:
              arrivingMessages.length === 1
                ? `${senderName(newestMessage)} · ${newestMessage.subject || 'No subject'}`
                : 'Open your inbox to read the new messages.',
            timeout: 5_000,
            type: 'info',
          });
        }

        setError(null);
        setSelectedId((current) => {
          if (current && nextMessages.some((message) => message.id === current))
            return current;
          return null;
        });
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Inbox refresh failed.',
        );
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    },
    [mailbox],
  );

  useEffect(() => {
    if (!mailbox || !isPageVisible || document.visibilityState !== 'visible')
      return;
    void refreshMessages();

    const autoCheckEndsAt = Math.min(
      mailbox.createdAt + AUTO_CHECK_DURATION_SECONDS,
      mailbox.expiresAt,
    );
    const autoCheckRemainingMs = autoCheckEndsAt * 1_000 - Date.now();
    if (autoCheckRemainingMs <= 0) return;

    const poller = window.setInterval(() => {
      if (Date.now() >= autoCheckEndsAt * 1_000) {
        window.clearInterval(poller);
        return;
      }
      void refreshMessages();
    }, AUTO_CHECK_INTERVAL_MS);
    const stopTimer = window.setTimeout(
      () => window.clearInterval(poller),
      autoCheckRemainingMs,
    );

    return () => {
      window.clearInterval(poller);
      window.clearTimeout(stopTimer);
    };
  }, [isPageVisible, mailbox, refreshMessages]);

  useEffect(() => {
    if (!mailbox || !isPageVisible) {
      setIsAutoChecking(false);
      return;
    }

    const autoCheckEndsAt = Math.min(
      mailbox.createdAt + AUTO_CHECK_DURATION_SECONDS,
      mailbox.expiresAt,
    );
    const remainingMs = autoCheckEndsAt * 1_000 - Date.now();
    if (remainingMs <= 0) {
      setIsAutoChecking(false);
      return;
    }

    setIsAutoChecking(true);
    const stopTimer = window.setTimeout(
      () => setIsAutoChecking(false),
      remainingMs,
    );
    return () => window.clearTimeout(stopTimer);
  }, [isPageVisible, mailbox]);

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
        if (active)
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Message could not be opened.',
          );
      })
      .finally(() => {
        if (active) setMessageLoading(false);
      });

    return () => {
      active = false;
    };
  }, [mailbox, selectedId]);

  useEffect(() => {
    if (!mailbox) return;

    const expireMailbox = () => {
      clearStoredMailbox();
      setMailbox(null);
      void makeMailbox();
    };
    const remainingMs = mailbox.expiresAt * 1_000 - Date.now();
    if (remainingMs <= 0) {
      expireMailbox();
      return;
    }

    const expiryTimer = window.setTimeout(expireMailbox, remainingMs);
    return () => window.clearTimeout(expiryTimer);
  }, [mailbox, makeMailbox]);

  const autoCheckEndsAt = mailbox
    ? Math.min(
        mailbox.createdAt + AUTO_CHECK_DURATION_SECONDS,
        mailbox.expiresAt,
      )
    : 0;

  const copyAddress = async () => {
    if (!mailbox) return;
    try {
      await navigator.clipboard.writeText(mailbox.address);
      setCopied(true);
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 1_500);
    } catch {
      toast.add({
        title: 'Could not copy address',
        description: 'Select the address and copy it manually.',
        type: 'error',
      });
    }
  };

  const replaceMailbox = async () => {
    const previous = mailbox;
    clearStoredMailbox();
    setMailbox(null);
    if (previous) void deleteMailbox(previous).catch(() => undefined);
    await makeMailbox();
  };

  const confirmMailboxReplacement = () => {
    setReplaceDialogOpen(false);
    void replaceMailbox();
  };

  const markMessageRead = (messageId: string) => {
    setUnreadIds((current) => {
      if (!current.has(messageId)) return current;
      const next = new Set(current);
      next.delete(messageId);
      return next;
    });
  };

  const openMessage = (messageId: string) => {
    if (messageId !== selectedId) setMessageLoading(true);
    markMessageRead(messageId);
    setSelectedId(messageId);
    if (!window.matchMedia('(min-width: 1024px)').matches) {
      setReaderOpen(true);
    }
  };

  const closeSelectedMessage = () => {
    const selectedIndex = messages.findIndex(
      (message) => message.id === selectedId,
    );
    setReaderOpen(false);
    setSelectedId(null);
    setSelectedMessage(null);
    setMessageLoading(false);
    window.requestAnimationFrame(() => {
      if (selectedIndex >= 0) messageRowRefs.current[selectedIndex]?.focus();
    });
  };

  const handleMessageKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown')
      nextIndex = Math.min(index + 1, messages.length - 1);
    if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = messages.length - 1;
    if (nextIndex === null || nextIndex === index) return;

    event.preventDefault();
    const nextMessageId = messages[nextIndex].id;
    markMessageRead(nextMessageId);
    setSelectedId(nextMessageId);
    messageRowRefs.current[nextIndex]?.focus();
  };

  return (
    <main className="relative flex h-dvh min-h-0 flex-col overflow-hidden text-foreground">
      <header className="sticky top-0 z-40 shrink-0 border-b border-app-border bg-app-header backdrop-blur-2xl">
        <div className="mx-auto flex h-[var(--app-header-height)] max-w-[1440px] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
          <div
            className="flex shrink-0 items-center gap-2.5"
            aria-label="ThunderMail"
          >
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-[0_8px_30px_rgba(124,58,237,0.3)] ring-1 ring-white/15">
              <Mail className="size-4" strokeWidth={2.4} />
            </span>
            <span className="hidden text-[15px] font-semibold tracking-[-0.025em] md:inline">
              ThunderMail
            </span>
            <Badge
              className="hidden h-5 border border-violet-400/15 bg-violet-400/[0.07] px-2 text-[9px] tracking-[0.08em] text-violet-300 xl:inline-flex"
              variant="secondary"
            >
              BETA
            </Badge>
          </div>

          <div className="ml-auto hidden shrink-0 items-center gap-2 rounded-full border border-app-border bg-app-surface-muted px-3 py-1.5 text-[11px] text-zinc-400 2xl:flex">
            <ShieldCheck className="size-3.5 text-emerald-400" />
            Private by design
          </div>

          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 2xl:ml-0">
            <div
              aria-label="Current email address"
              className="flex h-10 min-w-0 max-w-[540px] flex-1 items-center gap-2 rounded-xl border border-app-border bg-app-surface px-3 shadow-app-elevated"
            >
              {status === 'starting' ? (
                <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-xs text-zinc-400">
                  <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" />
                  <span className="shimmer truncate">
                    Creating private address…
                  </span>
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200 sm:text-[13px]">
                  {mailbox?.address ?? 'Inbox unavailable'}
                </span>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label="Copy email address"
                      className="-mr-1 size-7 rounded-lg text-zinc-400 hover:bg-app-surface-raised hover:text-white"
                      disabled={!mailbox}
                      onClick={copyAddress}
                      size="icon-sm"
                      suppressHydrationWarning
                      variant="ghost"
                    />
                  }
                >
                  <span className="relative size-4">
                    <Copy
                      className={`absolute inset-0 transition-all duration-200 motion-reduce:transition-none ${copied ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}`}
                    />
                    <Check
                      className={`absolute inset-0 text-emerald-400 transition-all duration-200 motion-reduce:transition-none ${copied ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {copied ? 'Copied' : 'Copy address'}
                </TooltipContent>
              </Tooltip>
            </div>
            <Button
              aria-label="Create new address"
              className="size-10 rounded-xl bg-violet-500 px-0 text-white shadow-[0_10px_26px_rgba(124,58,237,0.22)] hover:bg-violet-400 sm:w-auto sm:px-4"
              disabled={status === 'starting'}
              onClick={() =>
                mailbox ? setReplaceDialogOpen(true) : void makeMailbox()
              }
              size="lg"
              suppressHydrationWarning
            >
              <Plus /> <span className="hidden sm:inline">New address</span>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col overflow-hidden px-3 py-3 sm:px-6 lg:px-8">
        <h1 className="sr-only">ThunderMail temporary inbox</h1>
        {error && (
          <div
            className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-red-400/15 bg-red-400/[0.06] px-4 py-3 text-xs text-red-200"
            role="alert"
          >
            <span className="flex items-center gap-2">
              <AlertCircle className="size-4" />
              {error}
            </span>
            {status === 'error' && (
              <Button
                className="text-red-100"
                onClick={() => void makeMailbox()}
                size="sm"
                variant="ghost"
              >
                Try again
              </Button>
            )}
          </div>
        )}

        <div className="relative mb-3 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 overflow-hidden rounded-xl border border-app-border bg-app-toolbar px-3 py-2 shadow-app-elevated sm:px-4">
          <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-zinc-400 sm:text-xs">
            <span
              className={`flex items-center gap-2 rounded-full border px-2.5 py-1 ${isAutoChecking ? 'border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300' : 'border-app-border bg-app-surface-muted text-zinc-400'}`}
            >
              <span className="relative flex size-1.5">
                {isAutoChecking && (
                  <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-50 motion-safe:animate-ping" />
                )}
                <span
                  className={`relative inline-flex size-1.5 rounded-full ${isAutoChecking ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                />
              </span>
              {isAutoChecking ? 'Auto-checking' : 'Auto-check paused'}
            </span>
            {isAutoChecking && (
              <>
                <Clock3 className="ml-1 size-3.5 text-zinc-500" />
                <span>
                  Pauses in{' '}
                  <Countdown
                    className="font-mono text-zinc-300"
                    endsAt={autoCheckEndsAt}
                  />
                </span>
              </>
            )}
            <Separator
              className="mx-0.5 hidden h-4! sm:block"
              orientation="vertical"
            />
            {mailbox ? (
              <MailboxExpiry mailbox={mailbox} />
            ) : (
              <span className="text-zinc-400">
                Inbox expires in{' '}
                <span className="font-mono text-zinc-300">--:--</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              className="h-8 rounded-lg border border-app-border bg-app-surface px-3 text-zinc-300 hover:bg-app-surface-raised"
              disabled={!mailbox || refreshing}
              onClick={() => void refreshMessages(true)}
              size="sm"
              suppressHydrationWarning
              variant="ghost"
            >
              <RefreshCw
                className={refreshing ? 'motion-safe:animate-spin' : ''}
                data-icon="inline-start"
              />{' '}
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 overflow-hidden rounded-[20px] border border-app-border bg-app-shell shadow-app-shell ring-1 ring-black/20 lg:grid-cols-[360px_minmax(0,1fr)] lg:rounded-[24px]">
          <aside className="flex min-h-0 flex-col lg:border-r lg:border-app-border">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-app-border px-5">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <Inbox className="size-4 text-violet-400" /> Inbox{' '}
                  <span className="rounded-full border border-app-border bg-app-surface px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {messages.length}
                  </span>
                  {unreadIds.size > 0 && (
                    <span
                      className="rounded-full bg-violet-400/12 px-1.5 py-0.5 text-[10px] text-violet-300 motion-safe:animate-in motion-safe:zoom-in-75"
                      key={unreadIds.size}
                    >
                      {unreadIds.size} unread
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-zinc-400">
                  Messages disappear with this address
                </p>
              </div>
            </div>

            <div
              aria-busy={status === 'starting'}
              aria-label="Email messages"
              className="min-h-0 flex-1 scroll-py-4 overflow-y-auto overscroll-contain supports-[animation-timeline:scroll()]:scroll-fade-y supports-[animation-timeline:scroll()]:scroll-fade-4"
              role="listbox"
            >
              {status === 'starting' && <MailboxListSkeleton />}

              {messages.map((message, index) => {
                const isUnread = unreadIds.has(message.id);
                const isNew = newMessageIds.has(message.id);
                const staggerDelay = index < 6 ? `${index * 35}ms` : undefined;

                return (
                  <button
                    aria-label={`${isUnread ? 'Unread: ' : ''}${senderName(message)}: ${message.subject || 'No subject'}`}
                    aria-selected={selectedId === message.id}
                    className={`w-full border-l-2 px-5 py-4 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 motion-reduce:transition-none ${isNew ? 'mail-arrival' : 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200'} ${selectedId === message.id ? 'border-violet-400 bg-violet-500/[0.09]' : isUnread ? 'border-violet-400/40 bg-violet-400/[0.045] hover:bg-violet-400/[0.07]' : 'border-transparent hover:bg-app-surface-muted'}`}
                    key={message.id}
                    onClick={() => openMessage(message.id)}
                    onKeyDown={(event) => handleMessageKeyDown(event, index)}
                    ref={(element) => {
                      messageRowRefs.current[index] = element;
                    }}
                    role="option"
                    style={isNew ? undefined : { animationDelay: staggerDelay }}
                    tabIndex={
                      selectedId === message.id || (!selectedId && index === 0)
                        ? 0
                        : -1
                    }
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        {isUnread && (
                          <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.7)]"
                          />
                        )}
                        <span
                          className={`truncate text-sm text-zinc-100 ${isUnread ? 'font-semibold' : 'font-medium'}`}
                        >
                          {senderName(message)}
                        </span>
                      </span>
                      <time className="shrink-0 text-[10px] text-zinc-400">
                        {formatTime(message.receivedAt)}
                      </time>
                    </div>
                    <p
                      className={`truncate text-[13px] ${isUnread ? 'font-medium text-zinc-100' : 'text-zinc-300'}`}
                    >
                      {message.subject || '(No subject)'}
                    </p>
                    <p className="mt-1.5 truncate text-[11px] text-zinc-400">
                      {message.preview || 'No text preview available'}
                    </p>
                  </button>
                );
              })}

              {messages.length === 0 && status === 'ready' && (
                <div className="flex flex-col items-center px-8 py-16 text-center">
                  <span className="relative mb-4 grid size-12 place-items-center rounded-2xl border border-app-border bg-app-surface shadow-app-elevated">
                    <Check className="size-4 text-zinc-500" />
                    {isAutoChecking && (
                      <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-app-shell bg-emerald-400" />
                    )}
                  </span>
                  <p className="text-xs font-medium text-zinc-300">
                    Your inbox is ready
                  </p>
                  <p className="mt-1.5 max-w-[210px] text-[11px] leading-5 text-zinc-400">
                    {isAutoChecking
                      ? 'We’ll place new messages here automatically for the first 3 minutes.'
                      : 'Click Refresh whenever you want to check for new messages.'}
                  </p>
                </div>
              )}
            </div>
          </aside>

          <div className="hidden min-h-0 lg:flex">
            <MessageViewer
              loading={messageLoading}
              message={selectedMessage}
              onBack={closeSelectedMessage}
            />
          </div>
        </div>

        <footer className="hidden shrink-0 items-center justify-between gap-2 px-1 pt-2 text-[10px] text-zinc-400 sm:flex">
          <p>No accounts · No tracking · Automatic expiration</p>
          <p>temp.thunderanticheat.app</p>
        </footer>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Email address copied' : ''}
        </span>
      </section>

      <Drawer onOpenChange={setReaderOpen} open={readerOpen} showSwipeHandle>
        <DrawerContent className="h-[calc(100dvh-0.75rem)] rounded-t-[24px] border-app-border bg-app-shell lg:hidden">
          <DrawerHeader className="flex-row items-center border-b border-app-border p-3 pb-3 text-left">
            <Button
              className="text-zinc-300 hover:bg-app-surface-raised"
              onClick={() => setReaderOpen(false)}
              size="sm"
              variant="ghost"
            >
              <ArrowLeft data-icon="inline-start" /> Inbox
            </Button>
            <DrawerTitle className="sr-only">Selected email</DrawerTitle>
            <DrawerDescription className="sr-only">
              Read the selected email. Return to the inbox to choose another.
            </DrawerDescription>
          </DrawerHeader>
          <MessageViewer loading={messageLoading} message={selectedMessage} />
        </DrawerContent>
      </Drawer>

      <AlertDialog onOpenChange={setReplaceDialogOpen} open={replaceDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-red-400/10 text-red-300">
              <AlertCircle />
            </AlertDialogMedia>
            <AlertDialogTitle>Create a new address?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current address and all of its messages will be permanently
              deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current address</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmMailboxReplacement}
              variant="destructive"
            >
              Create new address
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function MessageViewer({
  loading,
  message,
  onBack,
}: {
  loading: boolean;
  message: Message | null;
  onBack?: () => void;
}) {
  if (loading) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <LoaderCircle className="size-5 text-violet-400 motion-safe:animate-spin" />
        <span className="sr-only">Loading message</span>
      </div>
    );
  }

  if (!message) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center bg-[radial-gradient(circle_at_center,rgba(124,58,237,0.045),transparent_16rem)] px-6 text-center">
        <div>
          <span className="mx-auto mb-5 grid size-14 place-items-center rounded-[20px] border border-app-border bg-app-surface-muted shadow-app-elevated">
            <Mail className="size-5 text-zinc-500" />
          </span>
          <h2 className="text-sm font-medium text-zinc-300">
            Messages open here
          </h2>
          <p className="mt-1.5 text-xs text-zinc-400">
            Select an email from your inbox to read it safely.
          </p>
        </div>
      </div>
    );
  }

  return (
    <article className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-app-border px-5 py-4 sm:px-7 sm:py-5">
        <div className="flex items-start gap-3">
          {onBack && (
            <Button
              className="mt-0.5 shrink-0 rounded-lg text-zinc-400 hover:bg-app-surface-raised hover:text-white"
              onClick={onBack}
              size="sm"
              variant="ghost"
            >
              <ArrowLeft data-icon="inline-start" /> Inbox
            </Button>
          )}
          <div
            className="flex min-w-0 flex-1 items-start justify-between gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-1 motion-safe:duration-200"
            key={message.id}
          >
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-[-0.02em]">
                {message.subject || '(No subject)'}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                <span className="font-medium text-zinc-300">
                  {senderName(message)}
                </span>
                <span>&lt;{message.fromAddress}&gt;</span>
                <span className="text-zinc-500">•</span>
                <span>to {message.toAddress}</span>
              </div>
            </div>
            {message.htmlBody && (
              <Badge
                className="border border-emerald-400/15 bg-emerald-400/[0.07] text-emerald-300"
                variant="outline"
              >
                Safe HTML
              </Badge>
            )}
          </div>
        </div>
      </div>

      {message.htmlBody ? (
        <div className="min-h-0 flex-1 bg-black/[0.06] p-3 sm:p-5">
          <iframe
            className="h-full min-h-0 w-full rounded-2xl border border-app-border bg-white shadow-app-elevated"
            referrerPolicy="no-referrer"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={message.htmlBody}
            title={`Email: ${message.subject || 'No subject'}`}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-black/[0.06] px-4 py-5 sm:px-7 sm:py-7">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-zinc-300">
            {message.textBody || 'This message has no displayable body.'}
          </pre>
        </div>
      )}
    </article>
  );
}
