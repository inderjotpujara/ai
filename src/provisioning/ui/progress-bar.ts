import type { DownloadProgress } from '../types.ts';
import { renderProgressLine } from './format.ts';

/** Live progress renderer. TTY → \r line-rewrite; non-TTY → one line per update. */
export class ProgressBar {
  constructor(
    private readonly stream: NodeJS.WritableStream,
    private readonly isTty: boolean,
  ) {}

  render(p: DownloadProgress): void {
    const line = renderProgressLine(p);
    if (this.isTty) this.stream.write(`\r\x1b[2K${line}`);
    else this.stream.write(`${line}\n`);
  }

  done(p: DownloadProgress): void {
    const line = renderProgressLine(p);
    this.stream.write(this.isTty ? `\r\x1b[2K${line}\n` : `${line}\n`);
  }
}

/** Multi-row live progress renderer for bounded-parallel downloads — one row
 *  per in-flight model, keyed by `modelRef`. TTY-only: it repaints the whole
 *  block on every event by moving the cursor back up with ANSI cursor
 *  control, which only makes sense against a real terminal (see
 *  `runProvision`'s TTY gate, which is what picks this over `ProgressBar`). */
export class MultiProgressBar {
  private readonly rows = new Map<string, DownloadProgress>();
  private paintedRows = 0;

  constructor(private readonly stream: NodeJS.WritableStream) {}

  render(p: DownloadProgress): void {
    this.rows.set(p.modelRef, p);
    this.repaint();
  }

  done(p: DownloadProgress): void {
    this.rows.set(p.modelRef, p);
    this.repaint();
  }

  private repaint(): void {
    if (this.paintedRows > 0) this.stream.write(`\x1b[${this.paintedRows}A`);
    for (const p of this.rows.values()) {
      this.stream.write(`\x1b[2K${renderProgressLine(p)}\n`);
    }
    this.paintedRows = this.rows.size;
  }
}
