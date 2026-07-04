import { expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCrewOrWorkflow } from '../../src/crew-builder/write.ts';

function paths(root: string) {
  mkdirSync(join(root, 'crews'));
  mkdirSync(join(root, 'workflows'));
  const ci = join(root, 'crews/index.ts');
  const wi = join(root, 'workflows/index.ts');
  const stub =
    'export const X = {\n  // CREW-BUILDER:ENTRIES\n};\n// CREW-BUILDER:IMPORTS\n';
  writeFileSync(ci, stub);
  writeFileSync(wi, stub);
  return {
    crewsDir: join(root, 'crews'),
    crewsIndexPath: ci,
    workflowsDir: join(root, 'workflows'),
    workflowsIndexPath: wi,
  };
}

test('writes a workflow file and registers it', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-'));
  try {
    const files = writeCrewOrWorkflow(
      'my_flow',
      'export default {};\n',
      'workflow',
      paths(root),
    );
    expect(files).toContain(join(root, 'workflows/my_flow.ts'));
    expect(readFileSync(join(root, 'workflows/my_flow.ts'), 'utf8')).toBe(
      'export default {};\n',
    );
    const idx = readFileSync(join(root, 'workflows/index.ts'), 'utf8');
    expect(idx).toContain("import myFlow from './my_flow.ts'");
    expect(idx).toContain('[myFlow.id]: myFlow,');
    // The crews side must be untouched by a workflow write.
    expect(readFileSync(join(root, 'crews/index.ts'), 'utf8')).not.toContain(
      'my_flow',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writes a crew file and registers it', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-'));
  try {
    const files = writeCrewOrWorkflow(
      'research_crew_2',
      'export default {};\n',
      'crew',
      paths(root),
    );
    expect(files).toContain(join(root, 'crews/research_crew_2.ts'));
    expect(readFileSync(join(root, 'crews/research_crew_2.ts'), 'utf8')).toBe(
      'export default {};\n',
    );
    const idx = readFileSync(join(root, 'crews/index.ts'), 'utf8');
    expect(idx).toContain("import researchCrew2 from './research_crew_2.ts'");
    expect(idx).toContain('[researchCrew2.id]: researchCrew2,');
    // The workflows side must be untouched by a crew write.
    expect(
      readFileSync(join(root, 'workflows/index.ts'), 'utf8'),
    ).not.toContain('research_crew_2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('throws (and writes nothing) when markers are missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-'));
  try {
    const p = paths(root);
    writeFileSync(p.workflowsIndexPath, 'export const X = {};\n'); // no markers
    expect(() =>
      writeCrewOrWorkflow('x', 'export default {};\n', 'workflow', p),
    ).toThrow();
    expect(existsSync(join(root, 'workflows/x.ts'))).toBe(false);
    // The index itself must be left exactly as it was — no partial rewrite.
    expect(readFileSync(p.workflowsIndexPath, 'utf8')).toBe(
      'export const X = {};\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('is idempotent — writing the same name twice does not double-insert', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-'));
  try {
    const p = paths(root);
    writeCrewOrWorkflow('my_flow', 'export default {};\n', 'workflow', p);
    writeCrewOrWorkflow('my_flow', 'export default {};\n', 'workflow', p);
    const idx = readFileSync(p.workflowsIndexPath, 'utf8');
    expect(idx.split("import myFlow from './my_flow.ts';").length - 1).toBe(1);
    expect(idx.split('[myFlow.id]: myFlow,').length - 1).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects invalid names before touching disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-'));
  try {
    const p = paths(root);
    expect(() =>
      writeCrewOrWorkflow('Bad-Name', 'export default {};\n', 'workflow', p),
    ).toThrow();
    expect(existsSync(join(root, 'workflows/Bad-Name.ts'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
