import { expect, test } from 'bun:test';
import {
  defaultLaunchdLabel,
  launchdPlistPath,
  renderLaunchdPlist,
} from '../../src/daemon/launchd.ts';

const opts = {
  label: 'io.acceldata.agent',
  bunPath: '/opt/homebrew/bin/bun',
  entryScript: '/Users/me/ai/src/cli/daemon.ts',
  logDir: '/Users/me/.agent/logs',
  workingDir: '/Users/me/ai',
};

test('renderLaunchdPlist emits KeepAlive + RunAtLoad + program args + log paths', () => {
  const plist = renderLaunchdPlist(opts);
  expect(plist.startsWith('<?xml')).toBe(true);
  expect(plist).toContain('<plist version="1.0">');
  expect(plist).toContain('<key>KeepAlive</key>');
  expect(plist).toContain('<key>RunAtLoad</key>');
  expect(plist).toContain('<true/>');
  expect(plist).toContain(opts.bunPath);
  expect(plist).toContain(opts.entryScript);
  expect(plist).toContain('start-foreground');
  expect(plist).toContain('/Users/me/.agent/logs/agent.out.log');
  expect(plist).toContain('/Users/me/.agent/logs/agent.err.log');
});

test('an XML-special value is escaped', () => {
  const plist = renderLaunchdPlist({ ...opts, workingDir: '/tmp/a & b' });
  expect(plist).toContain('/tmp/a &amp; b');
});

test('launchdPlistPath is under ~/Library/LaunchAgents', () => {
  expect(launchdPlistPath(defaultLaunchdLabel())).toMatch(
    /Library\/LaunchAgents\/io\.acceldata\.agent\.plist$/,
  );
});
