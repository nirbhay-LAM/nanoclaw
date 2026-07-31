import { execFile as execFileCb } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { normalizeMessageContent } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';

import {
  DIARIZE_BIN,
  DIARIZE_ENABLED,
  DIARIZE_MIN_DURATION,
  DIARIZE_SCRIPT,
  DIARIZE_TIMEOUT,
  WHISPER_BIN,
  WHISPER_MODEL,
} from './config.js';
import { logger } from './logger.js';

const execFile = promisify(execFileCb);

const FFMPEG_TIMEOUT = 30_000;
const FFPROBE_TIMEOUT = 10_000;
const WHISPER_TIMEOUT = 60_000;

const VOICE_REF_PATTERN = /\[Voice Note: ([^\]]+)\]/g;
const AUDIO_REF_PATTERN = /\[Audio: (attachments\/[^\s)]+)/g;

export interface ProcessedAudio {
  content: string;
  relativePath: string;
}

export interface AudioAttachment {
  relativePath: string;
  mediaType: string;
}

/** True for WhatsApp push-to-talk voice notes. */
export function isVoiceMessage(msg: WAMessage): boolean {
  const content = normalizeMessageContent(msg.message);
  return content?.audioMessage?.ptt === true;
}

/**
 * Process an audio buffer: save to attachments, transcribe with whisper.
 * Returns null on empty buffer. Falls back gracefully if ffmpeg/whisper unavailable.
 */
export async function processAudio(
  buffer: Buffer,
  groupDir: string,
  isVoiceNote: boolean,
  originalFilename?: string,
): Promise<ProcessedAudio | null> {
  if (!buffer || buffer.length === 0) return null;

  // Save original audio file
  const attachDir = path.join(groupDir, 'attachments');
  fs.mkdirSync(attachDir, { recursive: true });

  const rand = Math.random().toString(36).slice(2, 6);
  const filename = isVoiceNote
    ? `voice-${Date.now()}-${rand}.ogg`
    : path.basename(originalFilename || `audio-${Date.now()}-${rand}.m4a`);
  const filePath = path.join(attachDir, filename);
  fs.writeFileSync(filePath, buffer);

  const relativePath = `attachments/${filename}`;
  const sizeKB = Math.round(buffer.length / 1024);

  // Attempt transcription (with diarization for non-voice-note audio when enabled)
  const transcript =
    !isVoiceNote && DIARIZE_ENABLED
      ? await transcribeWithDiarization(filePath)
      : await transcribe(filePath);

  if (isVoiceNote) {
    const content = transcript
      ? `[Voice Note: ${transcript}]`
      : `[Voice Note: audio received, transcription unavailable]`;
    return { content, relativePath };
  }

  let content = `[Audio: ${relativePath} (${sizeKB}KB)]`;
  if (transcript) {
    content += `\nTranscript: ${transcript}`;
  }
  return { content, relativePath };
}

/**
 * Transcribe an audio file using ffmpeg + whisper-cli.
 * Returns the transcript text, or null on failure.
 */
export async function transcribe(audioPath: string): Promise<string | null> {
  const tmpId = crypto.randomUUID();
  const tmpWav = path.join(os.tmpdir(), `nanoclaw-${tmpId}.wav`);

  try {
    // Convert to 16kHz mono WAV
    await execFile(
      'ffmpeg',
      [
        '-i',
        audioPath,
        '-ar',
        '16000',
        '-ac',
        '1',
        '-f',
        'wav',
        tmpWav,
        '-y',
        '-loglevel',
        'error',
      ],
      { timeout: FFMPEG_TIMEOUT },
    );

    // Run whisper
    const { stdout } = await execFile(
      WHISPER_BIN,
      ['-m', WHISPER_MODEL, '-f', tmpWav, '--no-timestamps', '-l', 'auto'],
      { timeout: WHISPER_TIMEOUT },
    );

    const text = stdout.trim();
    if (!text) {
      logger.warn('Whisper returned empty transcript');
      return null;
    }

    return text;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Audio transcription failed',
    );
    return null;
  } finally {
    try {
      fs.unlinkSync(tmpWav);
    } catch {
      // tmp file may not exist if ffmpeg failed
    }
  }
}

