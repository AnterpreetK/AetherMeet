const express = require('express');
const jwt = require('jsonwebtoken');
const schedule = require('node-schedule');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const Room = require('../models/Room');
const Message = require('../models/Message');
const { validatePassword, authenticateToken } = require('../utils/helpers');
const { roomCreationLimiter, sanitizeInput, validateRoomCode } = require('../middleware/security');

module.exports = (io) => {
const router = express.Router();

// Create instant demo room (no authentication required) - with rate limiting
router.post('/create-demo', roomCreationLimiter, async (req, res) => {
    try {
        // Generate a simple room code
        const generateRoomCode = () => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let result = '';
            for (let i = 0; i < 6; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return result;
        };

        let roomCode;
        let existingRoom;
        
        // Ensure unique room code
        do {
            roomCode = generateRoomCode();
            existingRoom = await Room.findOne({ roomCode });
        } while (existingRoom);

        // Create demo room with simple password
        const demoRoom = new Room({
            name: `Demo Room ${roomCode}`,
            roomCode: roomCode,
            primaryPassword: 'demo123', // Simple demo password
            admissionType: 'instant_entry',
            owner: `demo-user-${Date.now()}`, // Unique demo owner identifier
            members: [],
            messages: [],
            isActive: true,
            isDemoRoom: true,
            destructionRules: {
                autoDestroyOnEmpty: true,  // Demo rooms auto-destroy when empty
                ownerOnlyDestroy: false    // Anyone can destroy demo rooms
            },
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        });

        await demoRoom.save();
        console.log('Demo room created successfully:', roomCode);

        res.json({
            success: true,
            roomCode: roomCode,
            shareableUrl: `${req.protocol}://${req.get('host')}/room/${roomCode}?demo=true`,
            message: 'Demo room created successfully'
        });

    } catch (error) {
        console.error('Demo room creation error:', error);
        console.error('Error details:', error.message);
        if (error.name === 'ValidationError') {
            console.error('Validation errors:', error.errors);
        }
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create demo room: ' + error.message
        });
    }
});

// Get room info (check if room exists and is active)
router.get('/:roomCode/info', authenticateToken, async (req, res) => {
    try {
        const { roomCode } = req.params;
        
        const room = await Room.findOne({ 
            roomCode: roomCode.toUpperCase(),
            isActive: true 
        });
        
        if (!room) {
            return res.status(404).json({
                success: false,
                message: 'Room not found or not active'
            });
        }
        
        // Return basic room info without sensitive data
        res.json({
            success: true,
            room: {
                code: room.roomCode,
                name: room.name,
                description: room.description,
                admissionType: room.admissionType,
                createdBy: room.owner,
                participantCount: room.members.length
            }
        });
    } catch (error) {
        console.error('Room info error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get room info'
        });
    }
});

