import { describe, expect, it } from 'bun:test';
import { ingestVoice } from '../../src/voice/ingest.ts';
import { VoiceError } from '../../src/voice/types.ts';

const flags = (over = {}) => ({
  images: [],
  audios: [],
  videos: [],
  paste: false,
  voice: false,
  voiceIn: [],
  ...over,
});
const okTranscriber = {
  transcribe: async () => 'hello there',
  close: async () => {},
};

describe('ingestVoice', () => {
  it('appends the file transcript to the prompt', async () => {
    const { prompt, warnings } = await ingestVoice(
      'context:',
      flags({ voiceIn: ['a.wav'] }),
      {
        captureFile: async () => ({
          samples: new Float32Array(10),
          sampleRate: 16000,
        }),
        captureMic: async () => ({
          samples: new Float32Array(0),
          sampleRate: 16000,
        }),
        transcriber: okTranscriber,
      },
    );
    expect(prompt).toContain('context:');
    expect(prompt).toContain('hello there');
    expect(warnings).toEqual([]);
  });
  it('degrades to a warning (no throw) when capture fails', async () => {
    const { prompt, warnings } = await ingestVoice(
      'base',
      flags({ voice: true }),
      {
        captureFile: async () => ({
          samples: new Float32Array(0),
          sampleRate: 16000,
        }),
        captureMic: async () => {
          throw new VoiceError('no mic', 'grant Microphone access');
        },
        transcriber: okTranscriber,
      },
    );
    expect(prompt).toBe('base');
    expect(warnings.join(' ')).toMatch(/grant Microphone access/);
  });
  it('returns the prompt unchanged when no voice flag is set', async () => {
    const { prompt } = await ingestVoice('base', flags(), {
      captureFile: async () => ({
        samples: new Float32Array(0),
        sampleRate: 16000,
      }),
      captureMic: async () => ({
        samples: new Float32Array(0),
        sampleRate: 16000,
      }),
      transcriber: okTranscriber,
    });
    expect(prompt).toBe('base');
  });
});
