/**
 * Convert a release markdown file to .docx
 * Usage: node scripts/release-to-docx.mjs <markdown-file> <output-dir>
 */
import fs from 'fs';
import path from 'path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
} from 'docx';

const mdFile = process.argv[2];
const outputDir = process.argv[3] || path.join(process.env.HOME, 'Documents', 'releases');

if (!mdFile) {
  console.error('Usage: node scripts/release-to-docx.mjs <markdown-file> [output-dir]');
  process.exit(1);
}

const md = fs.readFileSync(mdFile, 'utf-8');
const lines = md.split('\n');
const children = [];

let i = 0;
while (i < lines.length) {
  const line = lines[i];

  // Headings
  if (line.startsWith('# ')) {
    children.push(new Paragraph({
      text: line.slice(2),
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
    }));
    i++;
    continue;
  }
  if (line.startsWith('## ')) {
    children.push(new Paragraph({
      text: line.slice(3),
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 150 },
    }));
    i++;
    continue;
  }
  if (line.startsWith('### ')) {
    children.push(new Paragraph({
      text: line.slice(4),
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 },
    }));
    i++;
    continue;
  }

  // Tables
  if (line.includes('|') && line.trim().startsWith('|')) {
    const tableLines = [];
    while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
      const cells = lines[i].split('|').filter(c => c.trim()).map(c => c.trim());
      // Skip separator rows (---|---)
      if (!cells.every(c => /^[-:]+$/.test(c))) {
        tableLines.push(cells);
      }
      i++;
    }
    if (tableLines.length > 0) {
      const rows = tableLines.map((cells, rowIdx) =>
        new TableRow({
          children: cells.map(cell =>
            new TableCell({
              children: [new Paragraph({
                children: [new TextRun({
                  text: cell,
                  bold: rowIdx === 0,
                  size: 20,
                })],
              })],
              width: { size: Math.floor(100 / cells.length), type: WidthType.PERCENTAGE },
            })
          ),
        })
      );
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1 },
          bottom: { style: BorderStyle.SINGLE, size: 1 },
          left: { style: BorderStyle.SINGLE, size: 1 },
          right: { style: BorderStyle.SINGLE, size: 1 },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
          insideVertical: { style: BorderStyle.SINGLE, size: 1 },
        },
      }));
      children.push(new Paragraph({ text: '' }));
    }
    continue;
  }

  // Bullet points
  if (line.startsWith('- ')) {
    const text = line.slice(2);
    const runs = parseInlineFormatting(text);
    children.push(new Paragraph({
      children: runs,
      bullet: { level: 0 },
      spacing: { after: 60 },
    }));
    i++;
    continue;
  }

  // Sub-bullets
  if (line.startsWith('  - ')) {
    const text = line.slice(4);
    const runs = parseInlineFormatting(text);
    children.push(new Paragraph({
      children: runs,
      bullet: { level: 1 },
      spacing: { after: 40 },
    }));
    i++;
    continue;
  }

  // Bold key-value lines (like **Date:** 2026-03-22)
  if (line.startsWith('**') && line.includes(':**')) {
    const runs = parseInlineFormatting(line);
    children.push(new Paragraph({
      children: runs,
      spacing: { after: 60 },
    }));
    i++;
    continue;
  }

  // Empty lines
  if (line.trim() === '') {
    i++;
    continue;
  }

  // Regular paragraphs
  const runs = parseInlineFormatting(line);
  children.push(new Paragraph({
    children: runs,
    spacing: { after: 120 },
  }));
  i++;
}

function parseInlineFormatting(text) {
  const runs = [];
  const regex = /\*\*(.+?)\*\*|`(.+?)`|(.+?)(?=\*\*|`|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      runs.push(new TextRun({ text: match[1], bold: true, size: 22 }));
    } else if (match[2]) {
      runs.push(new TextRun({ text: match[2], font: 'Courier New', size: 20 }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], size: 22 }));
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text, size: 22 })];
}

const doc = new Document({
  sections: [{
    properties: {
      page: {
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children,
  }],
});

const basename = path.basename(mdFile, '.md');
const outputPath = path.join(outputDir, `${basename}.docx`);
const buffer = await Packer.toBuffer(doc);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, buffer);
console.log(`Created: ${outputPath}`);
