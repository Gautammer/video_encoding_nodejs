const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const port = 3000;

// Store active processing tasks
const processingTasks = new Map();

// Helper function to save processing status to data.json
const saveProcessingStatus = async (videoId, task) => {
    try {
        let data = { videos: [] };
        
        // Read existing data with error handling
        if (fs.existsSync(dataFilePath)) {
            try {
                data = fs.readJsonSync(dataFilePath);
                // Ensure data has valid structure
                if (!data || !data.videos || !Array.isArray(data.videos)) {
                    console.warn('Invalid data structure in data.json, reinitializing');
                    data = { videos: [] };
                }
            } catch (readError) {
                console.error('Error reading data.json:', readError.message);
                // Continue with empty data structure
            }
        }
        
        // Create video data object
        const videoData = {
            id: videoId,
            originalName: task.originalName || 'Unnamed Video',
            hlsPath: task.hlsPath || `/output/${videoId}/playlist.m3u8`,
            size: task.size || 0,
            sizeMB: task.sizeMB || 0,
            mimeType: 'application/x-mpegURL',
            uploadedAt: new Date(task.startTime || Date.now()).toISOString(),
            status: task.status || 'unknown',
            format: 'HLS',
            segmentDuration: encodingSettings.hls.segmentDuration,
            processingProgress: task.progress || 0,
            processingStage: task.stage || '',
            error: task.error || null,
            lastUpdated: Date.now()
        };
        
        // Find if video already exists in data
        const existingIndex = data.videos.findIndex(v => v && v.id === videoId);
        
        // Update or add the video data
        if (existingIndex !== -1) {
            data.videos[existingIndex] = {
                ...data.videos[existingIndex],
                ...videoData
            };
        } else {
            data.videos.unshift(videoData);
        }
        
        // Save updated data
        await fs.writeJson(dataFilePath, data, { spaces: 2 });
        console.log(`Saved processing status for video ${videoId}: ${task.status}`);
        return videoData;
    } catch (error) {
        console.error('Error saving processing status:', error);
        // Try to recreate the data.json file if there was an error
        try {
            await fs.writeJson(dataFilePath, { videos: [] }, { spaces: 2 });
            console.log('Recreated data.json file after error');
        } catch (writeError) {
            console.error('Failed to recreate data.json:', writeError);
        }
    }
};

app.use('/output', (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    next();
  });
  

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Professional-grade encoding settings
const encodingSettings = {
    // Video codec - H.264 for maximum compatibility
    videoCodec: 'libx264',
    // Audio codec - AAC for maximum compatibility
    audioCodec: 'aac',
    // Encoding preset - slower = better compression
    preset: 'slow',
    // Pixel format for compatibility
    pixelFormat: 'yuv420p',
    // Profile for broader device support
    profile: 'main',
    // Level for compatibility
    level: '4.0',
    // Tune for content type
    tune: 'film',
    // HLS settings
    hls: {
        // Segment duration in seconds (shorter = faster startup)
        segmentDuration: 2,
        // Only 480p resolution
        renditions: [
            {
                name: '480p',
                resolution: '854x480',
                videoBitrate: '1200k',
                audioBitrate: '128k',
                maxrate: '1500k',
                bufsize: '3000k',
                bandwidth: 1500000, // For playlist
                crf: 26
            }
        ]
    }
};

// Ensure output directory exists
const outputDir = path.join(__dirname, '../output');
const dataFilePath = path.join(__dirname, '../data.json');
fs.ensureDirSync(outputDir);

