/**
 * launchd LaunchAgent plist template for the macOS "always-on" daemon
 * (Slice 24 Increment 4, Task 28). Renders the XML `agent daemon install`
 * (Task 29) writes to `~/Library/LaunchAgents/<label>.plist` and loads via
 * `launchctl`: `KeepAlive=true` restarts the daemon on crash, `RunAtLoad=true`
 * starts it at login, and `ProgramArguments` targets the same
 * `daemon start-foreground` entrypoint the CLI runs inline in the foreground.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** The repo's default launchd label, e.g. `io.acceldata.agent`. */
export function defaultLaunchdLabel(): string {
  return 'io.acceldata.agent';
}

/** Where `install` writes the plist: `~/Library/LaunchAgents/<label>.plist`. */
export function launchdPlistPath(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

/** Escape XML text-node specials so a path/arg can never break the plist. */
function xml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderLaunchdPlist(opts: {
  label: string;
  bunPath: string;
  entryScript: string;
  logDir: string;
  workingDir: string;
}): string {
  const args = [opts.bunPath, opts.entryScript, 'daemon', 'start-foreground'];
  const argXml = args.map((a) => `    <string>${xml(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(opts.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${xml(opts.workingDir)}</string>
  <key>StandardOutPath</key>
  <string>${xml(join(opts.logDir, 'agent.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(opts.logDir, 'agent.err.log'))}</string>
</dict>
</plist>
`;
}
