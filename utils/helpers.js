const jwt = require('jsonwebtoken');
const User = require('../models/User');

// JWT Authentication middleware
// - Verifies the Bearer token from the Authorization header.
// - Loads the user from DB and verifies that the token exists in the user's active sessions.
// - Cleans expired sessions on the user record.
// - On success attaches decoded user info to req.user and the raw token to req.token, then calls next().
// - On failure responds with 401 or 403 and does NOT call next().
// Note: Does not modify request body and relies on process.env.JWT_SECRET for verification.
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
// - Trims whitespace and enforces a minimal length of 1 character.
// - Allows letters, numbers and a set of common special characters.
// - Returns true if password matches allowed pattern, false otherwise.
// - On unexpected error logs it and returns true (lenient fallback).
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
// - Generates an uppercase alphanumeric code of given length (default 6).
// - Uses Math.random() which is NOT crypto-secure; suitable for convenience codes but not for high-security tokens.
const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// Validate room code format
// - Ensures roomCode is exactly 6 characters of uppercase letters or digits.
const validateRoomCode = (roomCode) => {
    return /^[A-Z0-9]{6}$/.test(roomCode);
};

// Sanitize user input
// - If input is not a string returns empty string.
// - Trims whitespace and removes common HTML-sensitive characters to reduce injection/XSS risk.
// - Note: This is a lightweight sanitizer and not a full HTML escape routine.
const sanitizeInput = (input) => {
    if (typeof input !== 'string') return '';
    return input.trim().replace(/[<>&"']/g, '');
};

// Check if user is room member
// - room: expected to have a 'members' array with objects that include a 'username' property.
// - username: string to check against member usernames.
// - Returns true if any member matches the username.
const isRoomMember = (room, username) => {
    return room.members.some(member => member.username === username);
};

// Calculate voting result
// - votes: array of vote objects { decision: 'admit' | 'deny' }
// - Returns counts for admit/deny, total votes, the computed result string (majority), and a flag if any votes exist.
// - Tie or equal counts default to 'deny' (caller may override logic if needed).
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
