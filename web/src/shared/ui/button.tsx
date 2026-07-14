import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'accent';
};

export function Button({
  variant = 'default',
  className = '',
  ...rest
}: Props) {
  const accent = variant === 'accent';
  return (
    <button
      type="button"
      className={`rounded-md border border-[var(--color-border)] px-3 py-1.5 font-mono text-sm transition-colors ${
        accent
          ? 'bg-[var(--color-accent)] text-[var(--color-bg)]'
          : 'bg-[var(--color-surface)] text-[var(--color-fg)] hover:border-[var(--color-accent)]'
      } ${className}`}
      {...rest}
    />
  );
}
