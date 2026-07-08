import { APP_VERSION } from '../version.ts';

function main() {
  if (process.argv.includes('--version')) {
    process.stdout.write(`${APP_VERSION}\n`);
    return;
  }
  process.stdout.write(
    `agent-framework ${APP_VERSION}\nWeb UI starts here in Slice 30b. For now use: bun run src/cli/chat.ts "<task>"\n`,
  );
}

if (import.meta.main) main();
