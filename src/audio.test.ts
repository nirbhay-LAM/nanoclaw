import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WAMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import { execFile } from 'child_process';

vi.mock('fs');
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('./config.js', () => ({
  WHISPER_BIN: '/opt/homebrew/bin/whisper-cli',
  WHISPER_MODEL: '/tmp/test-model.bin',
}));
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { isVoiceMessage, processAudio, parseAudioReferences } from './audio.js';

// Helper to mock execFile as a callback-based function
function mockExecFile(...results: Array<{ stdout?: string; error?: Error }>) {
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

describe('audio processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
  });

  describe('isVoiceMessage', () => {
    it('returns true for push-to-talk voice notes', () => {
      const msg = { message: { audioMessage: { ptt: true } } };
      expect(isVoiceMessage(msg as WAMessage)).toBe(true);
    });

    it('returns false for non-ptt audio', () => {
      const msg = { message: { audioMessage: { ptt: false } } };
      expect(isVoiceMessage(msg as WAMessage)).toBe(false);
    });

    it('returns false for text messages', () => {
      const msg = { message: { conversation: 'hello' } };
      expect(isVoiceMessage(msg as WAMessage)).toBe(false);
    });

    it('returns false for null message', () => {
      const msg = { message: null };
      expect(isVoiceMessage(msg as WAMessage)).toBe(false);
    });
  });

  describe('processAudio', () => {
    it('transcribes a voice note', async () => {
      // ffmpeg conversion succeeds, whisper returns transcript
      mockExecFile(
        { stdout: '' }, // ffmpeg
        { stdout: '  Hello, this is a test.  ' }, // whisper
      );

      const buffer = Buffer.from('fake-ogg-data');
      const result = await processAudio(buffer, '/tmp/groups/test', true);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('[Voice Note: Hello, this is a test.]');
      expect(result!.relativePath).toMatch(
        /^attachments\/voice-\d+-[a-z0-9]+\.ogg$/,
      );
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('voice-'),
        buffer,
      );
    });

    it('transcribes an audio document with filename', async () => {
      mockExecFile(
        { stdout: '' }, // ffmpeg
        { stdout: 'Meeting notes from today' }, // whisper
      );

      const buffer = Buffer.from('fake-m4a-data');
      const result = await processAudio(
        buffer,
        '/tmp/groups/test',
        false,
        'meeting.m4a',
      );

      expect(result).not.toBeNull();
      expect(result!.content).toMatch(
        /\[Audio: attachments\/meeting\.m4a \(\d+KB\)\]\nTranscript: Meeting notes from today/,
      );
      expect(result!.relativePath).toBe('attachments/meeting.m4a');
    });

    it('returns null on empty buffer', async () => {
      const result = await processAudio(
        Buffer.alloc(0),
        '/tmp/groups/test',
        true,
      );
      expect(result).toBeNull();
    });

    it('falls back gracefully when ffmpeg fails', async () => {
      mockExecFile({ error: new Error('ffmpeg not found') });

      const buffer = Buffer.from('fake-audio');
      const result = await processAudio(buffer, '/tmp/groups/test', true);

      expect(result).not.toBeNull();
      expect(result!.content).toBe(
        '[Voice Note: audio received, transcription unavailable]',
      );
      // File should still be saved
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('falls back gracefully when whisper fails', async () => {
      mockExecFile(
        { stdout: '' }, // ffmpeg succeeds
        { error: new Error('whisper-cli not found') }, // whisper fails
      );

      const buffer = Buffer.from('fake-audio');
      const result = await processAudio(
        buffer,
        '/tmp/groups/test',
        false,
        'recording.mp3',
      );

      expect(result).not.toBeNull();
      // Audio file reference still present, just no transcript
      expect(result!.content).toMatch(
        /\[Audio: attachments\/recording\.mp3 \(\d+KB\)\]$/,
      );
      expect(result!.content).not.toContain('Transcript:');
    });

    it('cleans up temp WAV file', async () => {
      mockExecFile({ stdout: '' }, { stdout: 'some text' });

      await processAudio(Buffer.from('data'), '/tmp/groups/test', true);

      // unlinkSync called to clean up temp WAV
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('nanoclaw-'),
      );
    });
  });

  describe('parseAudioReferences', () => {
    it('extracts audio paths from content', () => {
      const messages = [
        {
          content:
            '[Audio: attachments/meeting.m4a (150KB)]\nTranscript: hello',
        },
        { content: 'plain text' },
        { content: '[Audio: attachments/voice-123.ogg (50KB)]' },
      ];
      const refs = parseAudioReferences(messages);

      expect(refs).toEqual([
        { relativePath: 'attachments/meeting.m4a', mediaType: 'audio/ogg' },
        { relativePath: 'attachments/voice-123.ogg', mediaType: 'audio/ogg' },
      ]);
    });

    it('returns empty array when no audio', () => {
      const messages = [{ content: 'just text' }];
      expect(parseAudioReferences(messages)).toEqual([]);
    });
  });
});
