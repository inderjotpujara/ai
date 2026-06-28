import { readFile } from 'node:fs/promises';
import { tool } from 'ai';
import { z } from 'zod';

/** Pure helper: read a UTF-8 file's contents. */
export function readFileText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

/**
 * The `read_file` tool. On failure it RETURNS an error object (rather than
 * throwing) so the model sees it as a tool result and can recover.
 */
export const readFileTool = tool({
  description: 'Read a UTF-8 text file from disk and return its contents.',
  inputSchema: z.object({
    path: z.string().describe('Absolute or relative path to the file to read'),
  }),
  execute: async ({ path }) => {
    try {
      return { text: await readFileText(path) };
    } catch (cause) {
      return { error: `Could not read ${path}: ${(cause as Error).message}` };
    }
  },
});
