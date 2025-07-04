const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const app = express();
const port = 3000;

app.use('/output', (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    next();
  });
  

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Optimized encoding settings for faster processing
const encodingSettings = {
    // Video codec - H.264 for maximum compatibility
    videoCodec: 'libx264',
    // Audio codec - AAC for maximum compatibility
    audioCodec: 'aac',
    // Encoding preset - 'veryfast' for much faster encoding with reasonable quality
    preset: 'veryfast',
    // Pixel format for compatibility
    pixelFormat: 'yuv420p',
    // Profile for broader device support
    profile: 'main',
    // Level for compatibility
    level: '4.0',
    // Tune for fast encoding
    tune: 'fastdecode',
    // HLS settings
    hls: {
        // Segment duration in seconds (shorter = faster startup)
        segmentDuration: 2,
        // Only 480p resolution
        renditions: [
            {
                name: '480p',
                resolution: '854x480',
                videoBitrate: '800k',     // Reduced bitrate for faster encoding
                audioBitrate: '96k',      // Reduced audio bitrate
                maxrate: '1000k',         // Reduced maximum bitrate
                bufsize: '2000k',         // Reduced buffer size
                bandwidth: 1000000,       // For playlist
                crf: 28                   // Slightly higher CRF (lower quality) for faster encoding
            }
        ]
    }
};

// Ensure output directory exists
const outputDir = path.join(__dirname, '../output');
const dataFilePath = path.join(__dirname, '../data.json');
fs.ensureDirSync(outputDir);

// Initialize data file if it doesn't exist
if (!fs.existsSync(dataFilePath)) {
    fs.writeJsonSync(dataFilePath, { videos: [] });
}

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, outputDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 2 * 1024 * 1024 * 1024, // 2GB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/x-matroska'];
        if (!file.mimetype.startsWith('video/')) {
            return cb(new Error('Only video files are allowed!'), false);
        }
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error(`Unsupported video format: ${file.mimetype}. Supported formats: MP4, MOV, AVI, WMV, MKV`), false);
        }
        cb(null, true);
    }
}).single('video');