// Create instant room
router.post('/instant', authenticateToken, async (req, res) => {
    try {
        const { name, description, primaryPassword, secondaryPassword, admissionType } = req.body;
        const username = req.user.username;

        // Validate required fields
        if (!name || !primaryPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Room name and primary password are required' 
            });
        }

        // Validate passwords (allow any alphanumeric)
        const isPrimaryValid = await validatePassword(primaryPassword);
        if (!isPrimaryValid) {
            return res.status(400).json({ 
                success: false, 
                message: 'Primary password must contain valid characters' 
            });
        }

        if (secondaryPassword) {
            const isSecondaryValid = await validatePassword(secondaryPassword);
            if (!isSecondaryValid) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Secondary password must contain valid characters' 
                });
            }
        }

        // Generate unique room code
        let roomCode;
        let isUnique = false;
        while (!isUnique) {
            roomCode = Room.generateRoomCode();
            const existingRoom = await Room.findOne({ roomCode, isActive: true });
            if (!existingRoom) {
                isUnique = true;
            }
        }

        // Create room
        const room = new Room({
            roomCode,
            name,
            description,
            owner: username,
            primaryPassword,
            secondaryPassword,
            admissionType: admissionType || 'owner_approval',
            destructionRules: {
                autoDestroyOnEmpty: false, // Authenticated rooms don't auto-destroy
                ownerOnlyDestroy: true     // Only owner can destroy authenticated rooms
            }
        });

        // Add owner as first member
        room.addMember(username);
        await room.save();

        res.status(201).json({
            success: true,
            message: 'Room created successfully',
            room: {
                roomCode: room.roomCode,
                name: room.name,
                description: room.description,
                owner: room.owner,
                admissionType: room.admissionType
            }
        });

    } catch (error) {
        console.error('Room creation error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// Schedule room
router.post('/schedule', authenticateToken, async (req, res) => {
    try {
        const { name, description, primaryPassword, secondaryPassword, admissionType, scheduledTime } = req.body;
        const username = req.user.username;

        // Validate required fields
        if (!name || !primaryPassword || !scheduledTime) {
            return res.status(400).json({ 
                success: false, 
                message: 'Room name, primary password, and scheduled time are required' 
            });
        }

        const scheduleDate = new Date(scheduledTime);
        if (scheduleDate <= new Date()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Scheduled time must be in the future' 
            });
        }

        // Validate passwords (allow any alphanumeric)
        const isPrimaryValid = await validatePassword(primaryPassword);
        if (!isPrimaryValid) {
            return res.status(400).json({ 
                success: false, 
                message: 'Primary password must contain valid characters' 
            });
        }

        if (secondaryPassword) {
            const isSecondaryValid = await validatePassword(secondaryPassword);
            if (!isSecondaryValid) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Secondary password must contain valid characters' 
                });
            }
        }

        // Generate unique room code
        let roomCode;
        let isUnique = false;
        while (!isUnique) {
            roomCode = Room.generateRoomCode();
            const existingRoom = await Room.findOne({ roomCode });
            if (!existingRoom) {
                isUnique = true;
            }
        }

        // Create scheduled room
        const room = new Room({
            roomCode,
            name,
            description,
            owner: username,
            primaryPassword,
            secondaryPassword,
            admissionType: admissionType || 'owner_approval',
            isScheduled: true,
            scheduledTime: scheduleDate,
            isActive: false,
            destructionRules: {
                autoDestroyOnEmpty: false, // Authenticated scheduled rooms don't auto-destroy
                ownerOnlyDestroy: true     // Only owner can destroy authenticated rooms
            }
        });

        await room.save();

        // Schedule room activation
        schedule.scheduleJob(scheduleDate, async () => {
            try {
                const scheduledRoom = await Room.findById(room._id);
                if (scheduledRoom) {
                    scheduledRoom.isActive = true;
                    scheduledRoom.addMember(username);
                    await scheduledRoom.save();
                    console.log(`Room ${roomCode} activated at scheduled time`);
                }
            } catch (error) {
                console.error('Error activating scheduled room:', error);
            }
        });

        res.status(201).json({
            success: true,
            message: 'Room scheduled successfully',
            room: {
                roomCode: room.roomCode,
                name: room.name,
                description: room.description,
                owner: room.owner,
                scheduledTime: room.scheduledTime,
                admissionType: room.admissionType
            }
        });

    } catch (error) {
        console.error('Room scheduling error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// Join room
router.post('/:roomCode/join', authenticateToken, async (req, res) => {
    try {
        const { roomCode } = req.params;
        const { primaryPassword, secondaryPassword } = req.body;
        const username = req.user.username;

        console.log('Join room request:', {
            roomCode,
            username,
            primaryPassword: primaryPassword ? '[PROVIDED]' : '[MISSING]',
            secondaryPassword: secondaryPassword ? '[PROVIDED]' : '[MISSING]'
        });

        // Find room
        const room = await Room.findOne({ roomCode, isActive: true });
        if (!room) {
            console.log('Room not found:', roomCode);
            return res.status(404).json({ 
                success: false, 
                message: 'Room not found or not active' 
            });
        }

        console.log('Room found:', {
            roomCode: room.roomCode,
            name: room.name,
            owner: room.owner,
            primaryPassword: room.primaryPassword ? '[SET]' : '[MISSING]',
            secondaryPassword: room.secondaryPassword ? '[SET]' : '[MISSING]'
        });

        // Check if user is already a member
        if (room.members.find(member => member.username === username)) {
            return res.status(400).json({ 
                success: false, 
                message: 'You are already a member of this room' 
            });
        }

        // Validate passwords
        console.log('Password validation:', {
            provided: primaryPassword,
            expected: room.primaryPassword,
            match: primaryPassword === room.primaryPassword
        });

        if (primaryPassword !== room.primaryPassword) {
            console.log('Primary password mismatch');
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid primary password' 
            });
        }

        if (room.secondaryPassword && secondaryPassword !== room.secondaryPassword) {
            console.log('Secondary password mismatch');
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid secondary password' 
            });
        }

        // Check if user is already pending admission
        const pendingMember = room.pendingMembers.find(member => member.username === username);
        if (pendingMember) {
            return res.status(400).json({ 
                success: false, 
                message: 'Your admission request is pending approval' 
            });
        }

        // If owner approval is required, add to pending members
        if (room.admissionType === 'owner_approval' && username !== room.owner) {
            room.pendingMembers.push({ username });
            await room.save();

            // Emit real-time notification to room members
            io.to(roomCode).emit('admissionRequired', {
                username: username,
                requestedAt: new Date(),
                admissionType: room.admissionType
            });

            return res.json({
                success: true,
                message: 'Admission request sent. Waiting for owner approval.',
                status: 'pending'
            });
        }

        // If democratic voting is required, add to pending members
        if (room.admissionType === 'democratic_voting' && username !== room.owner) {
            room.pendingMembers.push({ username });
            await room.save();

            // Emit real-time notification to room members
            io.to(roomCode).emit('admissionRequired', {
                username: username,
                requestedAt: new Date(),
                admissionType: room.admissionType
            });

            return res.json({
                success: true,
                message: 'Admission request sent. Waiting for member votes.',
                status: 'pending'
            });
        }

        // Direct admission (owner or no approval required)
        room.addMember(username);
        await room.save();

        console.log('User successfully joined room:', username);

        res.json({
            success: true,
            message: 'Successfully joined the room',
            status: 'joined',
            room: {
                roomCode: room.roomCode,
                name: room.name,
                description: room.description,
                owner: room.owner,
                memberCount: room.members.length
            }
        });

    } catch (error) {
        console.error('Room join error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error' 
        });
    }
});

