import { getAdminClient } from '@/lib/supabase/admin';
import type { AgentEventType, AgentName } from '@/types/database';

/**
 * Writes one line of agent telemetry for the dashboard's activity feed.
 *
 * Both agents execute inside after() on the webhook function, where nothing is
 * waiting on the result and an exception would be invisible. Every failure is
 * therefore caught and logged here: telemetry must never be able to break the
 * reply or the order it is describing.
 *
 * Callers await this so the row lands before the function freezes, which costs
 * one insert per step - cheap next to the Gemini round-trip it annotates.
 */
export async function recordAgentEvent(input: {
  agent: AgentName;
  eventType: AgentEventType;
  title: string;
  /** Free-form context: the reply being sent, the order id, the error, ... */
  detail?: string | null;
  /** Omitted for agent-level events that belong to no single conversation. */
  chatId?: string | null;
}): Promise<void> {
  try {
    const { error } = await getAdminClient()
      .from('agent_events')
      .insert({
        agent: input.agent,
        event_type: input.eventType,
        title: input.title,
        detail: input.detail ?? null,
        chat_id: input.chatId ?? null,
      });

    if (error) {
      console.error('[agent-events] could not record event', {
        error,
        input,
      });
    }
  } catch (error) {
    console.error('[agent-events] recording event threw', { error, input });
  }
}

/**
 * Keeps a telemetry `detail` to a sane length. Agent 1 quotes whole replies in
 * an event, and a runaway model could otherwise stuff a novel into a column the
 * dashboard polls every three seconds.
 */
export function truncateDetail(value: string, limit = 500): string {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}
