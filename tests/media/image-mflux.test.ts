import { expect, test } from 'bun:test';
import { mfluxStrategy } from '../../src/media/generate/image-mflux.ts';

test('mflux args carry prompt, output, and default ungated schnell mirror model', () => {
  const savedImageModel = process.env.AGENT_IMAGE_MODEL;
  const savedBaseModel = process.env.AGENT_IMAGE_BASE_MODEL;
  const savedImageCmd = process.env.AGENT_IMAGE_CMD;
  const savedMediaVenv = process.env.AGENT_MEDIA_VENV;
  delete process.env.AGENT_IMAGE_MODEL;
  delete process.env.AGENT_IMAGE_BASE_MODEL;
  delete process.env.AGENT_IMAGE_CMD;
  // Force the venv-resolution fallback path (bare tool name) so the cmd
  // assertion is deterministic regardless of whether a media venv actually
  // exists on the machine running the suite.
  process.env.AGENT_MEDIA_VENV = '/nonexistent-media-venv-for-tests';

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
    if (savedBaseModel === undefined) delete process.env.AGENT_IMAGE_BASE_MODEL;
    else process.env.AGENT_IMAGE_BASE_MODEL = savedBaseModel;
    if (savedImageCmd === undefined) delete process.env.AGENT_IMAGE_CMD;
    else process.env.AGENT_IMAGE_CMD = savedImageCmd;
    if (savedMediaVenv === undefined) delete process.env.AGENT_MEDIA_VENV;
    else process.env.AGENT_MEDIA_VENV = savedMediaVenv;
  }
});

test('mflux --base-model reflects AGENT_IMAGE_BASE_MODEL when set', () => {
  const savedImageModel = process.env.AGENT_IMAGE_MODEL;
  const savedBaseModel = process.env.AGENT_IMAGE_BASE_MODEL;
  process.env.AGENT_IMAGE_MODEL = 'black-forest-labs/FLUX.1-dev';
  process.env.AGENT_IMAGE_BASE_MODEL = 'dev';

  try {
    const buildOneShot = mfluxStrategy.buildOneShot;
    if (!buildOneShot) {
      throw new Error('buildOneShot must be defined');
    }
    const spec = buildOneShot('a fox', '/out.png', {});
    expect(spec.args[spec.args.indexOf('--model') + 1]).toBe(
      'black-forest-labs/FLUX.1-dev',
    );
    expect(spec.args[spec.args.indexOf('--base-model') + 1]).toBe('dev');
  } finally {
    if (savedImageModel === undefined) delete process.env.AGENT_IMAGE_MODEL;
    else process.env.AGENT_IMAGE_MODEL = savedImageModel;
    if (savedBaseModel === undefined) delete process.env.AGENT_IMAGE_BASE_MODEL;
    else process.env.AGENT_IMAGE_BASE_MODEL = savedBaseModel;
  }
});