// Export chat history as PDF
router.get('/:roomCode/export', async (req, res) => {
    try {
        const { roomCode } = req.params;
        const { format } = req.query; // 'download' or 'base64'
        
        // Find room
        const room = await Room.findOne({ roomCode });
        if (!room) {
            return res.status(404).json({ 
                success: false, 
                message: 'Room not found' 
            });
        }

        // Fetch messages for this room
        const messages = await Message.find({ 
            roomId: room._id, 
            isDeleted: false 
        }).sort({ timestamp: 1 }).lean();

        // Check if user has access to the room
        let hasAccess = false;
        
        if (room.isDemoRoom) {
            // Demo rooms allow anyone to export
            hasAccess = true;
        } else {
            // Regular rooms require authentication and membership
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1];
            
            if (!token) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Access token required for non-demo rooms' 
                });
            }
            
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const isMember = room.members.find(member => member.username === decoded.username);
                if (isMember) {
                    hasAccess = true;
                }
            } catch (err) {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Invalid or expired token' 
                });
            }
        }
        
        if (!hasAccess) {
            return res.status(403).json({ 
                success: false, 
                message: 'You must be a member to export chat history' 
            });
        }

        // Create PDF
        const doc = new PDFDocument();
        const filename = `${roomCode}_chat_export_${Date.now()}.pdf`;

        // PDF content generation
        doc.fontSize(20).text('AetherMeet Chat Export', 100, 100);
        doc.fontSize(14).text(`Room: ${room.name} (${room.roomCode})`, 100, 140);
        if (room.isDemoRoom) {
            doc.text(`Room Type: Demo Room`, 100, 160);
            doc.text(`Export Date: ${new Date().toLocaleString()}`, 100, 180);
            doc.text(`Total Messages: ${messages.length}`, 100, 200);
        } else {
            doc.text(`Export Date: ${new Date().toLocaleString()}`, 100, 160);
            doc.text(`Total Messages: ${messages.length}`, 100, 180);
        }

        let yPosition = room.isDemoRoom ? 240 : 220;
        doc.fontSize(12);

        if (messages.length === 0) {
            doc.text('No messages in this room yet.', 100, yPosition);
        } else {
            messages.forEach((message, index) => {
                if (yPosition > 700) {
                    doc.addPage();
                    yPosition = 100;
                }

                const timestamp = new Date(message.timestamp).toLocaleString();
                let messageContent = '';
                
                // Handle different message types
                if (message.messageType === 'text') {
                    messageContent = message.content || '[No content]';
                } else if (message.messageType === 'system') {
                    messageContent = message.content || '[System message]';
                } else {
                    // Media files
                    messageContent = message.mediaName ? 
                        `[${message.messageType.toUpperCase()}: ${message.mediaName}]` : 
                        `[${message.messageType.toUpperCase()} file]`;
                }
                
                doc.text(`[${timestamp}] ${message.username}: ${messageContent}`, 100, yPosition);
                yPosition += 20;
            });
        }

        // Handle different response formats
        if (format === 'base64') {
            // Collect PDF data as base64
            const chunks = [];
            
            doc.on('data', (chunk) => {
                chunks.push(chunk);
            });

            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(chunks);
                const base64Data = pdfBuffer.toString('base64');
                
                res.json({
                    success: true,
                    pdfData: base64Data,
                    filename: filename,
                    roomCode: roomCode
                });
            });
            
            doc.end();
        } else {
            // Default: stream PDF directly to response for download
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            
            doc.pipe(res);
            doc.end();
        }

    } catch (error) {
        console.error('PDF export error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error: ' + error.message 
        });
    }
});

