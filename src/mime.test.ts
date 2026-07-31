import { describe, it, expect } from 'vitest';
import { getMimeType, isDocumentMime } from './mime.js';

describe('getMimeType', () => {
  it('returns correct MIME for Office formats', () => {
    expect(getMimeType('report.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(getMimeType('slides.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(getMimeType('data.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('returns correct MIME for legacy Office formats', () => {
    expect(getMimeType('letter.doc')).toBe('application/msword');
    expect(getMimeType('deck.ppt')).toBe('application/vnd.ms-powerpoint');
    expect(getMimeType('budget.xls')).toBe('application/vnd.ms-excel');
    expect(getMimeType('memo.rtf')).toBe('application/rtf');
  });

  it('returns correct MIME for common types', () => {
    expect(getMimeType('doc.pdf')).toBe('application/pdf');
    expect(getMimeType('data.csv')).toBe('text/csv');
    expect(getMimeType('readme.txt')).toBe('text/plain');
    expect(getMimeType('config.json')).toBe('application/json');
    expect(getMimeType('photo.png')).toBe('image/png');
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
  });

  it('is case-insensitive for extensions', () => {
    expect(getMimeType('REPORT.DOCX')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(getMimeType('data.CSV')).toBe('text/csv');
    expect(getMimeType('LETTER.DOC')).toBe('application/msword');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('archive.tar.gz')).toBe('application/octet-stream');
  });

  it('recognizes legacy Office MIME types as documents', () => {
    expect(isDocumentMime('application/msword')).toBe(true);
    expect(isDocumentMime('application/vnd.ms-powerpoint')).toBe(true);
    expect(isDocumentMime('application/vnd.ms-excel')).toBe(true);
    expect(isDocumentMime('application/rtf')).toBe(true);
  });

  it('handles files with paths', () => {
    expect(getMimeType('/workspace/group/files/report.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
});
