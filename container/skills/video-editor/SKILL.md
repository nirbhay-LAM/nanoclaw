# Video Editor

You have ffmpeg and ffprobe installed. Use them via Bash to edit videos.

## Input Videos

Videos from WhatsApp are saved to `/workspace/group/attachments/`. The video file and extracted frames are stored there:
- Original: `attachments/vid-{timestamp}.mp4`
- Frames: `attachments/vid-{timestamp}/frame_NNNN.jpg`
- Metadata: `attachments/vid-{timestamp}/metadata.json`

## Output Videos

Save edited videos to `/workspace/group/files/` then use `mcp__nanoclaw__send_file` to deliver them.

## Common Operations

### Get video info
```bash
ffprobe -v quiet -print_format json -show_format -show_streams /workspace/group/attachments/vid-*.mp4
```

### Trim
```bash
ffmpeg -i input.mp4 -ss 00:00:05 -to 00:00:20 -c copy /workspace/group/files/trimmed.mp4
```

### Text overlay
```bash
ffmpeg -i input.mp4 -vf "drawtext=text='Cafe Smile Studio':fontsize=36:fontcolor=white:borderw=2:bordercolor=black:x=(w-tw)/2:y=h-th-40" /workspace/group/files/overlay.mp4
```

### Speed up (2x)
```bash
ffmpeg -i input.mp4 -filter:v "setpts=0.5*PTS" -filter:a "atempo=2.0" /workspace/group/files/fast.mp4
```

### Slow down (0.5x)
```bash
ffmpeg -i input.mp4 -filter:v "setpts=2.0*PTS" -filter:a "atempo=0.5" /workspace/group/files/slow.mp4
```

### Concatenate clips
```bash
# Create list file
echo "file '/workspace/group/attachments/clip1.mp4'" > /tmp/concat.txt
echo "file '/workspace/group/attachments/clip2.mp4'" >> /tmp/concat.txt
# Concatenate
ffmpeg -f concat -safe 0 -i /tmp/concat.txt -c copy /workspace/group/files/combined.mp4
```

### Add background music
```bash
ffmpeg -i input.mp4 -i /workspace/group/attachments/music.mp3 -map 0:v -map 1:a -c:v copy -shortest /workspace/group/files/with-music.mp4
```

### Mix voice + music (voice at full volume, music at 20%)
```bash
ffmpeg -i input.mp4 -i music.mp3 -filter_complex "[0:a]volume=1.0[voice];[1:a]volume=0.2[music];[voice][music]amix=inputs=2:duration=first" -map 0:v -c:v copy /workspace/group/files/mixed.mp4
```

### Burn subtitles
```bash
# Create .srt file first, then:
ffmpeg -i input.mp4 -vf "subtitles=/tmp/subs.srt:force_style='FontSize=20,PrimaryColour=&Hffffff&'" /workspace/group/files/subtitled.mp4
```

### Instagram Reel format (9:16, 1080x1920)
```bash
ffmpeg -i input.mp4 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" -c:a copy /workspace/group/files/reel.mp4
```

### Color warmth (dental office aesthetic)
```bash
ffmpeg -i input.mp4 -vf "colorbalance=rs=0.08:gs=0.04:bs=-0.06,eq=brightness=0.03:saturation=1.1" /workspace/group/files/warm.mp4
```

### Extract audio (for transcription)
```bash
ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 /tmp/audio.wav
```

### Add fade in/out
```bash
ffmpeg -i input.mp4 -vf "fade=t=in:st=0:d=1,fade=t=out:st=14:d=1" -af "afade=t=in:st=0:d=1,afade=t=out:st=14:d=1" /workspace/group/files/faded.mp4
```

### Generate thumbnail
```bash
ffmpeg -i input.mp4 -ss 00:00:02 -vframes 1 /workspace/group/files/thumbnail.jpg
```

## Workflow

1. Review the video (frames are in your context as images)
2. Discuss edits with Nirbhay inline in WhatsApp
3. Once editing plan is agreed, execute ffmpeg commands
4. Send edited video via `mcp__nanoclaw__send_file`
5. Iterate if needed

## Important Notes

- Always use `-y` flag to overwrite output files without prompting
- For re-encoding, use `-c:v libx264 -preset medium -crf 23` for good quality/size balance
- For Instagram: max 60 seconds, 9:16 aspect ratio, under 100MB
- Keep original files intact. Save edits to `/workspace/group/files/`