// Get pending admissions for a room
router.get('/:roomCode/pending', authenticateToken, async (req, res) => {
    try {
        const { roomCode } = req.params;
        const currentUser = req.user.username;

        const room = await Room.findOne({ roomCode, isActive: true });
        if (!room) {
            return res.status(404).json({
                success: false,
                message: 'Room not found'
            });
        }

        // Check if user is owner or member
        const isOwner = room.owner === currentUser;
        const isMember = room.members.find(member => member.username === currentUser);
        
        if (!isOwner && !isMember) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }

        res.json({
            success: true,
            pending: room.pendingMembers || []
        });

    } catch (error) {
        console.error('Get pending admissions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get pending admissions'
        });
    }
});

// Approve or deny admission request
router.post('/:roomCode/admission/:username', authenticateToken, async (req, res) => {
    try {
        const { roomCode, username } = req.params;
        const { decision } = req.body; // 'admit' or 'deny'
        const currentUser = req.user.username;

        const room = await Room.findOne({ roomCode, isActive: true });
        if (!room) {
            return res.status(404).json({
                success: false,
                message: 'Room not found'
            });
        }

        // Check authorization
        const isOwner = room.owner === currentUser;
        const isMember = room.members.find(member => member.username === currentUser);
        
        if (!isOwner && (!isMember || room.admissionType !== 'democratic_voting')) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }

        const pendingIndex = room.pendingMembers.findIndex(member => member.username === username);
        if (pendingIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'No pending request found'
            });
        }

        if (room.admissionType === 'owner_approval' && isOwner) {
            // Owner approval
            room.pendingMembers.splice(pendingIndex, 1);

            if (decision === 'admit') {
                room.addMember(username);
                
                // Notify all room members
                io.to(roomCode).emit('userAdmitted', {
                    username: username,
                    memberCount: room.members.length
                });

                // Notify the admitted user
                io.emit('admissionResult', {
                    roomCode: roomCode,
                    username: username,
                    result: 'admitted'
                });
            } else {
                // Notify the denied user
                io.emit('admissionResult', {
                    roomCode: roomCode,
                    username: username,
                    result: 'denied'
                });
            }

            await room.save();

            return res.json({
                success: true,
                message: `User ${decision === 'admit' ? 'admitted' : 'denied'}`
            });

        } else if (room.admissionType === 'democratic_voting' && isMember) {
            // Democratic voting
            const pendingMember = room.pendingMembers[pendingIndex];
            
            // Check if user already voted
            const existingVote = pendingMember.votes.find(vote => vote.voter === currentUser);
            if (existingVote) {
                existingVote.decision = decision;
            } else {
                pendingMember.votes.push({
                    voter: currentUser,
                    decision: decision
                });
            }

            await room.save();

            // Check if enough votes (simple majority of current members)
            const admitVotes = pendingMember.votes.filter(vote => vote.decision === 'admit').length;
            const denyVotes = pendingMember.votes.filter(vote => vote.decision === 'deny').length;
            const totalVotes = admitVotes + denyVotes;
            const requiredVotes = Math.ceil(room.members.length / 2);

            if (totalVotes >= requiredVotes) {
                const finalDecision = admitVotes > denyVotes ? 'admit' : 'deny';
                
                // Remove from pending
                room.pendingMembers.splice(pendingIndex, 1);

                if (finalDecision === 'admit') {
                    room.addMember(username);
                    
                    // Notify all room members
                    io.to(roomCode).emit('userAdmitted', {
                        username: username,
                        memberCount: room.members.length,
                        voteResult: { admit: admitVotes, deny: denyVotes, total: totalVotes }
                    });

                    // Notify the admitted user
                    io.emit('admissionResult', {
                        roomCode: roomCode,
                        username: username,
                        result: 'admitted'
                    });
                } else {
                    // Notify the denied user
                    io.emit('admissionResult', {
                        roomCode: roomCode,
                        username: username,
                        result: 'denied'
                    });
                }

                await room.save();

                return res.json({
                    success: true,
                    message: `Voting complete. User ${finalDecision === 'admit' ? 'admitted' : 'denied'}`,
                    result: finalDecision,
                    voteResult: { admit: admitVotes, deny: denyVotes, total: totalVotes }
                });
            } else {
                // Update vote status for room members
                io.to(roomCode).emit('voteUpdate', {
                    username: username,
                    voteResult: { admit: admitVotes, deny: denyVotes, total: totalVotes },
                    requiredVotes: requiredVotes
                });

                return res.json({
                    success: true,
                    message: 'Vote recorded',
                    voteResult: { admit: admitVotes, deny: denyVotes, total: totalVotes, required: requiredVotes }
                });
            }
        } else {
            return res.status(403).json({
                success: false,
                message: 'Not authorized for this action'
            });
        }

    } catch (error) {
        console.error('Admission decision error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process admission decision'
        });
    }
});

