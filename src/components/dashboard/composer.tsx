'use client';

import { Send } from 'lucide-react';
import { useRef, useState } from 'react';

/**
 * The admin's manual reply box. The draft is owned here and only cleared once
 * the server confirms the message actually left via the Meta Graph API — a
 * failed send must never swallow what you typed.
 */
export function Composer({
  onSend,
}: {
  onSend: (content: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !sending && draft.trim().length > 0;

  async function submit() {
    if (!canSend) return;

    setSending(true);
    const delivered = await onSend(draft.trim());
    setSending(false);

    if (delivered) {
      setDraft('');
      textareaRef.current?.focus();
    }
  }

  return (
    <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter inserts a newline.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Type a reply as a human agent..."
          className="flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
        >
          <Send className="h-4 w-4" aria-hidden />
          {sending ? 'Sending' : 'Send'}
        </button>
      </div>

      <p className="mt-1.5 px-1 text-[11px] text-zinc-400">
        Enter to send, Shift+Enter for a new line. This goes out as you, not as
        the AI.
      </p>
    </div>
  );
}
