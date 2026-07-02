import type { DownloadProgress } from '../types.ts';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(n: number): string {
  if (n <= 0) return '0 B';
  const i = Math.min(
    UNITS.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  const v = n / 1024 ** i;
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(1)} ${UNITS[i]}`;
}

export function formatSpeed(bps: number | null): string {
  if (bps === null || bps <= 0) return '—';
  return `${formatBytes(bps)}/s`;
}

export function formatEta(remainingBytes: number, bps: number | null): string {
  if (bps === null || bps <= 0) return '—';
  const secs = Math.round(remainingBytes / bps);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export function renderProgressLine(p: DownloadProgress): string {
  const pct =
    p.percent === null
      ? '  ?%'
      : `${Math.floor(p.percent).toString().padStart(3)}%`;
  const size =
    p.bytesTotal === null
      ? formatBytes(p.bytesCompleted)
      : `${formatBytes(p.bytesCompleted)}/${formatBytes(p.bytesTotal)}`;
  const remaining = p.bytesTotal === null ? 0 : p.bytesTotal - p.bytesCompleted;
  const eta =
    p.bytesTotal === null ? '—' : formatEta(remaining, p.speedBytesPerSec);
  return `${p.modelRef}  ${pct}  ${size}  ${formatSpeed(p.speedBytesPerSec)}  ETA ${eta}  [${p.phase}]`;
}
