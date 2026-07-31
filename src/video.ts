import { execFile as execFileCb } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { normalizeMessageContent } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';

import { transcribe, transcribeWithDiarization } from './audio.js';
import { DIARIZE_ENABLED, WHISPER_BIN } from './config.js';
import { logger } from './logger.js';

const execFile = promisify(execFileCb);

const FFMPEG_TIMEOUT = 60_000;
const FFPROBE_TIMEOUT = 15_000;
const MAX_FRAMES = 30;
const DEFAULT_FPS = 1;
const MAX_FRAME_DIMENSION = 1024;

const VIDEO_REF_PATTERN = /\[Video: (attachments\/[^\s)]+)/g;

export interface ProcessedVideo {
  content: string;
  relativePath: string;
  frameCount: number;
  duration: number;
  transcript: string | null;
}

export interface VideoAttachment {
  relativePath: string;
  mediaType: string;
  framePaths: string[];
}

/** True for WhatsApp video messages (handles viewOnce/ephemeral wrappers). */
export function isVideoMessage(msg: WAMessage): boolean {
  const content = normalizeMessageContent(msg.message);
  return !!content?.videoMessage;
}

/** Get video metadata using ffprobe. */
async function getVideoMetadata(
  filePath: string,
): Promise<{ duration: number; width: number; height: number } | null> {
  try {
    const { stdout } = await execFile(
      'ffprobe',
      [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { timeout: FFPROBE_TIMEOUT },
    );
    const data = JSON.parse(stdout);
    const videoStream = data.streams?.find(
      (s: { codec_type: string }) => s.codec_type === 'video',
    );
    return {
      duration: parseFloat(data.format?.duration || '0'),
      width: parseInt(videoStream?.width || '0', 10),
      height: parseInt(videoStream?.height || '0', 10),
    };
  } catch (err) {
    logger.warn({ err }, 'ffprobe failed');
    return null;
  }
}

/**
 * Process a video buffer: save original, extract key frames for Claude vision.
 * Returns null on empty buffer. Falls back gracefully if ffmpeg/ffprobe unavailable.
 */
export async function processVideo(
  buffer: Buffer,
  groupDir: string,
  caption: string,
  fps: number = DEFAULT_FPS,
): Promise<ProcessedVideo | null> {
  if (!buffer || buffer.length === 0) return null;

  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6);
  const videoDir = `vid-${timestamp}-${random}`;
  const attachDir = path.join(groupDir, 'attachments');
  const fullVideoDir = path.join(attachDir, videoDir);
  fs.mkdirSync(fullVideoDir, { recursive: true });

  // Save original video
  const videoFilename = `${videoDir}.mp4`;
  const videoPath = path.join(attachDir, videoFilename);
  fs.writeFileSync(videoPath, buffer);
  const sizeKB = Math.round(buffer.length / 1024);

  // Get metadata
  const meta = await getVideoMetadata(videoPath);
  const duration = meta?.duration || 0;
  const durationStr = duration > 0 ? `${Math.round(duration)}s` : 'unknown';

  // Calculate how many frames to extract
  let frameCount = 0;
  if (meta && duration > 0) {
    const totalFrames = Math.ceil(duration * fps);
    frameCount = Math.min(totalFrames, MAX_FRAMES);
  }

  // Extract frames
  const framePaths: string[] = [];
  if (frameCount > 0) {
    try {
      // Adjust FPS if we'd exceed MAX_FRAMES
      const effectiveFps =
        Math.ceil(duration * fps) > MAX_FRAMES ? MAX_FRAMES / duration : fps;

      await execFile(
        'ffmpeg',
        [
          '-i',
          videoPath,
          '-vf',
          `fps=${effectiveFps},scale='min(${MAX_FRAME_DIMENSION},iw)':'min(${MAX_FRAME_DIMENSION},ih)':force_original_aspect_ratio=decrease`,
          '-q:v',
          '3',
          '-frames:v',
          String(MAX_FRAMES),
          path.join(fullVideoDir, 'frame_%04d.jpg'),
        ],
        { timeout: FFMPEG_TIMEOUT },
      );

      // Collect extracted frame paths
      const files = fs.readdirSync(fullVideoDir).sort();
      for (const file of files) {
        if (file.startsWith('frame_') && file.endsWith('.jpg')) {
          framePaths.push(`attachments/${videoDir}/${file}`);
        }
      }
      frameCount = framePaths.length;

      logger.info(
        { videoDir, frameCount, duration: durationStr, sizeKB },
        'Video frames extracted',
      );
    } catch (err) {
      logger.warn({ err }, 'Video frame extraction failed');
      frameCount = 0;
    }
  }

  // Transcribe audio track if whisper is configured
  let transcript: string | null = null;
  if (WHISPER_BIN) {
    try {
      transcript = DIARIZE_ENABLED
        ? await transcribeWithDiarization(videoPath)
        : await transcribe(videoPath);
      if (transcript) {
        logger.info({ videoDir }, 'Video audio transcribed');
      }
    } catch (err) {
      logger.warn({ err }, 'Video audio transcription failed');
    }
  }

  // Save metadata
  const metadata = {
    originalFile: videoFilename,
    duration,
    width: meta?.width || 0,
    height: meta?.height || 0,
    frameCount,
    fps: fps,
    sizeKB,
    transcript,
    extractedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(fullVideoDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
  );

  const relativePath = `attachments/${videoFilename}`;
  const frameInfo = frameCount > 0 ? `, ${frameCount} frames extracted` : '';
  let content = caption
    ? `[Video: ${relativePath} (${durationStr}, ${sizeKB}KB${frameInfo})] ${caption}`
    : `[Video: ${relativePath} (${durationStr}, ${sizeKB}KB${frameInfo})]`;

  if (transcript) {
    content += `\nAudio transcript: ${transcript}`;
  }

  return { content, relativePath, frameCount, duration, transcript };
}

/** Parse video references from message content. */
export function parseVideoReferences(
  messages: Array<{ content: string }>,
): VideoAttachment[] {
  const refs: VideoAttachment[] = [];
  for (const msg of messages) {
    let match: RegExpExecArray | null;
    VIDEO_REF_PATTERN.lastIndex = 0;
    while ((match = VIDEO_REF_PATTERN.exec(msg.content)) !== null) {
      const videoPath = match[1];
      // Derive frame directory from video filename
      const baseName = path.basename(videoPath, path.extname(videoPath));
      const frameDir = path.join(path.dirname(videoPath), baseName);

      // Collect frame paths if the directory exists
      const framePaths: string[] = [];
      // Note: actual frame collection happens at the container-runner level
      // where the group directory is known

      refs.push({
        relativePath: videoPath,
        mediaType: 'video/mp4',
        framePaths,
      });
    }
  }
  return refs;
}
