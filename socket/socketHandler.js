const jwt = require('jsonwebtoken');
const Room = require('../models/Room');
const Message = require('../models/Message');
const User = require('../models/User');
const { isRoomMember, calculateVoteResult, sanitizeInput } = require('../utils/helpers');
const { sanitizeInput: securitySanitize } = require('../middleware/security');

module.exports = (io) => {
    // Socket authentication middleware
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        const isDemoRoom = socket.handshake.query.demo === 'true';
        
        // Skip authentication for demo rooms
        if (isDemoRoom) {
            // Create a demo user for this socket
            socket.user = {
                userId: 'demo-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
                username: 'Guest' + Math.floor(Math.random() * 10000)
            };
            socket.isDemoUser = true;
            return next();
        }
        
        if (!token) {
            return next(new Error('Authentication error'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Check if user exists and session is active
            const user = await User.findById(decoded.userId);
            if (!user || !user.isTokenValid(token)) {
                return next(new Error('Session expired or invalid'));
            }

            socket.user = decoded;
            socket.token = token;
            next();
        } catch (err) {
            return next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket) => {
        // Join room
        socket.on('joinRoom', async (roomCode) => {
            try {
                const room = await Room.findOne({ roomCode, isActive: true });
                if (!room) {
                    socket.emit('error', { message: 'Room not found' });
                    return;
                }

                // Handle demo rooms differently - allow anyone to join
                if (room.isDemoRoom) {
                    // For demo rooms, automatically add user as member if not already
                    const isAlreadyMember = room.members.some(member => member.username === socket.user.username);
                    if (!isAlreadyMember) {
                        room.members.push({
                            username: socket.user.username,
                            joinedAt: new Date()
                        });
                        await room.save();
                    }
                } else {
                    // For regular rooms, check membership
                    if (!isRoomMember(room, socket.user.username)) {
                        socket.emit('error', { message: 'Cannot join room' });
                        return;
                    }
                }

                socket.join(roomCode);
                socket.currentRoom = roomCode;

                // Send room info and member list
                const roomInfo = {
                    roomCode: room.roomCode,
                    name: room.name,
                    description: room.description,
                    owner: room.owner,
                    members: room.members.map(member => ({
                        username: member.username,
                        joinedAt: member.joinedAt
                    })),
                    admissionType: room.admissionType
                };

                socket.emit('roomJoined', roomInfo);
                socket.to(roomCode).emit('userJoined', {
                    username: socket.user.username,
                    memberCount: room.members.length
                });

                // Send recent messages from separate Message collection
                const recentMessages = await Message.getRoomMessages(room._id, 50);
                socket.emit('messageHistory', recentMessages.reverse()); // Reverse to show oldest first

                // Send pending admission requests if user is owner or member
                if (room.owner === socket.user.username || room.admissionType === 'democratic_voting') {
                    socket.emit('pendingAdmissions', room.pendingMembers);
                }

            } catch (error) {
                socket.emit('error', { message: 'Failed to join room' });
            }
        });

        // Send message
        socket.on('sendMessage', async (data) => {
            try {
                const { content, messageType = 'text', mediaUrl, mediaName, mediaSize, audioDuration } = data;
                const roomCode = socket.currentRoom;

                if (!roomCode) {
                    return;
                }

                const room = await Room.findOne({ roomCode, isActive: true });
                if (!room || !isRoomMember(room, socket.user.username)) {
                    socket.emit('error', { message: 'Cannot send message' });
                    return;
                }

                let message = {
                    username: socket.user.username,
                    messageType: messageType,
                    timestamp: new Date()
                };

                // Handle different message types
                if (messageType === 'text') {
                    if (!content) {
                        socket.emit('error', { message: 'Text message content required' });
                        return;
                    }
                    
                    // Sanitize and validate content
                    let sanitizedContent = securitySanitize(content);
                    sanitizedContent = sanitizeInput(sanitizedContent);
                    
                    if (sanitizedContent.length === 0 || sanitizedContent.length > 1000) {
                        socket.emit('error', { message: 'Invalid message content (0-1000 characters allowed)' });
                        return;
                    }
                    
                    message.content = sanitizedContent;
                } else {
                    // Media message
                    if (!mediaUrl || mediaUrl === 'undefined') {
                        socket.emit('error', { message: 'Media URL required for media messages' });
                        return;
                    }
                    
                    message.mediaUrl = mediaUrl;
                    message.mediaName = mediaName || 'Untitled';
                    message.mediaSize = mediaSize || 0;
                    
                    if (messageType === 'audio' && audioDuration) {
                        message.audioDuration = audioDuration;
                    }
                    
                    // Set content for display purposes
                    if (content && content.trim()) {
                        message.content = sanitizeInput(content.trim());
                    } else if (messageType === 'audio') {
                        message.content = `🎵 Audio message (${audioDuration ? Math.round(audioDuration) + 's' : 'Unknown duration'})`;
                    } else if (messageType === 'image') {
                        message.content = `📷 Image: ${mediaName}`;
                    } else if (messageType === 'video') {
                        message.content = `🎥 Video: ${mediaName}`;
                    } else if (messageType === 'file') {
                        message.content = `📎 File: ${mediaName}`;
                    }
                }

                // Create and save message in separate collection
                const newMessage = new Message({
                    roomId: room._id,
                    username: socket.user.username,
                    messageType: messageType,
                    content: message.content,
                    mediaUrl: message.mediaUrl,
                    mediaName: message.mediaName,
                    mediaSize: message.mediaSize,
                    audioDuration: message.audioDuration,
                    timestamp: message.timestamp
                });

                await newMessage.save();

                // Broadcast message to all room members
                const messageToSend = {
                    _id: newMessage._id,
                    username: newMessage.username,
                    messageType: newMessage.messageType,
                    content: newMessage.content,
                    mediaUrl: newMessage.mediaUrl,
                    mediaName: newMessage.mediaName,
                    mediaSize: newMessage.mediaSize,
                    audioDuration: newMessage.audioDuration,
                    timestamp: newMessage.timestamp
                };
                
                io.to(roomCode).emit('newMessage', messageToSend);

            } catch (error) {
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // Handle admission request (for real-time notifications)
        socket.on('requestToJoin', async (data) => {
            try {
                const { roomCode, primaryPassword, secondaryPassword } = data;

                const room = await Room.findOne({ roomCode, isActive: true });
                if (!room) {
                    socket.emit('joinRequestResult', { 
                        success: false, 
                        message: 'Room not found' 
                    });
                    return;
                }

                // Validate passwords
                if (primaryPassword !== room.primaryPassword) {
                    socket.emit('joinRequestResult', { 
                        success: false, 
                        message: 'Invalid primary password' 
                    });
                    return;
                }

                if (room.secondaryPassword && secondaryPassword !== room.secondaryPassword) {
                    socket.emit('joinRequestResult', { 
                        success: false, 
                        message: 'Invalid secondary password' 
                    });
                    return;
                }

                // Check if already member or pending
                if (isRoomMember(room, socket.user.username)) {
                    socket.emit('joinRequestResult', { 
                        success: false, 
                        message: 'Already a member' 
                    });
                    return;
                }

                const isPending = room.pendingMembers.find(member => member.username === socket.user.username);
                if (isPending) {
                    socket.emit('joinRequestResult', { 
                        success: false, 
                        message: 'Request already pending' 
                    });
                    return;
                }

                // Add to pending members
                room.pendingMembers.push({ username: socket.user.username });
                await room.save();

                // Notify room about admission request
                io.to(roomCode).emit('admissionRequired', {
                    username: socket.user.username,
                    requestedAt: new Date(),
                    admissionType: room.admissionType
                });

                socket.emit('joinRequestResult', { 
                    success: true, 
                    message: 'Admission request sent' 
                });

            } catch (error) {
                socket.emit('joinRequestResult', { 
                    success: false, 
                    message: 'Failed to process request' 
                });
            }
        });

        // Handle owner approval
        socket.on('approveAdmission', async (data) => {
            try {
                const { username, decision } = data; // decision: 'admit' or 'deny'
                const roomCode = socket.currentRoom;

                const room = await Room.findOne({ roomCode, isActive: true });
                if (!room || room.owner !== socket.user.username) {
                    socket.emit('error', { message: 'Not authorized' });
                    return;
                }

                const pendingIndex = room.pendingMembers.findIndex(member => member.username === username);
                if (pendingIndex === -1) {
                    socket.emit('error', { message: 'No pending request found' });
                    return;
                }

                // Remove from pending
                room.pendingMembers.splice(pendingIndex, 1);

                if (decision === 'admit') {
                    // Add as member
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

            } catch (error) {
                socket.emit('error', { message: 'Failed to process approval' });
            }
        });

        // Handle removing a user (owner only)
        socket.on('removeUser', async (data) => {
            try {
                const { username } = data;
                const roomCode = socket.currentRoom;

                const room = await Room.findOne({ roomCode, isActive: true });
                if (!room || room.owner !== socket.user.username) {
                    socket.emit('error', { message: 'Only the owner can remove users' });
                    return;
                }

                // Cannot remove the owner
                if (username === room.owner) {
                    socket.emit('error', { message: 'Cannot remove the owner' });
                    return;
                }

                // Check if user is a member
                const memberExists = isRoomMember(room, username);
                if (!memberExists) {
                    socket.emit('error', { message: 'User is not a member of this room' });
                    return;
                }

                // Remove the user
                room.removeMember(username);
                await room.save();

                // Notify all room members about the removal
                io.to(roomCode).emit('userRemoved', {
                    username: username,
                    removedBy: socket.user.username,
                    memberCount: room.members.length
                });

                // Notify the removed user specifically
                io.emit('removedFromRoom', {
                    roomCode: roomCode,
                    username: username,
                    removedBy: socket.user.username
                });

            } catch (error) {
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // Handle democratic voting
        socket.on('castVote', async (data) => {
            try {
                const { username, decision } = data; // decision: 'admit' or 'deny'
                const roomCode = socket.currentRoom;

                const room = await Room.findOne({ roomCode, isActive: true });
                if (!room || !isRoomMember(room, socket.user.username)) {
                    socket.emit('error', { message: 'Not authorized to vote' });
                    return;
                }

                const pendingMember = room.pendingMembers.find(member => member.username === username);
                if (!pendingMember) {
                    socket.emit('error', { message: 'No pending request found' });
                    return;
                }

                // Check if user already voted
                const existingVote = pendingMember.votes.find(vote => vote.voter === socket.user.username);
                if (existingVote) {
                    // Update existing vote
                    existingVote.decision = decision;
                } else {
                    // Add new vote
                    pendingMember.votes.push({
                        voter: socket.user.username,
                        decision: decision
                    });
                }

                await room.save();

                // Check if enough votes (simple majority of current members)
                const voteResult = calculateVoteResult(pendingMember.votes);
                const requiredVotes = Math.ceil(room.members.length / 2);

                if (voteResult.total >= requiredVotes) {
                    // Remove from pending
                    const pendingIndex = room.pendingMembers.findIndex(member => member.username === username);
                    room.pendingMembers.splice(pendingIndex, 1);

                    if (voteResult.result === 'admit') {
                        // Add as member
                        room.addMember(username);
                        
                        // Notify all room members
                        io.to(roomCode).emit('userAdmitted', {
                            username: username,
                            memberCount: room.members.length,
                            voteResult: voteResult
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
                } else {
                    // Update vote status for room members
                    io.to(roomCode).emit('voteUpdate', {
                        username: username,
                        voteResult: voteResult,
                        requiredVotes: requiredVotes
                    });
                }

            } catch (error) {
                socket.emit('error', { message: 'Failed to cast vote' });
            }
        });

        // Handle leaving room
        socket.on('leaveRoom', async (action) => {
            try {
                const roomCode = socket.currentRoom;
                if (!roomCode) return;

                const room = await Room.findOne({ roomCode, isActive: true });
                if (!room) return;

                const username = socket.user.username;
                const isOwner = room.owner === username;

                // Check destruction rules
                const canDestroy = room.isDemoRoom || (room.destructionRules?.ownerOnlyDestroy && isOwner);

                if (isOwner && action === 'destroy' && canDestroy) {
                    // Owner chooses to destroy room (or anyone can destroy demo room)
                    room.isActive = false;
                    room.destroyedAt = new Date();
                    await room.save();

                    // Notify all members
                    io.to(roomCode).emit('roomDestroyed', {
                        reason: room.isDemoRoom ? 'Demo room ended' : 'Owner ended the room',
                        destroyedBy: username
                    });

                    // Disconnect all clients from room
                    io.in(roomCode).socketsLeave(roomCode);

                } else if (isOwner && action === 'transfer' && !room.isDemoRoom) {
                    // Owner chooses to transfer ownership (authenticated rooms only)
                    const newOwner = room.transferOwnership();
                    
                    if (newOwner) {
                        room.removeMember(username);
                        await room.save();

                        // Notify about ownership transfer
                        io.to(roomCode).emit('ownerTransfer', {
                            oldOwner: username,
                            newOwner: newOwner
                        });

                        socket.leave(roomCode);
                        socket.currentRoom = null;
                    } else {
                        // No one to transfer to, destroy room
                        room.isActive = false;
                        room.destroyedAt = new Date();
                        await room.save();

                        io.to(roomCode).emit('roomDestroyed', {
                            reason: 'No members left to transfer ownership',
                            destroyedBy: username
                        });

                        io.in(roomCode).socketsLeave(roomCode);
                    }

                } else {
                    // Regular member leaving
                    room.removeMember(username);
                    
                    // Check if room should auto-destroy when empty
                    if (room.members.length === 0) {
                        if (room.isDemoRoom || room.destructionRules?.autoDestroyOnEmpty) {
                            // Demo rooms auto-destroy when last member leaves
                            room.isActive = false;
                            room.destroyedAt = new Date();
                            await room.save();

                            io.to(roomCode).emit('roomDestroyed', {
                                reason: room.isDemoRoom ? 'Demo room ended - last member left' : 'Last member left the room'
                            });
                        } else {
                            // Authenticated rooms stay active even when empty
                            await room.save();
                            
                            io.to(roomCode).emit('roomEmpty', {
                                message: 'Room is now empty but remains active'
                            });
                        }
                    } else {
                        await room.save();
                        
                        // Notify remaining members
                        socket.to(roomCode).emit('userLeft', {
                            username: username,
                            memberCount: room.members.length
                        });
                    }

                    socket.leave(roomCode);
                    socket.currentRoom = null;
                }

            } catch (error) {
                socket.emit('error', { message: 'Failed to leave room' });
            }
        });

        // Handle disconnect
        socket.on('disconnect', () => {
            // Note: We don't automatically remove from room on disconnect
            // Users might reconnect and want to stay in the room
        });
    });
};
