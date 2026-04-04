import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WAMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import { execFile } from 'child_process';

vi.mock('fs');
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  isVideoMessage,
  processVideo,
  parseVideoReferences,
} from './video.js';

function mockExecFile(
  ...results: Array<{ stdout?: string; error?: Error }>
) {
  const mock = vi.mocked(execFile);
  for (const result of results) {
    mock.mockImplementationOnce(((
      _cmd: string,
      _args: unknown,
      _opts: unknown,
      cb: unknown,
    ) => {
      const callback = cb as (
        err: Error | null,
        result: { stdout: string; stderr: string },
      ) => void;
      if (result.error) {
        callback(result.error, { stdout: '', stderr: '' });
      } else {
        callback(null, { stdout: result.stdout || '', stderr: '' });
      }
    }) as typeof execFile);
  }
}

describe('video processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  describe('isVideoMessage', () => {
    it('returns true for video messages', () => {
      const msg = { message: { videoMessage: { mimetype: 'video/mp4' } } };
      expect(isVideoMessage(msg as WAMessage)).toBe(true);
    });

    it('returns false for non-video messages', () => {
      const msg = { message: { conversation: 'hello' } };
      expect(isVideoMessage(msg as WAMessage)).toBe(false);
    });

    it('returns false for null message', () => {
      const msg = { message: null };
      expect(isVideoMessage(msg as WAMessage)).toBe(false);
    });

    it('returns true for viewOnce wrapped video messages', () => {
      const msg = {
        message: {
          viewOnceMessageV2: {
            message: { videoMessage: { mimetype: 'video/mp4' } },
          },
        },
      };
      expect(isVideoMessage(msg as WAMessage)).toBe(true);
    });

    it('returns true for ephemeral wrapped video messages', () => {
      const msg = {
        message: {
          ephemeralMessage: {
            message: { videoMessage: { mimetype: 'video/mp4' } },
          },
        },
      };
      expect(isVideoMessage(msg as WAMessage)).toBe(true);
    });
  });

  describe('processVideo', () => {
    it('saves video and extracts frames', async () => {
      // Mock ffprobe
      mockExecFile({
        stdout: JSON.stringify({
          format: { duration: '10.5' },
          streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
        }),
      });
      // Mock ffmpeg frame extraction
      mockExecFile({ stdout: '' });
      // Mock readdirSync for frame files
      vi.mocked(fs.readdirSync).mockReturnValue([
        'frame_0001.jpg',
        'frame_0002.jpg',
        'frame_0003.jpg',
      ] as any);

      const buffer = Buffer.from('fake-video-data');
      const result = await processVideo(
        buffer,
        '/tmp/groups/test',
        'Check this',
      );

      expect(result).not.toBeNull();
      expect(result!.content).toMatch(
        /^\[Video: attachments\/vid-\d+-[a-z0-9]+\.mp4 \(\d+s, \d+KB, 3 frames extracted\)\] Check this$/,
      );
      expect(result!.frameCount).toBe(3);
      expect(result!.duration).toBe(10.5);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('returns null on empty buffer', async () => {
      const result = await processVideo(
        Buffer.alloc(0),
        '/tmp/groups/test',
        '',
      );
      expect(result).toBeNull();
    });

    it('falls back gracefully when ffprobe fails', async () => {
      mockExecFile({ error: new Error('ffprobe not found') });

      const buffer = Buffer.from('fake-video-data');
      const result = await processVideo(buffer, '/tmp/groups/test', '');

      expect(result).not.toBeNull();
      expect(result!.content).toMatch(/\[Video: attachments\/vid-.*\.mp4/);
      expect(result!.frameCount).toBe(0);
    });

    it('returns content without caption when none provided', async () => {
      mockExecFile({ error: new Error('ffprobe not found') });

      const buffer = Buffer.from('fake-video-data');
      const result = await processVideo(buffer, '/tmp/groups/test', '');

      expect(result).not.toBeNull();
      expect(result!.content).toMatch(
        /^\[Video: attachments\/vid-.*\.mp4 \(unknown, \d+KB\)\]$/,
      );
    });
  });

  describe('parseVideoReferences', () => {
    it('extracts video paths from message content', () => {
      const messages = [
        {
          content:
            '[Video: attachments/vid-123.mp4 (10s, 500KB, 10 frames)] hello',
        },
        { content: 'plain text' },
        { content: '[Video: attachments/vid-456.mp4 (5s, 200KB)]' },
      ];
      const refs = parseVideoReferences(messages);

      expect(refs).toHaveLength(2);
      expect(refs[0].relativePath).toBe('attachments/vid-123.mp4');
      expect(refs[0].mediaType).toBe('video/mp4');
      expect(refs[1].relativePath).toBe('attachments/vid-456.mp4');
    });

    it('returns empty array when no videos', () => {
      const messages = [{ content: 'just text' }];
      expect(parseVideoReferences(messages)).toEqual([]);
    });
  });
});