export interface TimestampedSegment {
  start: number;
  end: number;
  text: string;
}

export interface DiarizedSegment {
  speaker: string;
  start: number;
  end: number;
}

/** Get audio duration in seconds using ffprobe. */
export async function getAudioDuration(
  audioPath: string,
): Promise<number | null> {
  try {
    const { stdout } = await execFile(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', audioPath],
      { timeout: FFPROBE_TIMEOUT },
    );
    const data = JSON.parse(stdout);
    return parseFloat(data.format?.duration || '0');
  } catch {
    return null;
  }
}

/**
 * Run whisper with JSON output to get timestamped segments.
 * Returns null on failure.
 */
export async function transcribeWithTimestamps(
  wavPath: string,
): Promise<TimestampedSegment[] | null> {
  const tmpId = crypto.randomUUID();
  const jsonBase = path.join(os.tmpdir(), `nanoclaw-ts-${tmpId}`);

  try {
    await execFile(
      WHISPER_BIN,
      [
        '-m',
        WHISPER_MODEL,
        '-f',
        wavPath,
        '-l',
        'auto',
        '--output-json-full',
        '-of',
        jsonBase,
      ],
      { timeout: WHISPER_TIMEOUT },
    );

    const jsonPath = `${jsonBase}.json`;
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    fs.unlinkSync(jsonPath);

    const data = JSON.parse(raw);
    const segments: TimestampedSegment[] = [];

    for (const seg of data.transcription || []) {
      const text = (seg.text || '').trim();
      if (!text) continue;

      // Timestamps from whisper JSON are in "HH:MM:SS.mmm" format
      const start = parseWhisperTimestamp(
        seg.timestamps?.from || '00:00:00.000',
      );
      const end = parseWhisperTimestamp(seg.timestamps?.to || '00:00:00.000');
      segments.push({ start, end, text });
    }

    return segments.length > 0 ? segments : null;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Timestamped transcription failed',
    );
    return null;
  }
}

/** Parse whisper timestamp "HH:MM:SS.mmm" to seconds. */
export function parseWhisperTimestamp(ts: string): number {
  const parts = ts.split(':');
  if (parts.length !== 3) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Run pyannote diarization script.
 * Returns speaker segments or null on failure.
 */
export async function diarize(
  wavPath: string,
): Promise<DiarizedSegment[] | null> {
  try {
    const { stdout } = await execFile(DIARIZE_BIN, [DIARIZE_SCRIPT, wavPath], {
      timeout: DIARIZE_TIMEOUT,
      env: { ...process.env },
    });

    const data = JSON.parse(stdout);
    if (!Array.isArray(data.segments)) return null;

    return data.segments as DiarizedSegment[];
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Speaker diarization failed',
    );
    return null;
  }
}

/**
 * Align whisper timestamped segments with pyannote speaker segments.
 * Assigns each whisper segment to the speaker with the most temporal overlap.
 * Merges consecutive segments from the same speaker.
 */
