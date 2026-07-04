import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CrewProcess } from '../../src/crew/types.ts';
import type { CrewIR, WorkflowIR } from '../../src/crew-builder/ir.ts';
import { transpile } from '../../src/crew-builder/transpile.ts';

/** Generated files use `'../src/...'` relative imports (they normally live
 *  directly under `crews/`/`workflows/` at repo root — depth 1), so the temp
 *  file must be a direct child of that directory, not `os.tmpdir()` (whose
 *  relative imports won't resolve) and not an `mkdtempSync`-style
 *  subdirectory of `workflows/`/`crews/` (that's depth 2, one `../` hop too
 *  deep — `mkdtempSync(join(cwd, 'workflows', '.tmp-'))` was tried and fails
 *  with "Cannot find module '../src/workflow/define.ts'" for exactly this
 *  reason). So we write a uniquely-named file straight into `workflows/` /
 *  `crews/` and remove just that file afterward. */
test('generated workflow source imports + defines without throwing', async () => {
  const ir: WorkflowIR = {
    id: 'ct',
    steps: [
      { kind: 'tool', id: 'f', tool: 'fetch', input: { kind: 'fromInput' } },
      {
        kind: 'agent',
        id: 'a',
        agent: 'web_fetch',
        dependsOn: ['f'],
        input: { kind: 'fromStep', ref: 'f' },
      },
    ],
  };
  const file = join(process.cwd(), 'workflows', `.tmp-${randomUUID()}.ts`);
  try {
    writeFileSync(file, transpile(ir, 'workflow'));
    const mod = await import(file);
    expect(mod.default.id).toBe('ct');
    expect(mod.default.steps.length).toBe(2);
  } finally {
    rmSync(file, { force: true });
  }
});

test('generated crew source imports + defines without throwing', async () => {
  const ir: CrewIR = {
    id: 'ct_crew',
    process: CrewProcess.Sequential,
    members: [
      {
        name: 'researcher',
        role: 'r',
        goal: 'g',
        backstory: 'b',
        requires: ['tools'],
      },
      {
        name: 'writer',
        role: 'r2',
        goal: 'g2',
        backstory: 'b2',
        requires: ['tools'],
      },
    ],
    tasks: [
      {
        id: 'gather',
        description: 'd',
        expectedOutput: 'o',
        member: 'researcher',
      },
      {
        id: 'write',
        description: 'd2',
        expectedOutput: 'o2',
        member: 'writer',
        dependsOn: ['gather'],
      },
    ],
  };
  const file = join(process.cwd(), 'crews', `.tmp-${randomUUID()}.ts`);
  try {
    writeFileSync(file, transpile(ir, 'crew'));
    const mod = await import(file);
    expect(mod.default.id).toBe('ct_crew');
    expect(mod.default.members.length).toBe(2);
  } finally {
    rmSync(file, { force: true });
  }
});
