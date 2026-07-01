export function verifyModel(): string {
  return process.env.AGENT_VERIFY_MODEL?.trim() || 'bespoke-minicheck';
}
export function verifyThreshold(): number {
  const r = Number(process.env.AGENT_VERIFY_THRESHOLD);
  return r > 0 && r <= 1 ? r : 0.9;
}
export function verifyMaxRetries(): number {
  const r = Number(process.env.AGENT_VERIFY_MAX_RETRIES);
  return Number.isInteger(r) && r >= 0 ? r : 1;
}
export function verifyEnabled(): boolean {
  return process.env.AGENT_VERIFY_ENABLED !== '0';
}
export function autoPullPolicy(): 'prompt' | 'always' | 'never' {
  const v = process.env.AGENT_VERIFY_AUTO_PULL;
  if (v === '1') return 'always';
  if (v === '0') return 'never';
  return 'prompt';
}
