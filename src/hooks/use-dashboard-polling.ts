'use client';

import { useEffect, useRef } from 'react';

import { loadDashboardSnapshot } from '@/app/actions';
import type { DashboardSnapshot, LiveStatus } from '@/lib/dashboard/types';

/**
 * How often the dashboard asks the server for a fresh snapshot.
 *
 * Fast enough to feel instant for a chat operator, and the payload is small:
 * one conversation list plus, only when it actually changed, the open thread.
 */
export const DASHBOARD_POLL_INTERVAL_MS = 3_000;

interface PollingOptions {
  /** The conversation currently on screen, or null when none is selected. */
  activeChatId: string | null;
  /**
   * `created_at` of the newest message already on screen for `activeChatId`.
   * The server compares it against the chat's real newest message and skips
   * sending a thread that the client already has.
   */
  newestMessageAt: string | null;
  onSnapshot: (snapshot: DashboardSnapshot) => void;
  onStatusChange: (status: LiveStatus) => void;
}

/**
 * Keeps the dashboard current by polling a Server Action.
 *
 * This deliberately replaces a Supabase Realtime websocket subscription.
 * Realtime can only stream a table the `anon` role is allowed to SELECT, which
 * meant shipping the public anon key to the browser and leaving every chat,
 * message and order readable - and deletable - by anyone who opened devtools.
 * Polling runs through `loadDashboardSnapshot`, which verifies the session
 * cookie and reads with the service_role key, so no key reaches the client and
 * the database can stay locked to the public role.
 *
 * Options are held in a ref so callers can pass inline closures without
 * restarting the interval on every render.
 */
export function useDashboardPolling(options: PollingOptions): void {
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function poll(): Promise<void> {
      // A poll that outlives the interval must not stack a second request on
      // top of it - that is how a slow database turns into a request flood.
      if (inFlight || cancelled) return;
      inFlight = true;

      try {
        const { activeChatId, newestMessageAt } = latest.current;
        const result = await loadDashboardSnapshot({
          chatId: activeChatId,
          newestMessageAt,
        });

        if (cancelled) return;

        if (result.ok) {
          latest.current.onSnapshot({
            chats: result.chats,
            thread: result.thread,
            events: result.events,
          });
          latest.current.onStatusChange('live');
        } else {
          latest.current.onStatusChange('error');
        }
      } catch {
        // A rejected Server Action is a network/session problem, not a reason
        // to stop polling: the next tick retries on its own.
        if (!cancelled) latest.current.onStatusChange('error');
      } finally {
        inFlight = false;
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), DASHBOARD_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
}