// Initialize data file if it doesn't exist or is corrupted
try {
    if (fs.existsSync(dataFilePath)) {
        try {
            // Try to read the file to check if it's valid JSON
            const data = fs.readJsonSync(dataFilePath);
            if (!data || !data.videos) {
                // If data is invalid, initialize with empty videos array
                fs.writeJsonSync(dataFilePath, { videos: [] });
                console.log('Initialized data.json with empty videos array (invalid data)');
            }
        } catch (error) {
            // If there's an error reading the file, it's likely corrupted
            console.error('Error reading data.json, reinitializing file:', error.message);
            fs.writeJsonSync(dataFilePath, { videos: [] });
            console.log('Reinitialized data.json with empty videos array');
        }
    } else {
        // If file doesn't exist, create it
        fs.writeJsonSync(dataFilePath, { videos: [] });
        console.log('Created new data.json file with empty videos array');
    }
} catch (error) {
    console.error('Failed to initialize data.json:', error);
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



// Helper function to update processing task and emit event
const updateProcessingTask = (taskId, updates) => {
    if (!processingTasks.has(taskId)) return;
    
    const task = processingTasks.get(taskId);
    const updatedTask = { ...task, ...updates };
    
    // Update timestamp
    updatedTask.lastUpdated = Date.now();
    
    // Store updated task
    processingTasks.set(taskId, updatedTask);
    
    // Emit update event
    io.emit('processing_update', updatedTask);
    
    // If task is complete or error, save to data.json for persistence
    if (updates.status === 'completed' || updates.status === 'error') {
        saveProcessingStatus(taskId, updatedTask);
    }
};

// Single resolution HLS conversion with preserved aspect ratio
const convertToHLS = (inputPath, outputDir, videoId, originalFilename) => {
    return new Promise((resolve, reject) => {
        // Create HLS directory for this video
        const hlsDir = path.join(outputDir, videoId);
        fs.ensureDirSync(hlsDir);
        
        // Playlist path
        const playlistPath = path.join(hlsDir, 'playlist.m3u8');
        
        // Initialize processing task in the map
        processingTasks.set(videoId, {
            id: videoId,
            originalName: originalFilename,
            status: 'analyzing',
            progress: 0,
            startTime: Date.now(),
            stage: 'Analyzing video metadata',
            error: null
        });
        
        // Emit initial status
        io.emit('processing_update', processingTasks.get(videoId));
        
        // Get video metadata to preserve aspect ratio
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) {
                console.error('Error getting video metadata:', err);
                updateProcessingTask(videoId, {
                    status: 'error',
                    error: 'Failed to analyze video metadata'
                });
                return reject(err);
            }
            
            try {
                // Extract original video dimensions
                const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
                if (!videoStream) {
                    updateProcessingTask(videoId, {
                        status: 'error',
                        error: 'No video stream found in the input file'
                    });
                    return reject(new Error('No video stream found in the input file'));
                }
                
                const originalWidth = videoStream.width;
                const originalHeight = videoStream.height;
                const originalAspectRatio = originalWidth / originalHeight;
                
                console.log(`Original video dimensions: ${originalWidth}x${originalHeight}, aspect ratio: ${originalAspectRatio.toFixed(3)}`);
                
                // Update processing status
                updateProcessingTask(videoId, {
                    status: 'processing',
                    progress: 5,
                    stage: 'Preparing HLS conversion'
                });
                
                // Get the 480p rendition settings (the only one we have now)
                const rendition = encodingSettings.hls.renditions[0];
                
                // Calculate dimensions that preserve aspect ratio
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
                const processHLS = () => {
                    return new Promise((resolve, reject) => {
                        // Calculate target dimensions while preserving aspect ratio
                        const targetHeight = parseInt(rendition.resolution.split('x')[1]);
                        const targetWidth = Math.round(targetHeight * originalAspectRatio);
                        const targetResolution = `${targetWidth}x${targetHeight}`;
                        
                        console.log(`Target resolution: ${targetResolution}`);
                        
                        // Update status
                        updateProcessingTask(videoId, {
                            progress: 10,
                            stage: 'Starting HLS conversion'
                        });
                        
                        // Create the command
                        const command = ffmpeg(inputPath)
                            .outputOptions([
                                '-c:v', encodingSettings.videoCodec,
                                '-c:a', encodingSettings.audioCodec,
                                '-profile:v', encodingSettings.profile,
                                '-level:v', encodingSettings.level,
                                '-pix_fmt', encodingSettings.pixelFormat,
                                '-preset', encodingSettings.preset,
                                '-tune', encodingSettings.tune,
                                '-crf', rendition.crf.toString(),
                                '-sc_threshold', '0',
                                '-g', '48',
                                '-keyint_min', '48',
                                '-hls_time', encodingSettings.hls.segmentDuration.toString(),
                                '-hls_playlist_type', 'vod',
                                '-b:v', rendition.videoBitrate,
                                '-maxrate', rendition.maxrate,
                                '-bufsize', rendition.bufsize,
                                '-b:a', rendition.audioBitrate,
                                '-vf', `scale=${targetResolution}:force_original_aspect_ratio=decrease,pad=${targetResolution}:(ow-iw)/2:(oh-ih)/2`,
                                '-hls_segment_filename', path.join(hlsDir, 'segment_%03d.ts')
                            ])
                            .output(playlistPath)
                            .on('start', (commandLine) => {
                                console.log('FFmpeg command:', commandLine);
                                updateProcessingTask(videoId, {
                                    stage: 'Converting video to HLS format'
                                });
                            })
                            .on('progress', (progress) => {
                                const percent = Math.floor(progress.percent);
                                console.log(`Processing: ${percent}% done`);
                                
                                // Map ffmpeg's 0-100% to our 10-90% range (leaving room for pre and post processing)
                                const mappedProgress = 10 + Math.floor(percent * 0.8);
                                
                                updateProcessingTask(videoId, {
                                    progress: mappedProgress,
                                    stage: `Converting video: ${percent}% complete`,
                                    details: progress
                                });
                            })
                            .on('end', () => {
                                console.log('HLS conversion completed');
                                updateProcessingTask(videoId, {
                                    progress: 90,
                                    stage: 'Finalizing video'
                                });
                                resolve([{ name: rendition.name, resolution: targetResolution }]);
                            })
                            .on('error', (err) => {
                                console.error('Error during HLS conversion:', err);
                                updateProcessingTask(videoId, {
                                    status: 'error',
                                    error: err.message || 'Error during HLS conversion'
                                });
                                reject(err);
                            });
                        
                        // Run the command
                        command.run();
                    });
                };
        
                // Start processing
                processHLS()
                    .then(renditions => {
                        console.log('HLS conversion completed.');
                        
                        resolve({
                            hlsDir,
                            masterPlaylist: `/output/${videoId}/playlist.m3u8`,
                            renditions: renditions.map(r => r.name)
                        });
                    })
                    .catch(err => {
                        console.error('Error during HLS conversion:', err);
                        reject(err);
                    });
            } catch (error) {
                console.error('Error setting up HLS conversion:', error);
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
        let data;
        try {
            data = fs.readJsonSync(dataFilePath);
            // Validate data structure
            if (!data || !data.videos || !Array.isArray(data.videos)) {
                console.warn('Invalid data structure in data.json, returning empty array');
                return res.json([]);
            }
        } catch (readError) {
            console.error('Error reading data.json:', readError.message);
            // Initialize the file with empty data
            fs.writeJsonSync(dataFilePath, { videos: [] });
            return res.json([]);
        }
        
        res.json(data.videos);
    } catch (error) {
        console.error('Error in GET /videos endpoint:', error);
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
            const originalFilename = req.file.originalname;
            
            console.log('Converting directly to HLS...');
            
            // Respond immediately to client with processing status
            res.status(202).json({
                message: 'Video upload received, processing started',
                videoId: videoId,
                status: 'processing'
            });
            
            // Start conversion process asynchronously
            convertToHLS(tempPath, outputDir, videoId, originalFilename)
                .then(async (hlsResult) => {
                    // Delete the original uploaded file
                    await fs.unlink(tempPath).catch(console.error);
                    
                    // Calculate total size of all HLS files
                    const hlsDir = path.join(outputDir, videoId);
                    const hlsFiles = await fs.readdir(hlsDir);
                    let totalSize = 0;
                    
                    for (const file of hlsFiles) {
                        const fileStat = await fs.stat(path.join(hlsDir, file));
                        totalSize += fileStat.size;
                    }
                    
                    const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
                    
                    // Update processing task with completion info
                    updateProcessingTask(videoId, {
                        status: 'completed',
                        progress: 100,
                        stage: 'Processing complete',
                        hlsPath: hlsResult.masterPlaylist,
                        size: totalSize,
                        sizeMB: parseFloat(sizeMB)
                    });
                })
                .catch(error => {
                    console.error('Error processing video:', error);
                    updateProcessingTask(videoId, {
                        status: 'error',
                        error: error.message || 'Unknown error during processing'
                    });
                });
            
        } catch (error) {
            console.error('Error setting up video processing:', error);
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

// Get processing status endpoint
app.get('/processing/:id', (req, res) => {
    const videoId = req.params.id;
    
    if (processingTasks.has(videoId)) {
        res.json(processingTasks.get(videoId));
    } else {
        // Check if it's in the data.json file
        try {
            const data = fs.readJsonSync(dataFilePath);
            const video = data.videos.find(v => v.id === videoId);
            
            if (video) {
                res.json({
                    id: videoId,
                    status: video.status,
                    progress: video.processingProgress || (video.status === 'completed' ? 100 : 0),
                    stage: video.processingStage || video.status,
                    error: video.error
                });
            } else {
                res.status(404).json({ error: 'Processing task not found' });
            }
        } catch (error) {
            res.status(500).json({ error: 'Failed to retrieve processing status' });
        }
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected');
    
    // Send current processing tasks to the newly connected client
    const tasks = Array.from(processingTasks.values());
    if (tasks.length > 0) {
        socket.emit('processing_tasks', tasks);
    }
    
    // Handle client requesting specific task status
    socket.on('get_processing_status', (videoId) => {
        if (processingTasks.has(videoId)) {
            socket.emit('processing_update', processingTasks.get(videoId));
        } else {
            // Try to get from data.json
            try {
                const data = fs.readJsonSync(dataFilePath);
                const video = data.videos.find(v => v.id === videoId);
                
                if (video) {
                    socket.emit('processing_update', {
                        id: videoId,
                        status: video.status,
                        progress: video.processingProgress || (video.status === 'completed' ? 100 : 0),
                        stage: video.processingStage || video.status,
                        error: video.error
                    });
                }
            } catch (error) {
                console.error('Error retrieving processing status:', error);
            }
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Use the HTTP server for Socket.IO
server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`Uploaded videos are stored in: ${outputDir}`);
});
    