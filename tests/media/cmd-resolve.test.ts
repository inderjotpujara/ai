import { expect, test } from 'bun:test';
import { MediaVenv, resolveMediaCmd } from '../../src/media/cmd-resolve.ts';

test('returns the venv binary path when it exists', () => {
  const saved = process.env.AGENT_MEDIA_VENV;
  process.env.AGENT_MEDIA_VENV = '/fake/media-venv';
  try {
    const result = resolveMediaCmd('mlx_whisper', MediaVenv.Media, {
      exists: (p) => p === '/fake/media-venv/bin/mlx_whisper',
    });
    expect(result).toBe('/fake/media-venv/bin/mlx_whisper');
  } finally {
    if (saved === undefined) delete process.env.AGENT_MEDIA_VENV;
    else process.env.AGENT_MEDIA_VENV = saved;
  }
});

test('falls back to the bare tool name when the venv binary is absent', () => {
  const saved = process.env.AGENT_MEDIA_VENV;
  process.env.AGENT_MEDIA_VENV = '/fake/media-venv';
  try {
    const result = resolveMediaCmd('mlx_whisper', MediaVenv.Media, {
      exists: () => false,
    });
    expect(result).toBe('mlx_whisper');
  } finally {
    if (saved === undefined) delete process.env.AGENT_MEDIA_VENV;
    else process.env.AGENT_MEDIA_VENV = saved;
  }
});

test('AGENT_MEDIA_VENV override is honored for the media venv', () => {
  const saved = process.env.AGENT_MEDIA_VENV;
  process.env.AGENT_MEDIA_VENV = '/custom/media-venv';
  try {
    const result = resolveMediaCmd('mflux-generate', MediaVenv.Media, {
      exists: (p) => p === '/custom/media-venv/bin/mflux-generate',
    });
    expect(result).toBe('/custom/media-venv/bin/mflux-generate');
  } finally {
    if (saved === undefined) delete process.env.AGENT_MEDIA_VENV;
    else process.env.AGENT_MEDIA_VENV = saved;
  }
});

test('AGENT_MEDIA_VIDEO_VENV override is honored for the video venv', () => {
  const saved = process.env.AGENT_MEDIA_VIDEO_VENV;
  process.env.AGENT_MEDIA_VIDEO_VENV = '/custom/video-venv';
  try {
    const result = resolveMediaCmd(
      'mlx_video.ltx_2.generate',
      MediaVenv.Video,
      {
        exists: (p) => p === '/custom/video-venv/bin/mlx_video.ltx_2.generate',
      },
    );
    expect(result).toBe('/custom/video-venv/bin/mlx_video.ltx_2.generate');
  } finally {
    if (saved === undefined) delete process.env.AGENT_MEDIA_VIDEO_VENV;
    else process.env.AGENT_MEDIA_VIDEO_VENV = saved;
  }
});

test('media and video venvs resolve independently (different env vars)', () => {
  const savedMedia = process.env.AGENT_MEDIA_VENV;
  const savedVideo = process.env.AGENT_MEDIA_VIDEO_VENV;
  process.env.AGENT_MEDIA_VENV = '/m';
  process.env.AGENT_MEDIA_VIDEO_VENV = '/v';
  try {
    const exists = (p: string) => p === '/m/bin/tool' || p === '/v/bin/tool';
    expect(resolveMediaCmd('tool', MediaVenv.Media, { exists })).toBe(
      '/m/bin/tool',
    );
    expect(resolveMediaCmd('tool', MediaVenv.Video, { exists })).toBe(
      '/v/bin/tool',
    );
  } finally {
    if (savedMedia === undefined) delete process.env.AGENT_MEDIA_VENV;
    else process.env.AGENT_MEDIA_VENV = savedMedia;
    if (savedVideo === undefined) delete process.env.AGENT_MEDIA_VIDEO_VENV;
    else process.env.AGENT_MEDIA_VIDEO_VENV = savedVideo;
  }
});
