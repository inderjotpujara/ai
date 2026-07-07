import { describe, expect, it } from 'bun:test';
import {
  ffmpegCmd,
  resolveVoiceModel,
  voiceCacheDir,
} from '../../src/voice/model.ts';

describe('voice model resolution', () => {
  it('defaults the cache dir under ~/.cache/ai/voice', () => {
    expect(voiceCacheDir({})).toMatch(/\.cache\/ai\/voice$/);
  });
  it('AGENT_VOICE_DIR overrides the cache dir', () => {
    expect(voiceCacheDir({ AGENT_VOICE_DIR: '/tmp/v' })).toBe('/tmp/v');
  });
  it('resolveVoiceModel joins the default model name under the cache dir', () => {
    expect(resolveVoiceModel({ AGENT_VOICE_DIR: '/tmp/v' })).toBe(
      '/tmp/v/sherpa-onnx-moonshine-tiny-en-int8',
    );
  });
  it('AGENT_VOICE_STT_MODEL overrides the model dir absolutely', () => {
    expect(resolveVoiceModel({ AGENT_VOICE_STT_MODEL: '/models/base' })).toBe(
      '/models/base',
    );
  });
  it('ffmpegCmd honors AGENT_FFMPEG_CMD then falls back to ffmpeg', () => {
    expect(ffmpegCmd({ AGENT_FFMPEG_CMD: '/opt/ffmpeg' })).toBe('/opt/ffmpeg');
    expect(ffmpegCmd({})).toBe('ffmpeg');
  });
});
