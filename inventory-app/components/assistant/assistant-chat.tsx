'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type ChatMessage = { role: 'user' | 'assistant'; content: string; toolsUsed?: string[]; error?: boolean };

const SUGGESTED_QUESTIONS = [
  'What should I reorder?',
  'Which products have not moved in 90 days?',
  'How much known inventory value do we hold?',
  'Summarise outstanding receivables.',
  'Show my fastest-moving products in the last 30 days.',
];

type ChatResponse =
  | { ok: true; reply: string; toolsUsed: string[] }
  | { ok: false; message: string };

/**
 * Client-side conversation UI. Never talks to OpenAI directly -- every
 * message goes through /api/assistant/chat, which is the only place the
 * server-only OpenAI client and API key exist.
 */
export function AssistantChat({ scopeLabel }: { scopeLabel: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setSending(true);

    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const data = (await response.json()) as ChatResponse;
      if (!data.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.message, error: true }]);
        return;
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, toolsUsed: data.toolsUsed }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Ask 24/7 is temporarily unavailable. Try again in a moment.', error: true },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="operations-panel flex flex-col gap-4 p-4">
      {messages.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Ask about stock, replenishment, movement, or receivables for {scopeLabel}. Answers come from live
            application data, not the model&apos;s own knowledge.
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => send(question)}
                disabled={sending}
                className="rounded-full border border-input bg-background px-3 py-1.5 text-xs transition-colors hover:bg-secondary disabled:opacity-50"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto" role="log" aria-live="polite">
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                'flex flex-col gap-1 rounded-lg px-3 py-2 text-sm',
                message.role === 'user' ? 'ml-auto max-w-[80%] bg-primary text-primary-foreground' : 'mr-auto max-w-[85%]',
                message.role === 'assistant' && !message.error ? 'bg-secondary' : '',
                message.error ? 'bg-danger-soft text-danger' : '',
              )}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.toolsUsed && message.toolsUsed.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">Based on: {message.toolsUsed.join(', ')}</p>
              ) : null}
            </div>
          ))}
          {sending ? (
            <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              Checking application data…
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        className="flex items-end gap-2"
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about stock, replenishment, or receivables…"
          rows={2}
          maxLength={2000}
          disabled={sending}
          className="flex-1"
          aria-label="Ask 24/7 question"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
        />
        <Button type="submit" disabled={sending || !input.trim()} aria-label="Send question">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
