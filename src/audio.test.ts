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
  DIARIZE_ENABLED: false,
  DIARIZE_BIN: '/tmp/test-venv/bin/python',
  DIARIZE_SCRIPT: '/tmp/scripts/diarize.py',
  DIARIZE_MIN_DURATION: 60,
  DIARIZE_TIMEOUT: 300_000,
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
  isVoiceMessage,
  processAudio,
  parseAudioReferences,
  parseWhisperTimestamp,
  formatTime,
  alignDiarization,
  transcribeWithTimestamps,
  diarize,
  transcribeWithDiarization,
} from './audio.js';
import type { TimestampedSegment, DiarizedSegment } from './audio.js';

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

    it('returns true for viewOnce wrapped voice notes', () => {
      const msg = {
        message: {
          viewOnceMessageV2: {
            message: { audioMessage: { ptt: true } },
          },
        },
      };
      expect(isVoiceMessage(msg as WAMessage)).toBe(true);
    });

    it('returns true for ephemeral wrapped voice notes', () => {
      const msg = {
        message: {
          ephemeralMessage: {
            message: { audioMessage: { ptt: true } },
          },
        },
      };
      expect(isVoiceMessage(msg as WAMessage)).toBe(true);
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

  describe('parseWhisperTimestamp', () => {
    it('parses HH:MM:SS.mmm format', () => {
      expect(parseWhisperTimestamp('00:00:05.000')).toBe(5);
      expect(parseWhisperTimestamp('00:01:30.500')).toBe(90.5);
      expect(parseWhisperTimestamp('01:05:00.000')).toBe(3900);
    });

    it('returns 0 for invalid format', () => {
      expect(parseWhisperTimestamp('invalid')).toBe(0);
      expect(parseWhisperTimestamp('')).toBe(0);
    });
  });

  describe('formatTime', () => {
    it('formats seconds as M:SS', () => {
      expect(formatTime(0)).toBe('0:00');
      expect(formatTime(5)).toBe('0:05');
      expect(formatTime(65)).toBe('1:05');
      expect(formatTime(600)).toBe('10:00');
    });

    it('formats with hours when needed', () => {
      expect(formatTime(3661)).toBe('1:01:01');
      expect(formatTime(7200)).toBe('2:00:00');
    });
  });

  describe('alignDiarization', () => {
    it('aligns single speaker correctly', () => {
      const whisper: TimestampedSegment[] = [
        { start: 0, end: 5, text: 'Hello world' },
        { start: 5, end: 10, text: 'How are you' },
      ];
      const speakers: DiarizedSegment[] = [
        { speaker: 'SPEAKER_00', start: 0, end: 10 },
      ];
      const result = alignDiarization(whisper, speakers);
      expect(result).toBe('Speaker 1 [0:00-0:10]: Hello world How are you');
    });

    it('aligns multi-speaker with clear boundaries', () => {
      const whisper: TimestampedSegment[] = [
        { start: 0, end: 5, text: 'I have a question.' },
        { start: 5, end: 10, text: 'Sure, go ahead.' },
        { start: 10, end: 15, text: 'What about the rate?' },
      ];
      const speakers: DiarizedSegment[] = [
        { speaker: 'SPEAKER_00', start: 0, end: 5 },
        { speaker: 'SPEAKER_01', start: 5, end: 10 },
        { speaker: 'SPEAKER_00', start: 10, end: 15 },
      ];
      const result = alignDiarization(whisper, speakers);
      expect(result).toContain('Speaker 1');
      expect(result).toContain('Speaker 2');
      expect(result).toContain('I have a question.');
      expect(result).toContain('Sure, go ahead.');
      expect(result).toContain('What about the rate?');
      // Should have 3 lines (speaker changes)
      expect(result.split('\n')).toHaveLength(3);
    });

    it('merges consecutive same-speaker segments', () => {
      const whisper: TimestampedSegment[] = [
        { start: 0, end: 3, text: 'Part one.' },
        { start: 3, end: 6, text: 'Part two.' },
        { start: 6, end: 9, text: 'Part three.' },
      ];
      const speakers: DiarizedSegment[] = [
        { speaker: 'SPEAKER_00', start: 0, end: 9 },
      ];
      const result = alignDiarization(whisper, speakers);
      expect(result).toBe(
        'Speaker 1 [0:00-0:09]: Part one. Part two. Part three.',
      );
    });

    it('returns flat text when no diarization segments', () => {
      const whisper: TimestampedSegment[] = [
        { start: 0, end: 5, text: 'Hello' },
        { start: 5, end: 10, text: 'World' },
      ];
      const result = alignDiarization(whisper, []);
      expect(result).toBe('Hello World');
    });

    it('returns empty string when no whisper segments', () => {
      const speakers: DiarizedSegment[] = [
        { speaker: 'SPEAKER_00', start: 0, end: 10 },
      ];
      expect(alignDiarization([], speakers)).toBe('');
    });

    it('labels speakers in order of appearance', () => {
      const whisper: TimestampedSegment[] = [
        { start: 0, end: 5, text: 'First.' },
        { start: 5, end: 10, text: 'Second.' },
      ];
      const speakers: DiarizedSegment[] = [
        { speaker: 'SPEAKER_02', start: 0, end: 5 },
        { speaker: 'SPEAKER_00', start: 5, end: 10 },
      ];
      const result = alignDiarization(whisper, speakers);
      // SPEAKER_02 appears first, gets "Speaker 1"
      expect(result).toContain('Speaker 1');
      expect(result).toContain('Speaker 2');
      expect(result.split('\n')[0]).toContain('Speaker 1');
      expect(result.split('\n')[0]).toContain('First.');
    });
  });

  describe('transcribeWithTimestamps', () => {
    it('parses whisper JSON output', async () => {
      const whisperJson = JSON.stringify({
        transcription: [
          {
            timestamps: { from: '00:00:00.000', to: '00:00:05.000' },
            text: ' Hello there.',
          },
          {
            timestamps: { from: '00:00:05.000', to: '00:00:10.000' },
            text: ' How are you?',
          },
        ],
      });
      // whisper-cli writes JSON to file
      vi.mocked(fs.readFileSync).mockReturnValueOnce(whisperJson);
      mockExecFile({ stdout: '' }); // whisper-cli run

      const result = await transcribeWithTimestamps('/tmp/test.wav');

      expect(result).toEqual([
        { start: 0, end: 5, text: 'Hello there.' },
        { start: 5, end: 10, text: 'How are you?' },
      ]);
    });

    it('returns null on whisper failure', async () => {
      mockExecFile({ error: new Error('whisper failed') });

      const result = await transcribeWithTimestamps('/tmp/test.wav');
      expect(result).toBeNull();
    });

    it('returns null on empty transcription', async () => {
      vi.mocked(fs.readFileSync).mockReturnValueOnce(
        JSON.stringify({ transcription: [] }),
      );
      mockExecFile({ stdout: '' });

      const result = await transcribeWithTimestamps('/tmp/test.wav');
      expect(result).toBeNull();
    });
  });

  describe('diarize', () => {
    it('parses diarization script output', async () => {
      const diarizeOutput = JSON.stringify({
        segments: [
          { speaker: 'SPEAKER_00', start: 0.0, end: 45.3 },
          { speaker: 'SPEAKER_01', start: 45.3, end: 80.1 },
        ],
      });
      mockExecFile({ stdout: diarizeOutput });

      const result = await diarize('/tmp/test.wav');

      expect(result).toEqual([
        { speaker: 'SPEAKER_00', start: 0.0, end: 45.3 },
        { speaker: 'SPEAKER_01', start: 45.3, end: 80.1 },
      ]);
    });

    it('returns null on script failure', async () => {
      mockExecFile({ error: new Error('script not found') });

      const result = await diarize('/tmp/test.wav');
      expect(result).toBeNull();
    });

    it('returns null on malformed JSON', async () => {
      mockExecFile({ stdout: 'not json' });

      const result = await diarize('/tmp/test.wav');
      expect(result).toBeNull();
    });

    it('returns null when segments is not an array', async () => {
      mockExecFile({ stdout: JSON.stringify({ segments: 'invalid' }) });

      const result = await diarize('/tmp/test.wav');
      expect(result).toBeNull();
    });
  });

  describe('transcribeWithDiarization', () => {
    it('returns flat transcript when audio is too short', async () => {
      // ffmpeg conversion
      mockExecFile(
        { stdout: '' },
        // ffprobe duration
        {
          stdout: JSON.stringify({
            format: { duration: '30' },
          }),
        },
        // flat whisper
        { stdout: 'Short audio content' },
      );

      const result = await transcribeWithDiarization('/tmp/short.ogg');
      expect(result).toBe('Short audio content');
    });

    it('returns null when ffmpeg fails', async () => {
      mockExecFile({ error: new Error('ffmpeg failed') });

      const result = await transcribeWithDiarization('/tmp/test.ogg');
      expect(result).toBeNull();
    });
  });
});