// Remove user from room (owner only)
router.delete('/:roomCode/members/:username', authenticateToken, async (req, res) => {
    try {
        const { roomCode, username } = req.params;
        const currentUser = req.user.username;

        const room = await Room.findOne({ roomCode, isActive: true });
        if (!room) {
            return res.status(404).json({
                success: false,
                message: 'Room not found'
            });
        }

        // Only room owner can remove users
        if (room.owner !== currentUser) {
            return res.status(403).json({
                success: false,
                message: 'Only the room owner can remove users'
            });
        }

        // Cannot remove owner
        if (username === room.owner) {
            return res.status(400).json({
                success: false,
                message: 'Cannot remove the room owner'
            });
        }

        // Check if user is actually a member
        const memberIndex = room.members.findIndex(member => member.username === username);
        if (memberIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'User is not a member of this room'
            });
        }

        // Remove user from room
        room.members.splice(memberIndex, 1);
        await room.save();

        // Emit real-time notifications
        io.to(roomCode).emit('userRemoved', {
            username: username,
            removedBy: currentUser,
            memberCount: room.members.length
        });

        // Notify the removed user specifically
        io.emit('removedFromRoom', {
            roomCode: roomCode,
            username: username,
            removedBy: currentUser
        });

        res.json({
            success: true,
            message: `User ${username} has been removed from the room`,
            memberCount: room.members.length
        });

    } catch (error) {
        console.error('Remove user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove user from room'
        });
    }
});

return router;
};
