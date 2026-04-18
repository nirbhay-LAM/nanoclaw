import { execFile as execFileCb } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { normalizeMessageContent } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';

import { WHISPER_BIN, WHISPER_MODEL } from './config.js';
import { logger } from './logger.js';

const execFile = promisify(execFileCb);

const FFMPEG_TIMEOUT = 30_000;
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

  // Attempt transcription
  const transcript = await transcribe(filePath);

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
      ['-m', WHISPER_MODEL, '-f', tmpWav, '--no-timestamps', '-l', 'en'],
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
