---
name: office-docs
description: Create Microsoft Office documents (Word, PowerPoint, Excel) using Node.js libraries. Use when the user asks you to create, generate, or write a document, presentation, spreadsheet, report, or similar.
---

# Office Document Creation

Create `.docx`, `.pptx`, and `.xlsx` files using globally installed Node.js libraries. Write a script, run it with Bash, and the file appears in `/workspace/group/files/`.

**Always create files in `/workspace/group/files/`** — this directory is mounted to the host and accessible for delivery via WhatsApp or email.

```bash
mkdir -p /workspace/group/files
```

## Word Documents (.docx)

Library: `docx` — [docs](https://docx.js.org/)

```javascript
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } from 'docx';
import fs from 'fs';

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      new Paragraph({
        text: "Document Title",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Bold text", bold: true }),
          new TextRun(" and normal text."),
        ],
      }),
      // Table
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph("Header 1")] }),
              new TableCell({ children: [new Paragraph("Header 2")] }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph("Value 1")] }),
              new TableCell({ children: [new Paragraph("Value 2")] }),
            ],
          }),
        ],
      }),
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync('/workspace/group/files/document.docx', buffer);
console.log('Created document.docx');
```

Save as `.mjs` and run with `node script.mjs`.

## PowerPoint Presentations (.pptx)

Library: `pptxgenjs` — [docs](https://gitbrent.github.io/PptxGenJS/)

```javascript
import PptxGenJS from 'pptxgenjs';
import fs from 'fs';

const pptx = new PptxGenJS();

// Title slide
const slide1 = pptx.addSlide();
slide1.addText('Presentation Title', {
  x: 0.5, y: 1.5, w: 9, h: 1.5,
  fontSize: 36, bold: true, align: 'center', color: '363636',
});
slide1.addText('Subtitle or date', {
  x: 0.5, y: 3, w: 9, h: 1,
  fontSize: 18, align: 'center', color: '666666',
});

// Content slide
const slide2 = pptx.addSlide();
slide2.addText('Key Points', {
  x: 0.5, y: 0.5, w: 9, h: 0.8,
  fontSize: 24, bold: true, color: '363636',
});
slide2.addText([
  { text: '• First point\n', options: { fontSize: 16, breakLine: true } },
  { text: '• Second point\n', options: { fontSize: 16, breakLine: true } },
  { text: '• Third point', options: { fontSize: 16 } },
], { x: 0.5, y: 1.5, w: 9, h: 3 });

// Table slide
const slide3 = pptx.addSlide();
slide3.addText('Data Overview', {
  x: 0.5, y: 0.5, w: 9, h: 0.8,
  fontSize: 24, bold: true,
});
slide3.addTable(
  [
    [{ text: 'Metric', options: { bold: true } }, { text: 'Value', options: { bold: true } }],
    ['Revenue', '$1.2M'],
    ['Growth', '15%'],
  ],
  { x: 0.5, y: 1.5, w: 9, colW: [4.5, 4.5], border: { type: 'solid', pt: 1 } }
);

const data = await pptx.write({ outputType: 'nodebuffer' });
fs.writeFileSync('/workspace/group/files/presentation.pptx', data);
console.log('Created presentation.pptx');
```

## Excel Spreadsheets (.xlsx)

Library: `exceljs` — [docs](https://github.com/exceljs/exceljs)

**IMPORTANT:** Always use the formatting functions below. Copy them into your script verbatim. Do NOT improvise colors or formatting. Read `/workspace/group/formatting-standards.md` for the full spec, and use this code to implement it.

```javascript
import ExcelJS from 'exceljs';

// ============================================================
// FORMATTING CONSTANTS — DO NOT CHANGE THESE VALUES
// ============================================================

const COLORS = {
  // Headers
  headerBg: 'FF1B4F72',       // Navy
  headerText: 'FFFFFFFF',     // White
  headerBgSecondary: 'FF2C3E50', // Dark Blue (secondary sheets)
  headerBgScript: 'FF6C3483',    // Purple (script sheets)
  headerBgArchive: 'FF922B21',   // Red (archive/recycle sheets)

  // Row shading
  rowWhite: 'FFFFFFFF',
  rowGray: 'FFF2F3F4',

  // Borders
  border: 'FFD5D8DC',
  headerBorder: 'FF1B4F72',

  // Status cell fills
  statusPosted: 'FFD5F5E3',     statusPostedText: 'FF1E8449',
  statusDraft: 'FFFEF9E7',      statusDraftText: 'FFB7950B',
  statusNotPosted: 'FFFADBD8',  statusNotPostedText: 'FFCB4335',
  statusPending: 'FFD6EAF8',    statusPendingText: 'FF2E86C1',

  // Content type fills (Column D or similar)
  ctCommunity: 'FFFDEDEC',      // Community / Holiday — light pink
  ctDrNeha: 'FFE8DAEF',         // Dr. Neha On-Camera — light purple
  ctPromo: 'FFF5B7B1',          // Promo / Offer — pink
  ctBTS: 'FFD5F5E3',            // Behind the Scenes — light green
  ctEducational: 'FFFAE5D3',    // Educational — light orange
  ctService: 'FFD4EFDF',        // Service Spotlight — lime
  ctSocialProof: 'FFFDEBD0',    // Social Proof / B&A — peach
  ctMeetTeam: 'FFD1F2EB',       // Meet the Team — light teal
  ctTransformation: 'FFFEF9E7', // Transformation — light yellow

  // Platform column highlights
  platformLinkedIn: 'FFD6EAF8',  // Light blue
  platformTikTok: 'FFD5F5E3',   // Light green
  platformTwitter: 'FFEAEDED',  // Light gray
};

const CONTENT_TYPE_MAP = {
  'community / holiday': COLORS.ctCommunity,
  'dr. neha on-camera': COLORS.ctDrNeha,
  'promo / offer': COLORS.ctPromo,
  'behind the scenes': COLORS.ctBTS,
  'educational carousel': COLORS.ctEducational,
  'educational / bts reel': COLORS.ctBTS,
  'service spotlight': COLORS.ctService,
  'social proof / b&a': COLORS.ctSocialProof,
  'meet the team': COLORS.ctMeetTeam,
  'transformation': COLORS.ctTransformation,
};

const thinBorder = {
  top: { style: 'thin', color: { argb: COLORS.border } },
  left: { style: 'thin', color: { argb: COLORS.border } },
  bottom: { style: 'thin', color: { argb: COLORS.border } },
  right: { style: 'thin', color: { argb: COLORS.border } },
};

// ============================================================
// FORMATTING FUNCTIONS — COPY THESE INTO EVERY SCRIPT
// ============================================================

/** Apply header styling: navy fill, white bold, freeze, auto-filter */
function applyHeaders(sheet, headerColor = COLORS.headerBg) {
  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: COLORS.headerText }, name: 'Arial' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      ...thinBorder,
      bottom: { style: 'medium', color: { argb: headerColor } },
    };
  });
  // Freeze top row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  // Auto-filter
  if (sheet.lastRow) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.lastRow.number, column: sheet.lastColumn.number } };
  }
}

/** Apply row formatting: alternating shading, borders, font, status-based coloring */
function applyRowFormatting(sheet, statusColKey) {
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header

    const isOdd = rowNum % 2 === 1;
    const baseFill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: isOdd ? COLORS.rowWhite : COLORS.rowGray },
    };

    // Check status value
    const statusCell = statusColKey ? row.getCell(statusColKey) : null;
    const status = statusCell ? String(statusCell.value || '').toLowerCase().trim() : '';

    // Determine if this is a "problem" row (entire row goes red)
    const isProblemRow = status.includes('not posted') || status.includes('skipped') || status.includes('blocked');

    row.eachCell({ includeEmpty: true }, (cell) => {
      // Font
      cell.font = { size: 10, name: 'Arial', color: { argb: 'FF222222' } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = thinBorder;

      // Row fill: problem rows get full red, others get alternating
      if (isProblemRow) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.statusNotPosted } };
        cell.font = { size: 10, name: 'Arial', color: { argb: COLORS.statusNotPostedText } };
      } else {
        cell.fill = baseFill;
      }
    });

    // Status cell always gets its own color (on top of row fill)
    if (statusCell && status) {
      if (status.includes('posted') && !status.includes('not')) {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.statusPosted } };
        statusCell.font = { size: 10, name: 'Arial', bold: true, color: { argb: COLORS.statusPostedText } };
      } else if (status.includes('draft') || status.includes('progress')) {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.statusDraft } };
        statusCell.font = { size: 10, name: 'Arial', bold: true, color: { argb: COLORS.statusDraftText } };
      } else if (isProblemRow) {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.statusNotPosted } };
        statusCell.font = { size: 10, name: 'Arial', bold: true, color: { argb: COLORS.statusNotPostedText } };
      } else if (status.includes('pending') || status.includes('scheduled')) {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.statusPending } };
        statusCell.font = { size: 10, name: 'Arial', bold: true, color: { argb: COLORS.statusPendingText } };
      }
    }
  });
}

/** Apply content type colors to a specific column */
function applyContentTypeColors(sheet, colKey) {
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const cell = row.getCell(colKey);
    const val = String(cell.value || '').toLowerCase().trim();
    for (const [type, color] of Object.entries(CONTENT_TYPE_MAP)) {
      if (val.includes(type) || type.includes(val)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        break;
      }
    }
  });
}

/** Apply platform column highlights */
function applyColumnHighlight(sheet, colKey, colorArgb) {
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const cell = row.getCell(colKey);
    // Only apply if the row isn't a problem row (red overrides)
    const statusVal = String(row.getCell('status')?.value || '').toLowerCase();
    if (!statusVal.includes('not posted') && !statusVal.includes('skipped')) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorArgb } };
    }
  });
}

// ============================================================
// EXAMPLE: Content Calendar spreadsheet
// ============================================================

const workbook = new ExcelJS.Workbook();
workbook.creator = 'RSK';
workbook.created = new Date();

const sheet = workbook.addWorksheet('Content Calendar');

// Define columns with explicit widths
sheet.columns = [
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Day', key: 'day', width: 8 },
  { header: 'Theme', key: 'theme', width: 30 },
  { header: 'Content Type', key: 'content_type', width: 20 },
  { header: 'Format', key: 'format', width: 15 },
  { header: 'IG/FB Caption', key: 'ig_caption', width: 50 },
  { header: 'GBP Post', key: 'gbp', width: 50 },
  { header: 'LinkedIn', key: 'linkedin', width: 50 },
  { header: 'TikTok', key: 'tiktok', width: 50 },
  { header: 'X (Twitter)', key: 'twitter', width: 30 },
  { header: 'Status', key: 'status', width: 15 },
  { header: 'Notes', key: 'notes', width: 40 },
];

// Add your data rows here
sheet.addRow({ date: 'May 7', day: 'Thu', theme: 'Teacher Appreciation',
  content_type: 'Community / Holiday', format: 'Static Post',
  ig_caption: '...', status: 'Posted', notes: '...' });
sheet.addRow({ date: 'May 8', day: 'Fri', theme: '', content_type: '',
  format: '', status: 'Not Posted', notes: 'Skipped' });
// ... more rows

// ============================================================
// APPLY ALL FORMATTING (do this AFTER adding all data)
// ============================================================

// 1. Headers
applyHeaders(sheet);

// 2. Row formatting + status-based coloring
applyRowFormatting(sheet, 'status');

// 3. Content type colors (Column D)
applyContentTypeColors(sheet, 'content_type');

// 4. Platform column highlights
applyColumnHighlight(sheet, 'linkedin', COLORS.platformLinkedIn);
applyColumnHighlight(sheet, 'tiktok', COLORS.platformTikTok);
applyColumnHighlight(sheet, 'twitter', COLORS.platformTwitter);

// ============================================================
// PRE-FLIGHT CHECKLIST (verify before saving)
// ============================================================
// [ ] Frozen header row
// [ ] Auto-filters on all columns
// [ ] Column widths set explicitly
// [ ] Text wrapping on long columns
// [ ] Borders on ALL cells (all four sides)
// [ ] Alternating row shading (white/gray)
// [ ] Status cell color-coded (green/yellow/red/blue)
// [ ] Problem rows (Not Posted/Skipped) entire row red
// [ ] Content type column color-coded
// [ ] Platform columns highlighted (LinkedIn blue, TikTok green)
// [ ] No empty rows or columns in middle of data
// [ ] Sheet tabs named descriptively

await workbook.xlsx.writeFile('/workspace/group/files/spreadsheet.xlsx');
console.log('Created spreadsheet.xlsx');
```

**For additional sheets** (scripts, compliance, etc.), use the same functions but pass a different header color:

```javascript
const scriptSheet = workbook.addWorksheet('Dr. Neha Scripts');
// ... add columns and data ...
applyHeaders(scriptSheet, COLORS.headerBgScript);  // Purple headers
applyRowFormatting(scriptSheet, 'status');

const recycleSheet = workbook.addWorksheet('Recycle');
// ... add columns and data ...
applyHeaders(recycleSheet, COLORS.headerBgArchive); // Red headers
applyRowFormatting(recycleSheet, 'status');
```

## Tips

- **File naming:** Use descriptive names — `consulting-proposal-2026-03-22.docx`, not `document.docx`
- **Script format:** Always use `.mjs` extension for ES module syntax
- **Error handling:** Wrap in try/catch and log errors clearly
- **Large documents:** These libraries handle complex docs well — tables, images, charts, formulas all work
- **After creating:** Use `mcp__nanoclaw__send_file` to deliver the file via WhatsApp, or `mcp__email__send_email` for email delivery
