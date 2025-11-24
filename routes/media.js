const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../utils/helpers');
const { mediaUploadLimiter, validateFileUpload } = require('../middleware/security');
const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../storage/media');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// File filter for allowed types
const fileFilter = (req, file, cb) => {
    const allowedTypes = {
        'image/jpeg': 'image',
        'image/png': 'image',
        'image/gif': 'image',
        'image/webp': 'image',
        'video/mp4': 'video',
        'video/webm': 'video',
        'video/ogg': 'video',
        'audio/mpeg': 'audio',
        'audio/wav': 'audio',
        'audio/ogg': 'audio',
        'audio/webm': 'audio',
        'application/pdf': 'file',
        'text/plain': 'file',
        'application/msword': 'file',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'file'
    };

    if (allowedTypes[file.mimetype]) {
        req.mediaType = allowedTypes[file.mimetype];
        cb(null, true);
    } else {
        cb(new Error('File type not allowed'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Conditional authentication middleware for demo users
const conditionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    // If no authorization header, assume demo user
    if (!authHeader) {
        req.user = {
            userId: 'demo-' + Date.now(),
            username: 'Guest' + Math.floor(Math.random() * 10000)
        };
        return next();
    }
    
    // If authorization header exists, use normal authentication
    return authenticateToken(req, res, next);
};

// Upload media file with rate limiting
router.post('/upload', mediaUploadLimiter, conditionalAuth, upload.single('media'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        // Validate file upload
        try {
            validateFileUpload(req.file);
        } catch (validationError) {
            // Delete the uploaded file if validation fails
            fs.unlinkSync(req.file.path);
            return res.status(400).json({
                success: false,
                message: validationError.message
            });
        }

        const mediaUrl = `/api/media/file/${req.file.filename}`;
        
        res.json({
            success: true,
            media: {
                url: mediaUrl,
                filename: req.file.filename,
                originalName: req.file.originalname,
                size: req.file.size,
                type: req.mediaType,
                mimetype: req.file.mimetype
            }
        });

    } catch (error) {
        console.error('Media upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload media'
        });
    }
});

// Upload audio recording with rate limiting
router.post('/upload-audio', mediaUploadLimiter, conditionalAuth, (req, res) => {
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 5 * 1024 * 1024 // 5MB limit for audio
        },
        fileFilter: (req, file, cb) => {
            if (file.mimetype.startsWith('audio/')) {
                cb(null, true);
            } else {
                cb(new Error('Only audio files allowed'), false);
            }
        }
    }).single('audio');

    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({
                success: false,
                message: err.message
            });
        }

        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No audio file uploaded'
                });
            }

            // Save audio file
            const filename = `audio-${Date.now()}-${Math.round(Math.random() * 1E9)}.webm`;
            const filepath = path.join(__dirname, '../storage/media', filename);
            
            fs.writeFileSync(filepath, req.file.buffer);

            const mediaUrl = `/api/media/file/${filename}`;
            
            res.json({
                success: true,
                media: {
                    url: mediaUrl,
                    filename: filename,
                    originalName: req.file.originalname || 'audio_recording.webm',
                    size: req.file.size,
                    type: 'audio',
                    mimetype: req.file.mimetype,
                    duration: req.body.duration || null
                }
            });

        } catch (error) {
            console.error('Audio upload error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to upload audio'
            });
        }
    });
});

// Serve media files
router.get('/file/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filepath = path.join(__dirname, '../storage/media', filename);
        
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        // Set appropriate headers based on file type
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.ogg': 'video/ogg',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.pdf': 'application/pdf',
            '.txt': 'text/plain',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        
        // CORS headers for cross-origin access
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour cache
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        
        res.sendFile(filepath);

    } catch (error) {
        console.error('File serve error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to serve file'
        });
    }
});

// Download media file (force download instead of inline display)
router.get('/download/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filepath = path.join(__dirname, '../storage/media', filename);
        
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        // Force download with attachment disposition
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        res.sendFile(filepath);

    } catch (error) {
        console.error('File download error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to download file'
        });
    }
});

// Delete media file (for cleanup)
router.delete('/file/:filename', authenticateToken, (req, res) => {
    try {
        const filename = req.params.filename;
        const filepath = path.join(__dirname, '../storage/media', filename);
        
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }

        res.json({
            success: true,
            message: 'File deleted successfully'
        });

    } catch (error) {
        console.error('File deletion error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete file'
        });
    }
});

module.exports = router;
