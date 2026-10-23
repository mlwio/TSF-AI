-- =============================================================================
-- Unified AI Business Suite - Supabase schema
-- =============================================================================

CREATE TABLE public.chats (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('messenger', 'instagram')),
  customer_id text NOT NULL,
  customer_name text,
  bot_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, customer_id)
);

CREATE TABLE public.messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('user', 'bot', 'human_admin')),
  content text NOT NULL,
  external_message_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  product_details jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'placed', 'processing', 'shipped', 'delivered', 'cancelled', 'failed')),
  supplier_order_id text,
  customer_name text,
  customer_phone text,
  customer_address text,
  total_amount numeric(12,2),
  currency text DEFAULT 'BDT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Agent telemetry: one row per step an agent takes, so the dashboard can show
-- what Agent 1 (support/sales) and Agent 2 (order manager) are doing live.
-- Telemetry, not customer-facing messages - see supabase/migrations/
-- 20261022000000_agent_events.sql for the full rationale.
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

-- The tables used to be added to the `supabase_realtime` publication so the
-- dashboard could subscribe with the anon key. Realtime is gone: the dashboard
-- now polls a Server Action that reads with the service_role key, and the RLS
-- policies below deny the anon role outright - so a publication entry could
-- never deliver anything again. Leaving the tables out saves a replication slot
-- for no behavioural cost.

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ language 'plpgsql';

CREATE TRIGGER update_chats_modtime BEFORE UPDATE ON public.chats FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_orders_modtime BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- =============================================================================
-- SECURITY - Row Level Security
-- =============================================================================
-- Every read and write in this application goes through a Next.js Server
-- Action, a route handler or the webhook, all of which use the service_role
-- key. service_role BYPASSES RLS, so these policies cannot break the app - what
-- they stop is the public anon key, which used to be shipped to the browser and
-- could read, rewrite or DELETE every conversation.
--
-- RLS with no matching policy already denies by default; the policies below
-- state that intent explicitly for `anon`, and no policy is granted to
-- `authenticated` either, so the tables are closed to every non-service key.

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

-- `FOR ALL` covers SELECT, INSERT, UPDATE and DELETE in one policy:
-- USING (false) matches no existing row, WITH CHECK (false) accepts no new one.
-- DROP IF EXISTS first so this block can be re-run against a project whose
-- tables (and therefore policies) already exist.

DROP POLICY IF EXISTS chats_deny_all_anon ON public.chats;
CREATE POLICY chats_deny_all_anon ON public.chats
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS messages_deny_all_anon ON public.messages;
CREATE POLICY messages_deny_all_anon ON public.messages
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS orders_deny_all_anon ON public.orders;
CREATE POLICY orders_deny_all_anon ON public.orders
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS agent_events_deny_all_anon ON public.agent_events;
CREATE POLICY agent_events_deny_all_anon ON public.agent_events
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- =============================================================================
-- PERFORMANCE - indexes for the dashboard queries
-- =============================================================================
-- messages(chat_id, created_at): opening a conversation (equality on chat_id,
-- ordering by created_at) and the list preview scan both walk this in order
-- instead of sorting the whole table.
CREATE INDEX IF NOT EXISTS messages_chat_id_created_at_idx
  ON public.messages (chat_id, created_at);

-- orders(chat_id): the duplicate-order guard filters on chat_id on every
-- place_order call, and it also serves the ON DELETE CASCADE from chats.
CREATE INDEX IF NOT EXISTS orders_chat_id_idx
  ON public.orders (chat_id);

-- chats(updated_at): the dashboard sorts conversations by recency, falling back
-- to updated_at when a chat has no messages yet.
CREATE INDEX IF NOT EXISTS chats_updated_at_idx
  ON public.chats (updated_at);

-- agent_events(created_at DESC): the activity feed is always "newest N events",
-- so this lets that read walk the index instead of sorting the table.
CREATE INDEX IF NOT EXISTS agent_events_created_at_idx
  ON public.agent_events (created_at DESC);
