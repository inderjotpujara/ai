import { expect, test } from 'bun:test';
import { mfluxStrategy } from '../../src/media/generate/image-mflux.ts';

test('mflux args carry prompt, output, and default ungated schnell mirror model', () => {
  const savedImageModel = process.env.AGENT_IMAGE_MODEL;
  delete process.env.AGENT_IMAGE_MODEL;

  try {
    const buildOneShot = mfluxStrategy.buildOneShot;
    if (!buildOneShot) {
      throw new Error('buildOneShot must be defined');
    }
    const spec = buildOneShot('a fox', '/out.png', {});
    expect(spec.cmd).toBe('mflux-generate');
    expect(spec.args).toContain('--prompt');
    expect(spec.args[spec.args.indexOf('--prompt') + 1]).toBe('a fox');
    expect(spec.args[spec.args.indexOf('--output') + 1]).toBe('/out.png');
    expect(spec.args[spec.args.indexOf('--model') + 1]).toBe(
      'dhairyashil/FLUX.1-schnell-mflux-4bit',
    );
    expect(spec.args).toContain('--base-model');
    expect(spec.args[spec.args.indexOf('--base-model') + 1]).toBe('schnell');
    expect(spec.args).not.toContain('-q');
  } finally {
    if (savedImageModel === undefined) delete process.env.AGENT_IMAGE_MODEL;
    else process.env.AGENT_IMAGE_MODEL = savedImageModel;
  }
});