// Single resolution HLS conversion with preserved aspect ratio and thumbnail generation
const convertToHLS = (inputPath, outputDir, videoId) => {
    return new Promise((resolve, reject) => {
        // Create HLS directory for this video
        const hlsDir = path.join(outputDir, videoId);
        fs.ensureDirSync(hlsDir);
        
        // Playlist path
        const playlistPath = path.join(hlsDir, 'playlist.m3u8');
        
        // Thumbnail path
        const thumbnailPath = path.join(hlsDir, 'thumbnail.jpg');
        
        // Get video metadata to preserve aspect ratio
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) {
                console.error('Error getting video metadata:', err);
                return reject(err);
            }
            
            try {
                // Extract original video dimensions
                const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
                if (!videoStream) {
                    return reject(new Error('No video stream found in the input file'));
                }
                
                const originalWidth = videoStream.width;
                const originalHeight = videoStream.height;
                const originalAspectRatio = originalWidth / originalHeight;
                
                console.log(`Original video dimensions: ${originalWidth}x${originalHeight}, aspect ratio: ${originalAspectRatio.toFixed(3)}`);
                
                // Main processing function
                const processVideo = async () => {
                    try {
                        // Step 1: Generate thumbnail
                        await generateThumbnail();
                        
                        // Step 2: Process HLS conversion
                        const renditions = await processHLS();
                        
                        // Step 3: Return result
                        return {
                            hlsDir,
                            masterPlaylist: `/output/${videoId}/playlist.m3u8`,
                            thumbnailPath: `/output/${videoId}/thumbnail.jpg`,
                            renditions: renditions.map(r => r.name)
                        };
                    } catch (error) {
                        console.error('Error in video processing:', error);
                        throw error;
                    }
                };
                
                // Generate thumbnail function
                const generateThumbnail = () => {
                    return new Promise((resolve, reject) => {
                        console.log('Generating thumbnail...');
                        
                        // For portrait videos, use width as the constraint
                        const thumbnailSize = originalAspectRatio < 1 ? '?x480' : '480x?';
                        console.log(`Using thumbnail size: ${thumbnailSize} for aspect ratio: ${originalAspectRatio}`);
                        
                        // Take a screenshot at 10% of the video duration for the thumbnail
                        ffmpeg(inputPath)
                            .screenshots({
                                timestamps: ['10%'],
                                filename: 'thumbnail.jpg',
                                folder: hlsDir,
                                size: thumbnailSize
                            })
                            .on('end', () => {
                                console.log('Thumbnail generated successfully');
                                resolve();
                            })
                            .on('error', (err) => {
                                console.error('Error generating thumbnail:', err);
                                // Don't reject, continue with HLS conversion
                                resolve();
                            });
                    });
                };
                
                // HLS conversion function
                const processHLS = async () => {
                    try {
                        // Get rendition configuration
                        const rendition = encodingSettings.hls.renditions[0];
                        
                        // Determine dimensions while preserving aspect ratio
                        let targetWidth, targetHeight;
                        const baseResolution = rendition.resolution.split('x');
                        const baseWidth = parseInt(baseResolution[0]);
                        const baseHeight = parseInt(baseResolution[1]);
                        
                        // Determine which dimension to constrain
                        if (originalAspectRatio > 1) { // Landscape
                            targetHeight = baseHeight;
                            targetWidth = Math.round(targetHeight * originalAspectRatio);
                            // Make sure width is even (required for some codecs)
                            targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
                        } else { // Portrait or square
                            targetWidth = baseWidth;
                            targetHeight = Math.round(targetWidth / originalAspectRatio);
                            // Make sure height is even
                            targetHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;
                        }
                        
                        const preservedResolution = `${targetWidth}x${targetHeight}`;
                        console.log(`480p adjusted resolution: ${preservedResolution}`);
                        
                        // Process the single 480p rendition
                        console.log(`Creating 480p HLS stream...`);
                        
                        // Create a more robust command for portrait videos
                        const ffmpegCommand = ffmpeg(inputPath);
                        
                        // Add input options optimized for speed
                        ffmpegCommand.inputOptions([
                            '-analyzeduration 10M',   // Reduced analysis time for faster processing
                            '-probesize 10M',         // Reduced probe size for faster processing
                            '-threads 0'              // Use all available CPU cores for faster encoding
                        ]);
                        
                        // Add output options
                        ffmpegCommand.outputOptions([
                            `-c:v ${encodingSettings.videoCodec}`,
                            `-c:a ${encodingSettings.audioCodec}`,
                            `-preset ${encodingSettings.preset}`,
                            `-profile:v ${encodingSettings.profile}`,
                            `-level ${encodingSettings.level}`,
                            `-tune ${encodingSettings.tune}`,
                            `-pix_fmt ${encodingSettings.pixelFormat}`,
                            `-s ${preservedResolution}`,
                            `-b:v ${rendition.videoBitrate}`,
                            `-b:a ${rendition.audioBitrate}`,
                            `-maxrate ${rendition.maxrate}`,
                            `-bufsize ${rendition.bufsize}`,
                            `-crf ${rendition.crf}`,
                            '-sc_threshold 0',
                            '-g 48',                   // GOP size (keyframe interval in frames)
                            '-keyint_min 24',          // Minimum GOP size
                            `-hls_time ${encodingSettings.hls.segmentDuration}`,
                            '-hls_list_size 0',        // Keep all segments in the playlist
                            '-hls_segment_filename', path.join(hlsDir, 'segment_%03d.ts'),
                            '-f hls'
                        ]);
                        
                        // Execute the command with proper event handling
                        await new Promise((renditionResolve, renditionReject) => {
                            ffmpegCommand
                                .output(playlistPath)
                                .on('start', (commandLine) => {
                                    console.log('Started FFmpeg with command:', commandLine);
                                })
                                .on('progress', (progress) => {
                                    console.log(`HLS Processing: ${Math.round(progress.percent || 0)}% done`);
                                })
                                .on('end', () => {
                                    console.log(`HLS conversion finished`);
                                    renditionResolve();
                                })
                                .on('error', (err) => {
                                    console.error(`Error during HLS conversion:`, err);
                                    renditionReject(err);
                                })
                                .run();
                        });
                        
                        return [{
                            name: '480p',
                            resolution: preservedResolution
                        }];
                    } catch (err) {
                        console.error('Error processing HLS:', err);
                        throw err;
                    }
                };
                
                // Start the processing pipeline
                processVideo()
                    .then(result => resolve(result))
                    .catch(error => reject(error));
                    
            } catch (error) {
                console.error('Error setting up video processing:', error);
                reject(error);
            }
        });
    });
};

