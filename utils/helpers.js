const jwt = require('jsonwebtoken');
const googleDictionary = require('google-dictionary-api');
const User = require('../models/User');

// JWT Authentication middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'Access token required' 
        });
    }

    try {
        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Find user and check if session is active
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Check if token is in active sessions
        if (!user.isTokenValid(token)) {
            return res.status(401).json({ 
                success: false, 
                message: 'Session expired or invalid' 
            });
        }

        // Clean expired sessions periodically
        await user.cleanExpiredSessions();

        req.user = decoded;
        req.token = token;
        next();
    } catch (err) {
        return res.status(403).json({ 
            success: false, 
            message: 'Invalid or expired token' 
        });
    }
};

// Simple password validation (no dictionary check)
const validatePassword = async (password) => {
    try {
        // Clean the password (remove extra spaces)
        const cleanPassword = password.trim();
        
        // Check minimum length (allow any alphanumeric characters)
        if (cleanPassword.length < 1) {
            return false;
        }

        // Allow any alphanumeric characters and some special characters
        const passwordPattern = /^[a-zA-Z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+$/;
        return passwordPattern.test(cleanPassword);
        
    } catch (error) {
        console.error('Password validation error:', error);
        // In case of error, allow the password
        return true;
    }
};

// Generate secure random string
const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// Validate room code format
const validateRoomCode = (roomCode) => {
    return /^[A-Z0-9]{6}$/.test(roomCode);
};

// Sanitize user input
const sanitizeInput = (input) => {
    if (typeof input !== 'string') return '';
    return input.trim().replace(/[<>&"']/g, '');
};

// Check if user is room member
const isRoomMember = (room, username) => {
    return room.members.some(member => member.username === username);
};

// Calculate voting result
const calculateVoteResult = (votes) => {
    const admitVotes = votes.filter(vote => vote.decision === 'admit').length;
    const denyVotes = votes.filter(vote => vote.decision === 'deny').length;
    const totalVotes = votes.length;
    
    // Simple majority rule
    return {
        admit: admitVotes,
        deny: denyVotes,
        total: totalVotes,
        result: admitVotes > denyVotes ? 'admit' : 'deny',
        hasResult: totalVotes > 0
    };
};

module.exports = {
    authenticateToken,
    validatePassword,
    generateSecureCode,
    validateRoomCode,
    sanitizeInput,
    isRoomMember,
    calculateVoteResult
};
