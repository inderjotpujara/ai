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
