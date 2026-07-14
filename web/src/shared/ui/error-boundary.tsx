import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { region: string; children: ReactNode };
type State = { error: Error | null };

export class RegionErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local-first: log to console; a telemetry sink lands in a later phase.
    console.error(`[region:${this.props.region}]`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="p-6 font-mono text-sm text-[var(--color-muted)]"
        >
          <strong className="text-[var(--color-fg)]">
            {this.props.region}
          </strong>{' '}
          failed to render. {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
