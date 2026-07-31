import { execFile as execFileCb } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';

import { logger } from './logger.js';

const execFile = promisify(execFileCb);

const DRAW_THINGS_BIN = '/opt/homebrew/bin/draw-things-cli';
const DEFAULT_MODEL = 'flux_2_klein_4b_q6p.ckpt';
const GENERATE_TIMEOUT = 180_000; // 3 minutes

/**
 * Generate an image using Draw Things CLI (local Flux model).
 * Returns the output file path on success, or null on failure.
 */
export async function generateImage(
  prompt: string,
  size: string,
  _quality: string,
  outputPath: string,
): Promise<string | null> {
  if (!fs.existsSync(DRAW_THINGS_BIN)) {
    logger.warn('draw-things-cli not found, cannot generate image');
    return null;
  }

  // Parse size string (e.g., "1024x1024") into width and height
  const [widthStr, heightStr] = size.split('x');
  const width = parseInt(widthStr, 10) || 1024;
  const height = parseInt(heightStr, 10) || 1024;

  try {
    const dir = outputPath.substring(0, outputPath.lastIndexOf('/'));
    if (dir) fs.mkdirSync(dir, { recursive: true });

    await execFile(
      DRAW_THINGS_BIN,
      [
        'generate',
        '--model',
        DEFAULT_MODEL,
        '--prompt',
        prompt,
        '--width',
        String(width),
        '--height',
        String(height),
        '-o',
        outputPath,
        '--disable-preview',
      ],
      { timeout: GENERATE_TIMEOUT },
    );

    if (!fs.existsSync(outputPath)) {
      logger.warn('Draw Things CLI did not produce output file');
      return null;
    }

    const sizeKB = Math.round(fs.statSync(outputPath).size / 1024);
    logger.info(
      { outputPath, width, height, sizeKB },
      'Image generated successfully',
    );
    return outputPath;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Image generation failed',
    );
    return null;
  }
}
