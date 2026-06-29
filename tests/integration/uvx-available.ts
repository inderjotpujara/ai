/** True iff `uvx mcp-server-fetch` can start (probes with --help, killed on timeout). */
export async function uvxReady(timeoutMs = 15000): Promise<boolean> {
  try {
    const proc = Bun.spawn(['uvx', 'mcp-server-fetch', '--help'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const code = await proc.exited;
    clearTimeout(timer);
    return code === 0;
  } catch {
    return false;
  }
}
