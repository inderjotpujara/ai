import { runDiscovery } from '../discovery/discover.ts';

async function main(): Promise<void> {
  console.error(
    'Discovering models from Hugging Face (this needs internet)...',
  );
  try {
    const r = await runDiscovery();
    console.error(
      `Found ${r.found} candidate(s), ${r.fits} fit the budget. ` +
        `Pre-pulled: ${r.pulled.length ? r.pulled.join(', ') : 'none'}. Catalog: ${r.path}`,
    );
    for (const f of r.pullFailed) {
      console.error(`failed-to-pull: ${f.model}: ${f.reason}`);
    }
  } catch (err) {
    console.error(
      `Discovery failed (using any existing catalog): ${(err as Error).message}`,
    );
    process.exitCode = 1;
  }
}
main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
