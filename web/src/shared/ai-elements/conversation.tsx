import type { ReactNode } from 'react';

/**
 * Scrollable column that holds the message list.
 */
export function Conversation({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {children}
    </div>
  );
}
