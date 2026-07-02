import { buildProvisionDeps, detectHost } from '../provisioning/cli-deps.ts';
import { runProvision } from '../provisioning/provisioner.ts';

async function main(): Promise<void> {
  const autoYes = process.env.AGENT_PROVISION_AUTO_YES === '1';
  const host = await detectHost();
  const result = await runProvision({
    autoYes,
    deps: buildProvisionDeps(host, { autoYes }),
  });
  console.error(
    `\nProvisioned: ${result.downloaded.length} · declined: ${result.declined.length} · failed: ${result.failed.length}`,
  );
  if (result.failed.length > 0) process.exitCode = 1;
}

await main();
