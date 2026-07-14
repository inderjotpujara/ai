import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
};

export function Dialog({ open, onOpenChange, title, children }: Props) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 bg-[var(--color-backdrop)]" />
        <BaseDialog.Popup className="fixed left-1/2 top-24 w-[36rem] max-w-[90vw] -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xl">
          <BaseDialog.Title className="mb-2 font-mono text-xs uppercase tracking-wide text-[var(--color-muted)]">
            {title}
          </BaseDialog.Title>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
