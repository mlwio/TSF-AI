export type Platform = 'messenger' | 'instagram';
export type SenderRole = 'user' | 'bot' | 'human_admin';
export type OrderStatus = 'pending' | 'placed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'failed';
export type AgentName = 'support_sales' | 'order_manager';
export type AgentEventType =
  | 'started'
  | 'thinking'
  | 'sent'
  | 'order_placed'
  | 'order_failed'
  | 'skipped'
  | 'alert'
  | 'error';

/**
 * Every column name and type below is unchanged from the original spec.
 *
 * What was ADDED is pure type scaffolding that @supabase/postgrest-js requires
 * as MANDATORY on its GenericTable / GenericSchema constraints:
 *   - `Relationships` on each table
 *   - `Views`, `Functions`, `Enums`, `CompositeTypes` on the schema
 *   - `interface Database` -> `type Database`
 *
 * Without these, `createClient<Database>()` still compiles, but every
 * `.from('chats')...` call collapses to `never` (unusable queries, no autocompletion).
 *
 * `type` instead of `interface` matters too: TypeScript only grants an implicit
 * index signature to type aliases of object types, which is how the schema is
 * matched against `Record<string, GenericTable>`. This is also the exact shape
 * `npx supabase gen types typescript` emits.
 */
export type Database = {
  public: {
    Tables: {
      chats: {
        Row: {
          id: string;
          platform: Platform;
          customer_id: string;
          customer_name: string | null;
          bot_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['chats']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['chats']['Insert']>;
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          chat_id: string;
          sender_role: SenderRole;
          content: string;
          external_message_id: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['messages']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['messages']['Insert']>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          chat_id: string;
          product_details: any;
          status: OrderStatus;
          supplier_order_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          customer_address: string | null;
          total_amount: number | null;
          currency: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['orders']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['orders']['Insert']>;
        Relationships: [];
      };
      agent_events: {
        Row: {
          id: string;
          chat_id: string | null;
          agent: AgentName;
          event_type: AgentEventType;
          title: string;
          detail: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['agent_events']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['agent_events']['Insert']>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// Convenience aliases used throughout the app.
export type ChatRow = Database['public']['Tables']['chats']['Row'];
export type MessageRow = Database['public']['Tables']['messages']['Row'];
export type OrderRow = Database['public']['Tables']['orders']['Row'];
export type AgentEventRow = Database['public']['Tables']['agent_events']['Row'];
