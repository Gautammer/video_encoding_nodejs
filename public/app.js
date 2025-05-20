document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const uploadProgress = document.getElementById('upload-progress');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const uploadStatus = document.getElementById('upload-status');
    const cancelUpload = document.getElementById('cancel-upload');
    const videoGrid = document.getElementById('video-grid');
    const loadingVideos = document.getElementById('loading-videos');
    const videoModal = document.getElementById('video-modal');
    const closeButton = document.querySelector('.close-button');
    const videoPlayer = document.getElementById('video-player');
    const modalTitle = document.getElementById('modal-title');
    const modalDate = document.getElementById('modal-date');
    const modalSize = document.getElementById('modal-size');
    const modalFormat = document.getElementById('modal-format');
    const videoUrlInput = document.getElementById('video-url');
    const copyUrlBtn = document.getElementById('copy-url-btn');
    const deleteVideoBtn = document.getElementById('delete-video-btn');

    // Variables
    let currentXhr = null;
    let currentVideoId = null; // To track which video is currently open in the modal
    const apiBaseUrl = window.location.origin; // Assuming API is on the same domain

    // Initialize
    fetchVideos();

    // Event Listeners
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    cancelUpload.addEventListener('click', cancelUploadHandler);
    closeButton.addEventListener('click', closeModal);
    copyUrlBtn.addEventListener('click', copyVideoUrl);
    deleteVideoBtn.addEventListener('click', confirmDeleteVideo);
    window.addEventListener('click', (e) => {
        if (e.target === videoModal) closeModal();
    });

    // Functions
    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) uploadFile(file);
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.add('drag-over');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('drag-over');
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove('drag-over');
        
        const file = e.dataTransfer.files[0];
        if (file) uploadFile(file);
    }

    function uploadFile(file) {
        // Validate file type
        const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/x-matroska'];
        if (!file.type.startsWith('video/')) {
            alert('Only video files are allowed!');
            return;
        }
        
        if (!allowedTypes.includes(file.type)) {
            alert(`Unsupported video format: ${file.type}. Supported formats: MP4, MOV, AVI, WMV, MKV`);
            return;
        }

        // Check file size (2GB limit)
        if (file.size > 2 * 1024 * 1024 * 1024) {
            alert('File size exceeds the 2GB limit.');
            return;
        }

        // Show progress UI
        uploadArea.style.display = 'none';
        uploadProgress.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
        uploadStatus.textContent = 'Preparing upload...';

        // Create FormData
        const formData = new FormData();
        formData.append('video', file);

        // Create XHR request
        currentXhr = new XMLHttpRequest();
        currentXhr.open('POST', `${apiBaseUrl}/upload`, true);

        // Setup event listeners
        currentXhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percentComplete = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = percentComplete + '%';
                progressText.textContent = percentComplete + '%';
                
                if (percentComplete < 100) {
                    uploadStatus.textContent = 'Uploading...';
                } else {
                    uploadStatus.textContent = 'Processing video... This may take a while.';
                }
            }
        });

        currentXhr.addEventListener('load', () => {
            if (currentXhr.status >= 200 && currentXhr.status < 300) {
                const response = JSON.parse(currentXhr.responseText);
                uploadStatus.textContent = 'Upload complete!';
                setTimeout(() => {
                    resetUploadUI();
                    fetchVideos(); // Refresh video list
                }, 2000);
            } else {
                let errorMsg = 'Upload failed.';
                try {
                    const response = JSON.parse(currentXhr.responseText);
                    errorMsg = response.error || errorMsg;
                } catch (e) {
                    console.error('Error parsing response:', e);
                }
                uploadStatus.textContent = errorMsg;
                progressBar.style.backgroundColor = 'var(--danger-color)';
                setTimeout(resetUploadUI, 3000);
            }
        });

        currentXhr.addEventListener('error', () => {
            uploadStatus.textContent = 'Network error occurred.';
            progressBar.style.backgroundColor = 'var(--danger-color)';
            setTimeout(resetUploadUI, 3000);
        });

        currentXhr.addEventListener('abort', () => {
            uploadStatus.textContent = 'Upload cancelled.';
            setTimeout(resetUploadUI, 1500);
        });

        // Send the request
        currentXhr.send(formData);
    }

    function cancelUploadHandler() {
        if (currentXhr) {
            currentXhr.abort();
            currentXhr = null;
        }
    }

    function resetUploadUI() {
        uploadArea.style.display = 'block';
        uploadProgress.style.display = 'none';
        progressBar.style.width = '0%';
        progressBar.style.backgroundColor = 'var(--primary-color)';
        fileInput.value = '';
    }

    function fetchVideos() {
        loadingVideos.style.display = 'block';
        
        fetch(`${apiBaseUrl}/videos`)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to fetch videos');
                }
                return response.json();
            })
            .then(videos => {
                renderVideos(videos);
            })
            .catch(error => {
                console.error('Error fetching videos:', error);
                videoGrid.innerHTML = `
                    <div class="error-message">
                        <i class="fas fa-exclamation-circle"></i>
                        <p>Failed to load videos. Please try again later.</p>
                    </div>
                `;
            })
            .finally(() => {
                loadingVideos.style.display = 'none';
            });
    }

    function renderVideos(videos) {
        if (!videos || videos.length === 0) {
            videoGrid.innerHTML = `
                <div class="no-videos">
                    <i class="fas fa-film"></i>
                    <p>No videos uploaded yet. Upload your first video!</p>
                </div>
            `;
            return;
        }

        videoGrid.innerHTML = '';
        
        videos.forEach(video => {
            const uploadDate = new Date(video.uploadedAt);
            const formattedDate = uploadDate.toLocaleDateString() + ' ' + uploadDate.toLocaleTimeString();
            
            const videoCard = document.createElement('div');
            videoCard.className = 'video-card';
            videoCard.innerHTML = `
                <div class="video-thumbnail">
                    <i class="fas fa-video"></i>
                    <div class="play-button">
                        <i class="fas fa-play"></i>
                    </div>
                </div>
                <div class="video-info">
                    <h3>${video.originalName}</h3>
                    <p><i class="far fa-clock"></i> ${formattedDate}</p>
                    <p><i class="fas fa-hdd"></i> ${video.sizeMB} MB</p>
                    <div class="card-actions">
                        <button class="card-btn copy-url-btn" data-url="${window.location.origin}${video.hlsPath}" title="Copy URL">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="card-btn delete-btn" data-id="${video.id}" title="Delete Video">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
            
            // Add click event for playing the video
            const thumbnail = videoCard.querySelector('.video-thumbnail');
            thumbnail.addEventListener('click', () => openVideoModal(video));
            
            // Add click events for the buttons
            const copyBtn = videoCard.querySelector('.copy-url-btn');
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent opening the modal
                copyUrlToClipboard(copyBtn.dataset.url, copyBtn);
            });
            
            const deleteBtn = videoCard.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent opening the modal
                confirmDeleteVideoFromCard(video.id, deleteBtn);
            });
            
            videoGrid.appendChild(videoCard);
        });
    }

    function openVideoModal(video) {
        // Store current video ID for delete operation
        currentVideoId = video.id;
        
        modalTitle.textContent = video.originalName;
        modalDate.textContent = new Date(video.uploadedAt).toLocaleString();
        modalSize.textContent = `${video.sizeMB} MB`;
        modalFormat.textContent = video.format;
        
        // Setup video player with HLS.js
        const videoSrc = `${apiBaseUrl}${video.hlsPath}`;
        
        // Set the video URL for copy functionality
        const fullVideoUrl = `${window.location.origin}${video.hlsPath}`;
        videoUrlInput.value = fullVideoUrl;
        
        // Reset delete button state
        deleteVideoBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Video';
        deleteVideoBtn.disabled = false;
        
        if (Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(videoSrc);
            hls.attachMedia(videoPlayer);
            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                videoPlayer.play();
            });
        } 
        // For browsers that support HLS natively (Safari)
        else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            videoPlayer.src = videoSrc;
        }
        
        videoModal.style.display = 'block';
    }

    function closeModal() {
        videoModal.style.display = 'none';
        videoPlayer.pause();
        videoPlayer.src = '';
        currentVideoId = null;
    }
    
    function copyVideoUrl() {
        videoUrlInput.select();
        document.execCommand('copy');
        
        // Show feedback
        const originalText = copyUrlBtn.innerHTML;
        copyUrlBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        copyUrlBtn.style.backgroundColor = 'var(--success-color)';
        
        setTimeout(() => {
            copyUrlBtn.innerHTML = originalText;
            copyUrlBtn.style.backgroundColor = 'var(--primary-color)';
        }, 2000);
    }
    
    function confirmDeleteVideo() {
        if (!currentVideoId) return;
        
        if (confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
            deleteVideo(currentVideoId);
        }
    }
    
    function deleteVideo(videoId) {
        // Show loading state
        deleteVideoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        deleteVideoBtn.disabled = true;
        
        fetch(`${apiBaseUrl}/videos/${videoId}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to delete video');
            }
            return response.json();
        })
        .then(data => {
            // Close modal and refresh video list
            closeModal();
            fetchVideos();
            
            // Show success message
            alert('Video deleted successfully');
        })
        .catch(error => {
            console.error('Error deleting video:', error);
            alert('Failed to delete video. Please try again.');
            
            // Reset button
            deleteVideoBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Video';
            deleteVideoBtn.disabled = false;
        });
    }
    
    function copyUrlToClipboard(url, buttonElement) {
        // Create a temporary input element
        const tempInput = document.createElement('input');
        tempInput.value = url;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
        
        // Show feedback
        const originalHTML = buttonElement.innerHTML;
        buttonElement.innerHTML = '<i class="fas fa-check"></i>';
        buttonElement.classList.add('success');
        
        setTimeout(() => {
            buttonElement.innerHTML = originalHTML;
            buttonElement.classList.remove('success');
        }, 2000);
    }
    
    function confirmDeleteVideoFromCard(videoId, buttonElement) {
        if (confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
            // Show loading state
            const originalHTML = buttonElement.innerHTML;
            buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            buttonElement.disabled = true;
            
            fetch(`${apiBaseUrl}/videos/${videoId}`, {
                method: 'DELETE'
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to delete video');
                }
                return response.json();
            })
            .then(data => {
                // Refresh video list
                fetchVideos();
                
                // Show success message
                alert('Video deleted successfully');
            })
            .catch(error => {
                console.error('Error deleting video:', error);
                alert('Failed to delete video. Please try again.');
                
                // Reset button
                buttonElement.innerHTML = originalHTML;
                buttonElement.disabled = false;
            });
        }
    }
});
