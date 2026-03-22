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

```javascript
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
workbook.creator = 'RSK';
workbook.created = new Date();

const sheet = workbook.addWorksheet('Sheet 1');

// Headers with styling
sheet.columns = [
  { header: 'Name', key: 'name', width: 25 },
  { header: 'Email', key: 'email', width: 30 },
  { header: 'Amount', key: 'amount', width: 15 },
];

// Style header row
sheet.getRow(1).font = { bold: true };
sheet.getRow(1).fill = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FFE0E0E0' },
};

// Add data
sheet.addRow({ name: 'John Doe', email: 'john@example.com', amount: 1500 });
sheet.addRow({ name: 'Jane Smith', email: 'jane@example.com', amount: 2300 });

// Format currency column
sheet.getColumn('amount').numFmt = '$#,##0.00';

await workbook.xlsx.writeFile('/workspace/group/files/spreadsheet.xlsx');
console.log('Created spreadsheet.xlsx');
```

## Tips

- **File naming:** Use descriptive names — `consulting-proposal-2026-03-22.docx`, not `document.docx`
- **Script format:** Always use `.mjs` extension for ES module syntax
- **Error handling:** Wrap in try/catch and log errors clearly
- **Large documents:** These libraries handle complex docs well — tables, images, charts, formulas all work
- **After creating:** Use `mcp__nanoclaw__send_file` to deliver the file via WhatsApp, or `mcp__email__send_email` for email delivery
