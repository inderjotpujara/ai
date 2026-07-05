import { expect, test } from 'bun:test';
import { mfluxStrategy } from '../../src/media/generate/image-mflux.ts';

test('mflux args carry prompt, output, and default schnell model', () => {
  const buildOneShot = mfluxStrategy.buildOneShot;
  if (!buildOneShot) {
    throw new Error('buildOneShot must be defined');
  }
  const spec = buildOneShot('a fox', '/out.png', {});
  expect(spec.cmd).toBe('mflux-generate');
  expect(spec.args).toContain('--prompt');
  expect(spec.args[spec.args.indexOf('--prompt') + 1]).toBe('a fox');
  expect(spec.args[spec.args.indexOf('--output') + 1]).toBe('/out.png');
  expect(spec.args[spec.args.indexOf('--model') + 1]).toBe('schnell');
});