app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Get list of uploaded videos
app.get('/videos', (req, res) => {
    try {
        const data = fs.readJsonSync(dataFilePath);
        res.json(data.videos);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch videos' });
    }
});

// Upload and compress video
app.post('/upload', (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        try {
            const tempPath = req.file.path;
            const videoId = Date.now().toString();
            
            console.log('Converting directly to HLS...');
            
            // Convert directly to HLS in one step
            const hlsResult = await convertToHLS(tempPath, outputDir, videoId);
            
            // Delete the original uploaded file
            await fs.unlink(tempPath).catch(console.error);
            
            // Get file stats for the playlist
            const stats = await fs.stat(path.join(hlsResult.hlsDir, 'playlist.m3u8'));
            
            // Calculate total size of all HLS files
            const hlsFiles = await fs.readdir(hlsResult.hlsDir);
            let totalSize = 0;
            
            for (const file of hlsFiles) {
                const fileStat = await fs.stat(path.join(hlsResult.hlsDir, file));
                totalSize += fileStat.size;
            }
            
            const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
            
            const videoData = {
                id: videoId,
                originalName: req.file.originalname,
                hlsPath: hlsResult.masterPlaylist,
                thumbnailPath: hlsResult.thumbnailPath || `/output/${videoId}/thumbnail.jpg`,
                size: totalSize,
                sizeMB: parseFloat(sizeMB),
                mimeType: 'application/x-mpegURL',
                uploadedAt: new Date().toISOString(),
                status: 'completed',
                format: 'HLS',
                segmentDuration: encodingSettings.hls.segmentDuration
            };
            
            // Read existing data and update
            const data = fs.existsSync(dataFilePath) 
                ? fs.readJsonSync(dataFilePath) 
                : { videos: [] };
                
            data.videos.unshift(videoData); // Add to beginning of array
            
            // Save updated data
            await fs.writeJson(dataFilePath, data, { spaces: 2 });
            
            res.status(201).json({
                message: 'Video uploaded and compressed successfully',
                video: videoData
            });
            
        } catch (error) {
            console.error('Error processing video:', error);
            res.status(500).json({ 
                error: 'Failed to process video',
                details: error.message 
            });
        }
    });
});

// Delete video endpoint
app.delete('/videos/:id', async (req, res) => {
    try {
        const videoId = req.params.id;
        
        // Read current data
        const data = fs.existsSync(dataFilePath) 
            ? fs.readJsonSync(dataFilePath) 
            : { videos: [] };
        
        // Find the video
        const videoIndex = data.videos.findIndex(v => v.id === videoId);
        
        if (videoIndex === -1) {
            return res.status(404).json({ error: 'Video not found' });
        }
        
        const video = data.videos[videoIndex];
        const videoDir = path.join(outputDir, videoId);
        
        // Remove video files
        if (fs.existsSync(videoDir)) {
            await fs.remove(videoDir);
        }
        
        // Remove from data
        data.videos.splice(videoIndex, 1);
        
        // Save updated data
        await fs.writeJson(dataFilePath, data, { spaces: 2 });
        
        res.json({ message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Error deleting video:', error);
        res.status(500).json({ 
            error: 'Failed to delete video',
            details: error.message 
        });
    }
});

// Serve uploaded files
app.use('/output', express.static(outputDir));

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`Uploaded videos are stored in: ${outputDir}`);
});
    