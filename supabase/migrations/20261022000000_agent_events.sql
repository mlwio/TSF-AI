-- =============================================================================
-- Agent activity feed - `agent_events`
-- =============================================================================
-- The dashboard shows what each agent is doing in real time. Both agents run
-- inside after() on the webhook function, so nothing they do is observable from
-- the browser unless they write it down. This table is that write-down: one row
-- per step, polled by the dashboard alongside the conversation list.
--
-- Deliberately append-only and independent of `messages`: a row here is
-- telemetry, not a customer-facing message. Deleting a chat removes its events
-- (ON DELETE CASCADE), and events with a NULL chat_id (agent-level failures that
-- belong to no single conversation) survive.

CREATE TABLE public.agent_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id uuid REFERENCES public.chats(id) ON DELETE CASCADE,
  agent text NOT NULL CHECK (agent IN ('support_sales', 'order_manager')),
  event_type text NOT NULL CHECK (
    event_type IN (
      'started',
      'thinking',
      'sent',
      'order_placed',
      'order_failed',
      'skipped',
      'alert',
      'error'
    )
  ),
  title text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- SECURITY - Row Level Security
-- =============================================================================
-- Same reasoning as the other tables: every read goes through a Server Action
-- using the service_role key, which bypasses RLS. This policy exists only to
-- state that the public anon key must never see agent telemetry.
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_events_deny_all_anon ON public.agent_events;
CREATE POLICY agent_events_deny_all_anon ON public.agent_events
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- =============================================================================
-- PERFORMANCE - index for the dashboard feed
-- =============================================================================
-- The feed is always "newest N events", so a descending index on created_at
-- lets that read walk the index instead of sorting the table.
CREATE INDEX IF NOT EXISTS agent_events_created_at_idx
  ON public.agent_events (created_at DESC);