export function alignDiarization(
  whisperSegments: TimestampedSegment[],
  diarizeSegments: DiarizedSegment[],
): string {
  if (whisperSegments.length === 0) return '';
  if (diarizeSegments.length === 0) {
    return whisperSegments.map((s) => s.text).join(' ');
  }

  // Assign unique sequential labels to speakers in order of appearance
  const speakerLabels = new Map<string, string>();
  let speakerCount = 0;
  for (const seg of diarizeSegments) {
    if (!speakerLabels.has(seg.speaker)) {
      speakerCount++;
      speakerLabels.set(seg.speaker, `Speaker ${speakerCount}`);
    }
  }

  // For each whisper segment, find the best-matching speaker
  interface LabeledSegment {
    speaker: string;
    start: number;
    end: number;
    text: string;
  }

  const labeled: LabeledSegment[] = whisperSegments.map((ws) => {
    let bestSpeaker = 'Unknown';
    let bestOverlap = 0;

    for (const ds of diarizeSegments) {
      const overlapStart = Math.max(ws.start, ds.start);
      const overlapEnd = Math.min(ws.end, ds.end);
      const overlap = Math.max(0, overlapEnd - overlapStart);

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = speakerLabels.get(ds.speaker) || ds.speaker;
      }
    }

    return {
      speaker: bestSpeaker,
      start: ws.start,
      end: ws.end,
      text: ws.text,
    };
  });

  // Merge consecutive segments from the same speaker
  const merged: LabeledSegment[] = [];
  for (const seg of labeled) {
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker === seg.speaker) {
      prev.end = seg.end;
      prev.text += ' ' + seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  // Format output
  return merged
    .map(
      (s) =>
        `${s.speaker} [${formatTime(s.start)}-${formatTime(s.end)}]: ${s.text}`,
    )
    .join('\n');
}

/** Format seconds as M:SS or H:MM:SS. */
export function formatTime(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Transcribe audio with speaker diarization.
 * Runs whisper (timestamps) and pyannote (speakers) in parallel, then merges.
 * Falls back to flat transcription on any failure.
 */
export async function transcribeWithDiarization(
  audioPath: string,
): Promise<string | null> {
  const tmpId = crypto.randomUUID();
  const tmpWav = path.join(os.tmpdir(), `nanoclaw-${tmpId}.wav`);

  try {
    // Convert to 16kHz mono WAV
    await execFile(
      'ffmpeg',
      [
        '-i',
        audioPath,
        '-ar',
        '16000',
        '-ac',
        '1',
        '-f',
        'wav',
        tmpWav,
        '-y',
        '-loglevel',
        'error',
      ],
      { timeout: FFMPEG_TIMEOUT },
    );

    // Check duration — skip diarization for short audio
    const duration = await getAudioDuration(tmpWav);
    if (duration !== null && duration < DIARIZE_MIN_DURATION) {
      logger.info(
        { duration, threshold: DIARIZE_MIN_DURATION },
        'Audio too short for diarization, using flat transcription',
      );
      // Use flat whisper transcription
      const { stdout } = await execFile(
        WHISPER_BIN,
        ['-m', WHISPER_MODEL, '-f', tmpWav, '--no-timestamps', '-l', 'auto'],
        { timeout: WHISPER_TIMEOUT },
      );
      return stdout.trim() || null;
    }

    // Run whisper + pyannote in parallel
    const [whisperResult, diarizeResult] = await Promise.all([
      transcribeWithTimestamps(tmpWav),
      diarize(tmpWav),
    ]);

    // If whisper failed entirely, nothing to return
    if (!whisperResult) return null;

    // If diarization failed, return flat text
    if (!diarizeResult || diarizeResult.length === 0) {
      logger.info('Diarization unavailable, returning flat transcript');
      return whisperResult.map((s) => s.text).join(' ');
    }

    return alignDiarization(whisperResult, diarizeResult);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Diarized transcription failed',
    );
    return null;
  } finally {
    try {
      fs.unlinkSync(tmpWav);
    } catch {
      // tmp file may not exist if ffmpeg failed
    }
  }
}

/** Extract audio references from message content strings. */
export function parseAudioReferences(
  messages: Array<{ content: string }>,
): AudioAttachment[] {
  const refs: AudioAttachment[] = [];
  for (const msg of messages) {
    AUDIO_REF_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = AUDIO_REF_PATTERN.exec(msg.content)) !== null) {
      refs.push({ relativePath: match[1], mediaType: 'audio/ogg' });
    }
  }
  return refs;
}
