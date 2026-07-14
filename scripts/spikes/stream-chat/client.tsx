/**
 * Slice 30b — Spike A, part 2: minimal `useChat` client (@ai-sdk/react@^3, v6).
 * Renders leaf tokens as they stream + surfaces the transient data-status part.
 */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string>('(none)');

  const { messages, sendMessage, status: chatStatus } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    // Transient data-parts arrive ONLY here, never in message.parts.
    onData: (dataPart: { type: string; data?: unknown }) => {
      if (dataPart.type === 'data-status') {
        setStatus(JSON.stringify(dataPart.data));
      }
    },
  });

  return (
    <div style={{ fontFamily: 'ui-monospace, monospace', maxWidth: 640, margin: '2rem auto', color: '#e6e6e6', background: '#0B0C0E', padding: 24, borderRadius: 8 }}>
      <h2 style={{ color: '#4C8DFF' }}>Slice 30b · Spike A — leaf streamText → useChat</h2>
      <div data-testid="rail" style={{ fontSize: 12, color: '#35D0C0', marginBottom: 12 }}>
        transient data-status (onData): {status} · chatStatus: {chatStatus}
      </div>
      <div data-testid="messages">
        {messages.map((m) => (
          <div key={m.id} style={{ margin: '8px 0' }}>
            <b style={{ color: m.role === 'user' ? '#888' : '#4C8DFF' }}>{m.role}:</b>{' '}
            <span data-role={m.role}>
              {m.parts.map((p, i) => (p.type === 'text' ? <span key={i}>{p.text}</span> : null))}
            </span>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput('');
        }}
        style={{ marginTop: 16, display: 'flex', gap: 8 }}
      >
        <input
          data-testid="prompt"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something…"
          style={{ flex: 1, padding: 8, background: '#16181C', color: '#e6e6e6', border: '1px solid #333', borderRadius: 4 }}
        />
        <button type="submit" style={{ padding: '8px 16px', background: '#4C8DFF', color: '#0B0C0E', border: 0, borderRadius: 4, fontWeight: 700 }}>
          send
        </button>
      </form>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
