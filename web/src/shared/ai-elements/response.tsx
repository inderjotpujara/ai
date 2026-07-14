import { Streamdown } from 'streamdown';

type Props = {
  children: string;
  className?: string;
};

/**
 * Streaming-markdown renderer for assistant text. Wraps `streamdown`, which
 * safely parses incomplete markdown mid-stream. Styled with our design tokens.
 */
export function Response({ children, className = '' }: Props) {
  return (
    <div
      className={`text-sm leading-relaxed text-[var(--color-fg)] [&_a]:text-[var(--color-accent)] [&_code]:font-mono [&_pre]:overflow-x-auto ${className}`}
    >
      <Streamdown parseIncompleteMarkdown>{children}</Streamdown>
    </div>
  );
}
