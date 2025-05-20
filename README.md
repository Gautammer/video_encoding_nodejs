# Video Processing API

A Node.js API for uploading, processing, and serving video content with HLS (HTTP Live Streaming) format conversion.

## Features

- Video upload with 2GB file size limit
- Automatic conversion to HLS format for streaming
- Optimized 480p resolution with preserved aspect ratio
- Professional-grade encoding settings using FFmpeg
- RESTful API endpoints for video management
- Persistent storage of video metadata

## Requirements

- Node.js (v14 or higher recommended)
- FFmpeg (automatically installed via dependencies)

## Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

For development with auto-restart:

```bash
npm run dev
```

## API Endpoints

### GET /videos

Retrieves a list of all uploaded videos.

**Response:**
```json
[
  {
    "id": "1621234567890",
    "originalName": "example.mp4",
    "hlsPath": "/output/1621234567890/playlist.m3u8",
    "size": 5242880,
    "sizeMB": 5.00,
    "mimeType": "application/x-mpegURL",
    "uploadedAt": "2023-05-18T12:34:56.789Z",
    "status": "completed",
    "format": "HLS",
    "segmentDuration": 2
  }
]
```

### POST /upload

Uploads and processes a video file.

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Form field: `video` (file)

**Example using curl:**
```bash
curl -X POST -F "video=@/path/to/your/video.mp4" http://localhost:3000/upload
```

**Example using JavaScript (with fetch):**
```javascript
const formData = new FormData();
formData.append('video', videoFile); // videoFile is a File object from input

fetch('http://localhost:3000/upload', {
  method: 'POST',
  body: formData
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

**Response:**
```json
{
  "message": "Video uploaded and compressed successfully",
  "video": {
    "id": "1621234567890",
    "originalName": "example.mp4",
    "hlsPath": "/output/1621234567890/playlist.m3u8",
    "size": 5242880,
    "sizeMB": 5.00,
    "mimeType": "application/x-mpegURL",
    "uploadedAt": "2023-05-18T12:34:56.789Z",
    "status": "completed",
    "format": "HLS",
    "segmentDuration": 2
  }
}
```

### Accessing Processed Videos

Videos are accessible via the path returned in the `hlsPath` property:

```
http://localhost:3000/output/VIDEO_ID/playlist.m3u8
```

## Supported Video Formats

- MP4 (.mp4)
- QuickTime (.mov)
- AVI (.avi)
- Windows Media Video (.wmv)
- Matroska (.mkv)

## HLS Encoding Settings

The API uses the following encoding settings for optimal quality and compatibility:

- Video codec: H.264 (libx264)
- Audio codec: AAC
- Encoding preset: slow (better compression)
- Pixel format: yuv420p
- Profile: main
- Level: 4.0
- Resolution: 854x480 (480p) with preserved aspect ratio
- Video bitrate: 1200k
- Audio bitrate: 128k
- Segment duration: 2 seconds

## Error Handling

The API returns appropriate HTTP status codes and error messages:

- 400: Bad Request (invalid file type, no file uploaded)
- 500: Server Error (processing failure)

## File Storage

- Original uploaded files are temporarily stored and then deleted after processing
- Processed HLS files are stored in the `output` directory
- Video metadata is stored in `data.json`

## License

ISC
