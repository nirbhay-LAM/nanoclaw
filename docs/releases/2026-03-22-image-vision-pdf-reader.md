# Release: Image Vision + PDF Reader

**Date:** 2026-03-22
**Commits:** merge of whatsapp/skill/image-vision, whatsapp/skill/pdf-reader, 66047d4
**Container rebuild:** Yes
**Service restart:** Yes

## What Changed

### Image Vision

RSK can now see and understand images sent via WhatsApp. All image formats are supported including HEIC (iPhone default), PNG, JPEG, WebP, GIF, TIFF, and AVIF.

**How it works:**
- Images are downloaded via Baileys, resized to max 1024px, converted to JPEG
- Saved to group attachments directory
- Passed to Claude as multimodal content blocks (base64 encoded)
- RSK can describe, analyze, and reason about image content

**Key capability:** Send RSK a photo with no caption and he'll describe what he sees. Send with a caption and he'll use that as context.

### PDF Reader

RSK can now receive and read PDF documents sent via WhatsApp.

**How it works:**
- PDFs are downloaded and saved to group attachments
- `poppler-utils` (`pdftotext`) installed in container for text extraction
- RSK uses the pdf-reader CLI to extract text content
- Can then summarize, analyze, or answer questions about the PDF

### Technical Details

- `sharp` library added for image processing (native HEIC/HEIF support via libvips)
- `poppler-utils` added to container Dockerfile
- `pdf-reader` CLI installed in container at `/usr/local/bin/`
- Agent-runner extended with multimodal content block support (image + text)
- ContainerInput extended with `imageAttachments` field
- WhatsApp channel handles both `imageMessage` and `documentMessage` types

## Test Results

- 22 test files, 328 tests, all passing
- Host build clean
- Container build clean
