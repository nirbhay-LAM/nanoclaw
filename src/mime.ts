import path from 'path';

const MIME_MAP: Record<string, string> = {
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.zip': 'application/zip',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
};

/** Returns the MIME type for a filename based on its extension. */
export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

/** MIME types that should be saved as document attachments from messaging channels. */
export const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'text/csv',
  'text/plain',
  'application/json',
  'application/zip',
]);

/** Check if a MIME type is a recognized document type worth saving. */
export function isDocumentMime(mime: string): boolean {
  return DOCUMENT_MIME_TYPES.has(mime);
}

/** MIME types recognized as audio for transcription. */
export const AUDIO_MIME_TYPES = new Set([
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/aac',
  'audio/ogg',
  'audio/opus',
]);

/** Check if a MIME type is a recognized audio type. */
export function isAudioMime(mime: string): boolean {
  return AUDIO_MIME_TYPES.has(mime);
}
