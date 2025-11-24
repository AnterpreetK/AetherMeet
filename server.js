
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const schedule = require('node-schedule');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Import security middleware and memory management
const { 
    generalLimiter, 
    authLimiter, 
    helmetConfig,
    sanitizeInput 
} = require('./middleware/security');
const memoryManager = require('./utils/memoryManager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Trust proxy - important for rate limiting to work correctly when behind reverse proxy or using ngrok
app.set('trust proxy', 1);

// Import routes and models
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const notesRoutes = require('./routes/notes');
const mediaRoutes = require('./routes/media');
const analyticsRoutes = require('./routes/analytics');
const moderationRoutes = require('./routes/moderation');
const i18nRoutes = require('./routes/i18n');
const memoryRoutes = require('./routes/memory');
const socketHandler = require('./socket/socketHandler');

// Security middleware
app.use(helmetConfig);
app.use(generalLimiter);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));
app.use(express.static('public'));
app.use('/storage', express.static('storage'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// MongoDB connection with optimized settings
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/aethermeet', {
    maxPoolSize: 10, // Maintain up to 10 socket connections
    serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    bufferCommands: false // Disable mongoose buffering
}).then(() => {
    console.log('✅ MongoDB connected successfully');
    
    // Start memory management system AFTER DB is connected
    memoryManager.startCleanup(30); // Cleanup every 30 minutes
    
    // Start server only after DB is ready
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });
}).catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
});

// Health check endpoint for production monitoring
app.get('/api/health', (req, res) => {
    const healthCheck = {
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        status: 'OK',
        memory: process.memoryUsage(),
        version: require('./package.json').version
    };
    
    // Check database connection
    if (mongoose.connection.readyState === 1) {
        healthCheck.database = 'Connected';
    } else {
        healthCheck.database = 'Disconnected';
        healthCheck.status = 'ERROR';
    }
    
    const statusCode = healthCheck.status === 'OK' ? 200 : 503;
    res.status(statusCode).json(healthCheck);
});

// Routes with rate limiting
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/rooms', roomRoutes(io)); // Pass io instance to room routes
app.use('/api/notes', notesRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/i18n', i18nRoutes);
app.use('/api/memory', memoryRoutes);

// Serve frontend pages
app.get('/', (req, res) => {
    const pendingRoomCode = req.session.pendingRoomCode;
    res.render('index', { pendingRoomCode: pendingRoomCode || null });
});

app.get('/dashboard', (req, res) => {
    const roomCode = req.query.roomCode || req.session.pendingRoomCode;
    // Clear the pending room code from session once used
    if (req.session.pendingRoomCode) {
        delete req.session.pendingRoomCode;
    }
    res.render('dashboard', { roomCode: roomCode || null });
});

app.get('/notes', (req, res) => {
    res.render('notes');
});

app.get('/room/:roomCode', async (req, res) => {
    try {
        const { roomCode } = req.params;
        let isDemo = req.query.demo === 'true';
        
        const Room = require('./models/Room');
        
        // Check if room exists
        const room = await Room.findOne({ 
            roomCode: roomCode.toUpperCase(),
            isActive: true 
        });
        
        if (!room) {
            return res.status(404).send('Room not found or expired');
        }
        
        // Auto-detect if this is a demo room (even if demo param is missing)
        if (room.isDemoRoom) {
            isDemo = true;
            // Redirect to include demo parameter if missing
            if (req.query.demo !== 'true') {
                return res.redirect(`/room/${roomCode}?demo=true`);
            }
        }
        
        res.render('room', { 
            roomCode: req.params.roomCode,
            isDemo: isDemo
        });
    } catch (error) {
        res.status(500).send('Server error');
    }
});

// Handle share links - redirect to dashboard with room code
app.get('/join/:roomCode', (req, res) => {
    const { roomCode } = req.params;
    
    // Check if user is authenticated
    const token = req.cookies.token;
    
    if (!token) {
        req.session.pendingRoomCode = roomCode.toUpperCase();
        return res.redirect('/');
    }
    
    try {
        jwt.verify(token, process.env.JWT_SECRET);
        res.redirect(`/dashboard?roomCode=${roomCode.toUpperCase()}`);
    } catch (error) {
        req.session.pendingRoomCode = roomCode.toUpperCase();
        res.redirect('/');
    }
});

// Socket.IO handling
socketHandler(io);

// Graceful shutdown
process.on('SIGTERM', () => {
    memoryManager.stopCleanup();
    server.close(() => {
        mongoose.connection.close();
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    memoryManager.stopCleanup();
    server.close(() => {
        mongoose.connection.close();
        process.exit(0);
    });
});



module.exports = app;
