import type { ReactNode } from 'react';

type Role = 'user' | 'assistant';

/**
 * Layout for one chat message — aligned and tinted by role.
 * User messages sit right in an accent-tinted bubble; assistant left, plain.
 */
export function Message({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  const isUser = role === 'user';
  return (
    <div
      data-role={role}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-[var(--color-accent)]/15 text-[var(--color-fg)]'
            : 'bg-[var(--color-surface)] text-[var(--color-fg)]'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function MessageContent({ children }: { children: ReactNode }) {
  return <div className="font-mono">{children}</div>;
}
