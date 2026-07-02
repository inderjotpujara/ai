import type { PackEntry } from './types.ts';

/** The curated starter pack (2026-07 verified: only maintained servers; the
 *  official sqlite/postgres/brave/puppeteer/github packages were archived in
 *  2025 and must not be emitted). This is the palette the agent-builder
 *  (Phase D) suggests from — keep capabilities accurate. */
export const STARTER_PACK: PackEntry[] = [
  {
    name: 'file-tools',
    description: 'In-repo read_file server (this framework).',
    capabilities: ['files'],
    server: {
      command: 'bun',
      args: ['run', 'src/mcp/server.ts'],
      agents: ['file_qa'],
    },
  },
  {
    name: 'sqlite',
    description: 'In-repo SQLite server on bun:sqlite (query/execute/schema).',
    capabilities: ['sql'],
    server: {
      command: 'bun',
      args: ['run', 'src/mcp/sqlite-server.ts', 'data/agent.db'],
    },
  },
  {
    name: 'filesystem',
    description: 'Official filesystem server (scoped to listed directories).',
    capabilities: ['files'],
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    },
  },
  {
    name: 'memory',
    description: 'Official knowledge-graph memory server.',
    capabilities: ['memory'],
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
  },
  {
    name: 'sequential-thinking',
    description: 'Official structured step-by-step reasoning server.',
    capabilities: ['reasoning'],
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
  },
  {
    name: 'fetch',
    description: 'Official web-fetch server (keyless; requires uvx).',
    capabilities: ['http'],
    server: {
      command: 'uvx',
      args: ['mcp-server-fetch'],
      agents: ['web_fetch'],
    },
  },
  {
    name: 'git',
    description: 'Official git server (log/diff/status on local repos).',
    capabilities: ['vcs'],
    server: { command: 'uvx', args: ['mcp-server-git'] },
  },
  {
    name: 'time',
    description: 'Official time/timezone server.',
    capabilities: ['time'],
    server: { command: 'uvx', args: ['mcp-server-time'] },
  },
  {
    name: 'playwright',
    description:
      'Microsoft Playwright browser automation (downloads browsers on first run).',
    capabilities: ['browser'],
    server: { command: 'npx', args: ['@playwright/mcp@latest'] },
  },
  {
    name: 'github',
    description:
      "GitHub's official remote server (Streamable HTTP; needs a PAT).",
    capabilities: ['vcs'],
    requiresEnv: ['GITHUB_PAT'],
    server: {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: dormancy handles unset ${VAR}
      headers: { Authorization: 'Bearer ${GITHUB_PAT}' },
    },
  },
  {
    name: 'brave-search',
    description: "Brave's official web-search server (needs BRAVE_API_KEY).",
    capabilities: ['web-search'],
    requiresEnv: ['BRAVE_API_KEY'],
    server: {
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server'],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: dormancy handles unset ${VAR}
      env: { BRAVE_API_KEY: '${BRAVE_API_KEY}' },
    },
  },
  {
    name: 'exa-search',
    description: 'Exa semantic web-search server (needs EXA_API_KEY).',
    capabilities: ['web-search'],
    requiresEnv: ['EXA_API_KEY'],
    server: {
      command: 'npx',
      args: ['-y', 'exa-mcp-server'],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: dormancy handles unset ${VAR}
      env: { EXA_API_KEY: '${EXA_API_KEY}' },
    },
  },
];

export function getPackEntry(name: string): PackEntry | undefined {
  return STARTER_PACK.find((e) => e.name === name);
}

export function packByCapability(cap: string): PackEntry[] {
  return STARTER_PACK.filter((e) => e.capabilities.includes(cap));
}
