// Room JavaScript with Socket.IO

// Check if this is a demo room
const urlParams = new URLSearchParams(window.location.search);
const isDemoRoom = urlParams.get('demo') === 'true';

// Get authentication data and validate
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

// Authentication check (skip for demo rooms)
if (!isDemoRoom && !token) {
    window.location.href = '/';
}

// Demo room user setup
if (isDemoRoom) {
    // Generate a guest username for demo users
    const guestUser = {
        username: 'Guest' + Math.floor(Math.random() * 10000),
        id: 'demo-' + Date.now()
    };
    
    // Store demo user temporarily
    localStorage.setItem('demoUser', JSON.stringify(guestUser));
}

// Socket.IO connection
const socket = isDemoRoom ? io({
    query: {
        demo: 'true'
    }
}) : io({
    auth: {
        token: token
    }
});

// DOM Elements
const roomName = document.getElementById('roomName');
const roomDescription = document.getElementById('roomDescription');
const roomCodeDisplay = document.getElementById('roomCode');
const memberCount = document.getElementById('memberCount');
const ownerInfo = document.getElementById('ownerInfo');
const membersList = document.getElementById('membersList');
const pendingAdmissions = document.getElementById('pendingAdmissions');
const pendingList = document.getElementById('pendingList');
const chatMessages = document.getElementById('chatMessages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const shareLinkBtn = document.getElementById('shareLinkBtn');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');

// Media elements
const mediaUpload = document.getElementById('mediaUpload');
const audioRecordBtn = document.getElementById('audioRecordBtn');
const audioRecording = document.getElementById('audioRecording');
const stopRecording = document.getElementById('stopRecording');
const cancelRecording = document.getElementById('cancelRecording');
const recordingTime = document.getElementById('recordingTime');
const uploadProgress = document.getElementById('uploadProgress');
const uploadStatus = document.getElementById('uploadStatus');
const uploadBar = document.getElementById('uploadBar');

// Modals
const leaveRoomModal = document.getElementById('leaveRoomModal');
const admissionModal = document.getElementById('admissionModal');
const shareLinkModal = document.getElementById('shareLinkModal');

// Room state
let currentRoom = null;
let isOwner = false;

// Media state
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingInterval = null;

// Initialize room
document.addEventListener('DOMContentLoaded', () => {
    // Join the room
    socket.emit('joinRoom', roomCode);
});

// Socket event handlers
socket.on('connect', () => {
    statusText.textContent = 'Connected';
    connectionStatus.className = 'connection-status connected';
});

socket.on('disconnect', () => {
    statusText.textContent = 'Disconnected';
    connectionStatus.className = 'connection-status disconnected';
});

socket.on('roomJoined', (roomInfo) => {
    currentRoom = roomInfo;
    
    // Get the current user (demo or authenticated)
    const currentUser = isDemoRoom ? JSON.parse(localStorage.getItem('demoUser') || '{}') : user;
    isOwner = roomInfo.owner === currentUser.username;
    
    // Update room info
    roomName.textContent = roomInfo.name;
    roomDescription.textContent = roomInfo.description || '';
    roomCodeDisplay.textContent = `Code: ${roomInfo.roomCode}`;
    memberCount.textContent = `Members: ${roomInfo.members.length}`;
    ownerInfo.textContent = `Owner: ${roomInfo.owner}`;
    
    // Update members list
    updateMembersList(roomInfo.members);
    
    // Update leave button text based on room type
    if (isDemoRoom) {
        leaveRoomBtn.textContent = 'Leave Demo Room';
    } else if (isOwner) {
        leaveRoomBtn.textContent = 'Leave Room (Owner)';
    } else {
        leaveRoomBtn.textContent = 'Leave Room';
    }
    
    // Fetch and display pending admissions immediately on room join
    if (isOwner || roomInfo.admissionType === 'democratic_voting') {
        fetchPendingAdmissions();
    }
});

socket.on('messageHistory', (messages) => {
    chatMessages.innerHTML = '';
    messages.forEach(message => {
        displayMessage(message);
    });
    scrollToBottom();
});

socket.on('newMessage', (message) => {
    displayMessage(message);
    scrollToBottom();
});

socket.on('userJoined', (data) => {
    displaySystemMessage(`${data.username} joined the room`);
    memberCount.textContent = `Members: ${data.memberCount}`;
    
    // Update members list if we have room info
    if (currentRoom) {
        // Check if user already exists to prevent duplicates
        const existingMember = currentRoom.members.find(m => m.username === data.username);
        if (!existingMember) {
            currentRoom.members.push({ username: data.username, joinedAt: new Date() });
            updateMembersList(currentRoom.members);
        }
    }
});

socket.on('userLeft', (data) => {
    displaySystemMessage(`${data.username} left the room`);
    memberCount.textContent = `Members: ${data.memberCount}`;
    
    // Update members list
    if (currentRoom) {
        currentRoom.members = currentRoom.members.filter(member => member.username !== data.username);
        updateMembersList(currentRoom.members);
    }
});

socket.on('userRemoved', (data) => {
    displaySystemMessage(`${data.username} was removed from the room by ${data.removedBy}`);
    memberCount.textContent = `Members: ${data.memberCount}`;
    
    // Update members list
    if (currentRoom) {
        currentRoom.members = currentRoom.members.filter(member => member.username !== data.username);
        updateMembersList(currentRoom.members);
    }
});

socket.on('removedFromRoom', (data) => {
    const currentUser = isDemoRoom ? JSON.parse(localStorage.getItem('demoUser') || '{}') : user;
    if (data.username === currentUser.username) {
        alert(`You have been removed from the room by ${data.removedBy}`);
        if (isDemoRoom) {
            window.location.href = '/';
        } else {
            window.location.href = '/dashboard';
        }
    }
});

socket.on('userAdmitted', (data) => {
    displaySystemMessage(`${data.username} was admitted to the room`);
    memberCount.textContent = `Members: ${data.memberCount}`;
    
    // Add the admitted user to local members list
    if (currentRoom) {
        // Check if user already exists to prevent duplicates
        const existingMember = currentRoom.members.find(m => m.username === data.username);
        if (!existingMember) {
            currentRoom.members.push({ username: data.username, joinedAt: new Date() });
            updateMembersList(currentRoom.members);
        }
    }
    
    // Refresh pending admissions to remove the admitted user
    setTimeout(() => {
        fetchPendingAdmissions();
    }, 100);
});

socket.on('admissionRequired', (data) => {
    // Show notification and update pending list in real-time
    if (isOwner || currentRoom.admissionType === 'democratic_voting') {
        showAdmissionNotification(data);
        // Immediately fetch the updated pending list to show the new request
        setTimeout(() => {
            fetchPendingAdmissions();
        }, 100);
    }
});

socket.on('pendingAdmissions', (pending) => {
    updatePendingAdmissions(pending);
});

socket.on('voteUpdate', (data) => {
    displaySystemMessage(`Vote update for ${data.username}: ${data.voteResult.admit} admit, ${data.voteResult.deny} deny (${data.requiredVotes} required)`);
    // Immediately refresh pending list to show updated vote counts
    setTimeout(() => {
        fetchPendingAdmissions();
    }, 100);
});

socket.on('ownerTransfer', (data) => {
    displaySystemMessage(`Room ownership transferred from ${data.oldOwner} to ${data.newOwner}`);
    
    // Update owner info
    if (currentRoom) {
        currentRoom.owner = data.newOwner;
        ownerInfo.textContent = `Owner: ${data.newOwner}`;
        isOwner = data.newOwner === user.username;
        
        if (isOwner) {
            leaveRoomBtn.textContent = 'Leave Room (Owner)';
        }
    }
});

socket.on('roomDestroyed', (data) => {
    displaySystemMessage(`Room destroyed: ${data.reason}`);
    setTimeout(() => {
        alert(`Room has been destroyed: ${data.reason}`);
        window.location.href = isDemoRoom ? '/' : '/dashboard';
    }, 2000);
});

socket.on('roomEmpty', (data) => {
    displaySystemMessage(`Room is now empty but remains active. You can invite others to rejoin.`);
});

socket.on('admissionResult', (data) => {
    if (data.username === user.username) {
        if (data.result === 'admitted') {
            alert('You have been admitted to the room!');
            // If we're already on the room page, just refresh to show the room content
            if (window.location.pathname.includes('/room/')) {
                window.location.reload();
            } else {
                window.location.href = `/room/${data.roomCode}`;
            }
        } else {
            alert('Your admission request was denied.');
            window.location.href = '/dashboard';
        }
    }
});

socket.on('error', (data) => {
    alert(`Error: ${data.message}`);
    if (data.message.includes('Cannot join room')) {
        window.location.href = '/dashboard';
    }
});

// Message form submission
messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const content = messageInput.value.trim();
    if (content) {
        sendMessage(content);
        messageInput.value = '';
    }
});

// Media upload event listener
mediaUpload.addEventListener('change', handleMediaUpload);

// Audio recording event listeners
audioRecordBtn.addEventListener('click', startAudioRecording);
stopRecording.addEventListener('click', stopAudioRecording);
cancelRecording.addEventListener('click', cancelAudioRecording);

// Share link event listeners
shareLinkBtn.addEventListener('click', showShareLink);

// Use more specific selectors to avoid ID conflicts
document.addEventListener('click', (e) => {
    // Handle copy link button in share modal
    if (e.target.id === 'copyLinkBtn' && e.target.closest('#shareLinkModal')) {
        copyShareLink();
    }
    // Handle copy code button in share modal  
    if (e.target.id === 'copyCodeBtn' && e.target.closest('#shareLinkModal')) {
        copyRoomCode();
    }
});

// Modal helper functions
function showModal(modal) {
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeModal(modal) {
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Share link functions
function showShareLink() {
    const currentUrl = window.location.origin;
    const shareUrl = `${currentUrl}/join/${roomCode}`;
    document.getElementById('shareLink').textContent = shareUrl;
    showModal(shareLinkModal);
}

function copyShareLink() {
    const shareLink = document.getElementById('shareLink').textContent;
    
    // Try modern clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(shareLink).then(() => {
            showNotification('✅ Share link copied to clipboard!');
        }).catch(() => {
            fallbackCopyTextToClipboard(shareLink, 'share link');
        });
    } else {
        fallbackCopyTextToClipboard(shareLink, 'share link');
    }
}

function copyRoomCode() {
    // Try modern clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(roomCode).then(() => {
            showNotification('✅ Room code copied to clipboard!');
        }).catch(() => {
            fallbackCopyTextToClipboard(roomCode, 'room code');
        });
    } else {
        fallbackCopyTextToClipboard(roomCode, 'room code');
    }
}

function fallbackCopyTextToClipboard(text, itemName) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showNotification(`✅ ${itemName.charAt(0).toUpperCase() + itemName.slice(1)} copied to clipboard!`);
        } else {
            showError(`Failed to copy ${itemName}`);
        }
    } catch (err) {
        showError(`Failed to copy ${itemName}`);
    }
    
    document.body.removeChild(textArea);
}

function showNotification(message) {
    const notificationDiv = document.createElement('div');
    notificationDiv.className = 'fixed top-4 right-4 bg-green-500 text-white p-3 border-2 border-black font-mono text-sm z-50';
    notificationDiv.style.boxShadow = '3px 3px 0px 0px #000000';
    notificationDiv.textContent = message;
    
    document.body.appendChild(notificationDiv);
    
    setTimeout(() => {
        if (notificationDiv.parentNode) {
            notificationDiv.parentNode.removeChild(notificationDiv);
        }
    }, 3000);
}

// Message handling
function sendMessage(content, type = 'text', mediaData = null) {
    const messageData = {
        content: content.trim(),
        messageType: type,
        timestamp: new Date()
    };

    if (mediaData) {
        messageData.mediaUrl = mediaData.url;
        messageData.mediaName = mediaData.name;
        messageData.mediaSize = mediaData.size;
        if (type === 'audio') {
            messageData.audioDuration = mediaData.duration;
        }
    }

    socket.emit('sendMessage', messageData);
}

// Media handling functions
function handleMediaUpload() {
    const file = mediaUpload.files[0];
    if (!file) return;

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
        showError('File size must be less than 10MB');
        mediaUpload.value = '';
        return;
    }

    // Determine file type
    let messageType = 'file';
    if (file.type.startsWith('image/')) {
        messageType = 'image';
    } else if (file.type.startsWith('video/')) {
        messageType = 'video';
    } else if (file.type.startsWith('audio/')) {
        messageType = 'audio';
    }

    uploadFile(file, messageType);
}

function uploadFile(file, messageType) {
    const formData = new FormData();
    formData.append('media', file);

    // Show upload progress
    uploadProgress.style.display = 'block';
    uploadStatus.textContent = 'Uploading...';
    uploadBar.style.width = '0%';

    // Build headers - only include Authorization for non-demo users
    const headers = {};
    if (!isDemoRoom) {
        const token = localStorage.getItem('token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
    }

    fetch('/api/media/upload', {
        method: 'POST',
        headers: headers,
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const mediaData = {
                url: data.media.url,
                name: data.media.originalName,
                size: data.media.size
            };

            const messageContent = file.name;
            sendMessage(messageContent, messageType, mediaData);
            
            uploadStatus.textContent = 'Upload complete!';
            uploadBar.style.width = '100%';
            
            setTimeout(() => {
                uploadProgress.style.display = 'none';
            }, 2000);
        } else {
            throw new Error(data.message || 'Upload failed');
        }
    })
    .catch(error => {
        showError('Failed to upload file: ' + error.message);
        uploadStatus.textContent = 'Upload failed';
        uploadBar.style.width = '0%';
        
        setTimeout(() => {
            uploadProgress.style.display = 'none';
        }, 3000);
    })
    .finally(() => {
        mediaUpload.value = '';
    });
}

// Audio recording functions
async function startAudioRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        recordingStartTime = Date.now();
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
            
            // Create audio file for upload
            const audioFile = new File([audioBlob], `audio-${Date.now()}.webm`, {
                type: 'audio/webm'
            });
            
            // Upload the audio file
            uploadAudioFile(audioFile, duration);
            
            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        
        // Update UI
        audioRecordBtn.style.display = 'none';
        audioRecording.style.display = 'flex';
        
        // Start recording timer
        updateRecordingTime();
        recordingInterval = setInterval(updateRecordingTime, 1000);
        
    } catch (error) {
        showError('Failed to start recording. Please check microphone permissions');
    }
}

function stopAudioRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        clearInterval(recordingInterval);
        resetRecordingUI();
    }
}

function cancelAudioRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        audioChunks = [];
        clearInterval(recordingInterval);
        resetRecordingUI();
    }
}

function resetRecordingUI() {
    audioRecordBtn.style.display = 'block';
    audioRecording.style.display = 'none';
    recordingTime.textContent = '0:00';
}

function updateRecordingTime() {
    if (recordingStartTime) {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        recordingTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

function uploadAudioFile(audioFile, duration) {
    const formData = new FormData();
    formData.append('media', audioFile);

    uploadProgress.style.display = 'block';
    uploadStatus.textContent = 'Uploading audio...';
    uploadBar.style.width = '0%';

    // Build headers - only include Authorization for non-demo users
    const headers = {};
    if (!isDemoRoom) {
        const token = localStorage.getItem('token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
    }

    fetch('/api/media/upload', {
        method: 'POST',
        headers: headers,
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const mediaData = {
                url: data.media.url,
                name: data.media.originalName,
                size: data.media.size,
                duration: duration
            };

            sendMessage('🎙️ Audio message', 'audio', mediaData);
            
            uploadStatus.textContent = 'Audio uploaded!';
            uploadBar.style.width = '100%';
            
            setTimeout(() => {
                uploadProgress.style.display = 'none';
            }, 2000);
        } else {
            throw new Error(data.message || 'Upload failed');
        }
    })
    .catch(error => {
        showError('Failed to upload audio: ' + error.message);
        uploadStatus.textContent = 'Upload failed';
        uploadBar.style.width = '0%';
        
        setTimeout(() => {
            uploadProgress.style.display = 'none';
        }, 3000);
    });
}

// Utility functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Export PDF
exportPdfBtn.addEventListener('click', async () => {
    // Show options modal
    const choice = confirm('Choose export option:\nOK = Download PDF immediately\nCancel = Save to Personal Notes');
    
    if (choice) {
        // Download PDF immediately
        await downloadPdf();
    } else {
        // Save to notes
        await savePdfToNotes();
    }
});

async function downloadPdf() {
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // Only add authorization header for authenticated users
        if (!isDemoRoom && token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(`/api/rooms/${roomCode}/export`, {
            method: 'GET',
            headers: headers
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${roomCode}_chat_export.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showNotification('✅ PDF exported successfully!');
        } else {
            const data = await response.json();
            showError(`Failed to export PDF: ${data.message}`);
        }
    } catch (error) {
        showError('Failed to export PDF. Please try again');
    }
}

async function savePdfToNotes() {
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // Only add authorization header for authenticated users
        if (!isDemoRoom && token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(`/api/rooms/${roomCode}/export?format=base64`, {
            method: 'GET',
            headers: headers
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                // Store PDF data in session storage and redirect to notes page
                sessionStorage.setItem('pendingPdfData', data.pdfData);
                sessionStorage.setItem('pendingRoomCode', data.roomCode);
                
                // Open notes page in new tab or redirect
                const notesUrl = '/notes?action=save-pdf';
                if (confirm('PDF ready to save to notes. Open notes page?\nOK = Open in new tab\nCancel = Redirect current page')) {
                    window.open(notesUrl, '_blank');
                } else {
                    window.location.href = notesUrl;
                }
            } else {
                showError(`Failed to prepare PDF for notes: ${data.message}`);
            }
        } else {
            const data = await response.json();
                showError(`Failed to export PDF: ${data.message}`);
        }
    } catch (error) {
        showError('Failed to prepare PDF for notes. Please try again');
    }
}// Leave room
leaveRoomBtn.addEventListener('click', () => {
    if (isDemoRoom) {
        // Demo rooms: simple confirmation
        if (confirm('Are you sure you want to leave the demo room? Demo rooms are destroyed when the last member leaves.')) {
            socket.emit('leaveRoom', 'leave');
            // Show immediate feedback
            showNotification('Leaving demo room...');
            // Redirect after a short delay to allow socket processing
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);
        }
    } else if (isOwner) {
        // Authenticated rooms: show owner options
        showModal(leaveRoomModal);
    } else {
        // Regular authenticated user
        if (confirm('Are you sure you want to leave the room?')) {
            socket.emit('leaveRoom', 'leave');
            // Show immediate feedback
            showNotification('Leaving room...');
            // Redirect after a short delay to allow socket processing
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 1000);
        }
    }
});

// Owner leave options (only for authenticated rooms)
document.getElementById('destroyRoomBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to end the room for everyone? This cannot be undone.')) {
        socket.emit('leaveRoom', 'destroy');
        closeModal(leaveRoomModal);
    }
});

document.getElementById('transferOwnershipBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to transfer ownership and leave the room?')) {
        socket.emit('leaveRoom', 'transfer');
        closeModal(leaveRoomModal);
    }
});

document.getElementById('cancelLeaveBtn').addEventListener('click', () => {
    closeModal(leaveRoomModal);
});

// Close modal handlers
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('close')) {
        closeModal(e.target.closest('.fixed'));
    }
    if (e.target.classList.contains('fixed') && e.target.classList.contains('inset-0')) {
        closeModal(e.target);
    }
});

// Helper functions
function displayMessage(message) {
    const messageDiv = document.createElement('div');
    
    // Get current user for comparison
    const currentUser = isDemoRoom ? JSON.parse(localStorage.getItem('demoUser') || '{}') : user;
    const isOwnMessage = message.username === currentUser.username;
    
    messageDiv.className = `p-3 mb-2 border-2 border-black ${isOwnMessage ? 'bg-gray-200 ml-8' : 'bg-white mr-8'}`;
    messageDiv.style.boxShadow = '2px 2px 0px 0px #000000';
    
    const timestamp = new Date(message.timestamp).toLocaleTimeString();
    
    let messageContent = '';
    
    // Use messageType field from the message object
    const messageType = message.messageType || message.type || 'text';
    
    // If it's supposed to be a media message but has no mediaUrl, treat as text
    if ((messageType !== 'text') && !message.mediaUrl) {
        messageContent = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-sm uppercase tracking-wide">${message.username}</span>
                <span class="text-xs font-mono text-gray-600">${timestamp}</span>
            </div>
            <div class="font-mono text-sm">${escapeHtml(message.content)}</div>
            <div class="text-xs text-red-500 mt-1">⚠️ Media file not available</div>
        `;
    } else if (messageType === 'text') {
        messageContent = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-sm uppercase tracking-wide">${message.username}</span>
                <span class="text-xs font-mono text-gray-600">${timestamp}</span>
            </div>
            <div class="font-mono text-sm">${escapeHtml(message.content)}</div>
        `;
    } else if (messageType === 'image') {
        messageContent = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-sm uppercase tracking-wide">${message.username}</span>
                <span class="text-xs font-mono text-gray-600">${timestamp}</span>
            </div>
            <div class="font-mono text-sm mb-2">${escapeHtml(message.content)}</div>
            <img src="${message.mediaUrl}" alt="${message.mediaName}" 
                 class="max-w-full h-auto border-2 border-black cursor-pointer hover:border-gray-600 media-view"
                 data-url="${message.mediaUrl}"
                 style="box-shadow: 2px 2px 0px 0px #000000;">
            <div class="flex justify-between items-center mt-1">
                <div class="font-mono text-xs text-gray-500">${message.mediaName} (${formatFileSize(message.mediaSize)})</div>
                <button class="download-btn px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold border border-black"
                        data-url="${message.mediaUrl}"
                        data-filename="${message.mediaName}"
                        style="box-shadow: 1px 1px 0px 0px #000000;"
                        title="Download image">
                    💾 Download
                </button>
            </div>
        `;
    } else if (messageType === 'audio') {
        const audioContent = message.content || '🎙️ Audio message';
        const audioName = message.mediaName || 'audio.webm';
        const audioSize = message.mediaSize || 0;
        const audioDur = message.audioDuration || 0;
        
        messageContent = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-sm uppercase tracking-wide">${message.username}</span>
                <span class="text-xs font-mono text-gray-600">${timestamp}</span>
            </div>
            <div class="font-mono text-sm mb-2">${escapeHtml(audioContent)}</div>
            <div class="bg-gray-100 border-2 border-black p-2" style="box-shadow: 1px 1px 0px 0px #000000;">
                <audio controls class="w-full">
                    <source src="${message.mediaUrl}" type="audio/webm">
                    <source src="${message.mediaUrl}" type="audio/mp4">
                    <source src="${message.mediaUrl}" type="audio/wav">
                    Your browser does not support audio playback.
                </audio>
                <div class="flex justify-between items-center mt-2">
                    <div class="font-mono text-xs text-gray-500">
                        ${audioName} • Duration: ${formatDuration(audioDur)} • ${formatFileSize(audioSize)}
                    </div>
                    <button class="download-btn px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold border border-black"
                            data-url="${message.mediaUrl}"
                            data-filename="${audioName}"
                            style="box-shadow: 1px 1px 0px 0px #000000;"
                            title="Download audio file">
                        💾 Download
                    </button>
                </div>
            </div>
        `;
    } else if (messageType === 'video') {
        messageContent = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-sm uppercase tracking-wide">${message.username}</span>
                <span class="text-xs font-mono text-gray-600">${timestamp}</span>
            </div>
            <div class="font-mono text-sm mb-2">${escapeHtml(message.content)}</div>
            <video controls class="max-w-full h-auto border-2 border-black" style="box-shadow: 2px 2px 0px 0px #000000;">
                <source src="${message.mediaUrl}" type="video/mp4">
                <source src="${message.mediaUrl}" type="video/webm">
                Your browser does not support video playback.
            </video>
            <div class="flex justify-between items-center mt-1">
                <div class="font-mono text-xs text-gray-500">${message.mediaName} (${formatFileSize(message.mediaSize)})</div>
                <button class="download-btn px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold border border-black"
                        data-url="${message.mediaUrl}"
                        data-filename="${message.mediaName}"
                        style="box-shadow: 1px 1px 0px 0px #000000;"
                        title="Download video">
                    💾 Download
                </button>
            </div>
        `;
    } else if (messageType === 'file') {
        const fileName = message.mediaName || 'file';
        const fileSize = message.mediaSize || 0;
        const fileContent = message.content || `📎 ${fileName}`;
        
        messageContent = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-sm uppercase tracking-wide">${message.username}</span>
                <span class="text-xs font-mono text-gray-600">${timestamp}</span>
            </div>
            <div class="font-mono text-sm mb-2">${escapeHtml(fileContent)}</div>
            <div class="bg-gray-100 border-2 border-black p-3 hover:bg-gray-200"
                 style="box-shadow: 1px 1px 0px 0px #000000;">
                <div class="flex justify-between items-center">
                    <div>
                        <div class="font-bold text-sm">📎 ${fileName}</div>
                        <div class="font-mono text-xs text-gray-500">${formatFileSize(fileSize)}</div>
                    </div>
                    <div class="flex gap-2">
                        <button class="view-btn px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-xs font-bold border border-black"
                                data-url="${message.mediaUrl}"
                                style="box-shadow: 1px 1px 0px 0px #000000;"
                                title="Open file in new tab">
                            👁️ View
                        </button>
                        <button class="download-btn px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold border border-black"
                                data-url="${message.mediaUrl}"
                                data-filename="${fileName}"
                                style="box-shadow: 1px 1px 0px 0px #000000;"
                                title="Download file">
                            💾 Save
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    messageDiv.innerHTML = messageContent;
    chatMessages.appendChild(messageDiv);
}

function displaySystemMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'p-2 mb-2 bg-gray-100 border-2 border-gray-400 italic text-center text-sm font-mono text-gray-600';
    messageDiv.style.boxShadow = '1px 1px 0px 0px #6b7280';
    
    messageDiv.innerHTML = `
        <div>${escapeHtml(content)}</div>
    `;
    
    chatMessages.appendChild(messageDiv);
}

function updateMembersList(members) {
    membersList.innerHTML = '';
    
    members.forEach(member => {
        const memberDiv = document.createElement('div');
        memberDiv.className = `p-2 mb-2 bg-white border-2 border-black ${member.username === currentRoom.owner ? 'bg-yellow-100' : ''}`;
        memberDiv.style.boxShadow = '1px 1px 0px 0px #000000';
        
        const isOwner = member.username === currentRoom.owner;
        const canRemove = isOwner === false && user.username === currentRoom.owner;
        
        memberDiv.innerHTML = `
            <div class="flex justify-between items-center">
                <div>
                    <span class="font-mono text-sm">${member.username}</span>
                    ${isOwner ? '<span class="text-yellow-600 ml-2">👑</span>' : ''}
                </div>
                ${canRemove ? `
                    <button class="remove-user-btn px-2 py-1 bg-red-500 text-white text-xs font-bold border border-black hover:bg-red-600"
                            style="box-shadow: 1px 1px 0px 0px #000000;"
                            data-username="${member.username}"
                            title="Remove user from room">
                        ✕
                    </button>
                ` : ''}
            </div>
        `;
        
        membersList.appendChild(memberDiv);
    });
    
    // Attach event listeners to remove buttons
    document.querySelectorAll('.remove-user-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const username = this.getAttribute('data-username');
            removeUser(username);
        });
    });
}

function updatePendingAdmissions(pending) {
    if (pending.length === 0) {
        pendingAdmissions.classList.add('hidden');
        return;
    }
    
    pendingAdmissions.classList.remove('hidden');
    pendingList.innerHTML = '';
    
    pending.forEach(member => {
        const pendingDiv = document.createElement('div');
        pendingDiv.className = 'p-3 mb-2 bg-yellow-50 border-2 border-yellow-600';
        pendingDiv.style.boxShadow = '2px 2px 0px 0px #d97706';
        
        const voteInfo = currentRoom.admissionType === 'democratic_voting' 
            ? `<div class="text-xs font-mono text-gray-600">Votes: ${member.votes ? member.votes.length : 0}</div>`
            : '';
        
        pendingDiv.innerHTML = `
            <div class="font-bold text-sm uppercase tracking-wide mb-1">${member.username}</div>
            ${voteInfo}
            <div class="mt-2">
                ${getAdmissionActions(member)}
            </div>
        `;
        
        pendingList.appendChild(pendingDiv);
    });
    
    // Add event listeners to the buttons
    attachAdmissionButtonListeners();
}

// Add event listeners to admission buttons
function attachAdmissionButtonListeners() {
    // Owner approval buttons
    document.querySelectorAll('.admit-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const username = this.getAttribute('data-username');
            const action = this.getAttribute('data-action');
            approveAdmission(username, action);
        });
    });
    
    document.querySelectorAll('.deny-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const username = this.getAttribute('data-username');
            const action = this.getAttribute('data-action');
            approveAdmission(username, action);
        });
    });
    
    // Democratic voting buttons
    document.querySelectorAll('.vote-admit-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const username = this.getAttribute('data-username');
            const action = this.getAttribute('data-action');
            castVote(username, action);
        });
    });
    
    document.querySelectorAll('.vote-deny-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const username = this.getAttribute('data-username');
            const action = this.getAttribute('data-action');
            castVote(username, action);
        });
    });
}

function getAdmissionActions(member) {
    if (currentRoom.admissionType === 'owner_approval' && isOwner) {
        return `
            <button class="admit-btn bg-green-500 hover:bg-green-600 text-white px-3 py-1 border-2 border-black font-bold text-sm uppercase tracking-wide mr-2" 
                    style="box-shadow: 1px 1px 0px 0px #000000;" 
                    data-username="${member.username}" data-action="admit">Admit</button>
            <button class="deny-btn bg-red-500 hover:bg-red-600 text-white px-3 py-1 border-2 border-black font-bold text-sm uppercase tracking-wide" 
                    style="box-shadow: 1px 1px 0px 0px #000000;" 
                    data-username="${member.username}" data-action="deny">Deny</button>
        `;
    } else if (currentRoom.admissionType === 'democratic_voting') {
        const hasVoted = member.votes && member.votes.some(vote => vote.voter === user.username);
        if (hasVoted) {
            return '<div class="text-xs font-mono text-gray-600">You have voted</div>';
        }
        return `
            <button class="vote-admit-btn bg-green-500 hover:bg-green-600 text-white px-3 py-1 border-2 border-black font-bold text-sm uppercase tracking-wide mr-2" 
                    style="box-shadow: 1px 1px 0px 0px #000000;" 
                    data-username="${member.username}" data-action="admit">Vote Admit</button>
            <button class="vote-deny-btn bg-red-500 hover:bg-red-600 text-white px-3 py-1 border-2 border-black font-bold text-sm uppercase tracking-wide" 
                    style="box-shadow: 1px 1px 0px 0px #000000;" 
                    data-username="${member.username}" data-action="deny">Vote Deny</button>
        `;
    }
    return '';
}

function showAdmissionRequest(data) {
    const admissionDetails = document.getElementById('admissionDetails');
    const admissionActions = document.getElementById('admissionActions');
    
    admissionDetails.innerHTML = `
        <p><strong>${data.username}</strong> wants to join the room.</p>
        <p>Requested at: ${new Date(data.requestedAt).toLocaleString()}</p>
    `;
    
    admissionActions.innerHTML = getAdmissionActions({ username: data.username, votes: [] });
    
    openModal(admissionModal);
}

// Show admission notification without opening modal
function showAdmissionNotification(data) {
    displaySystemMessage(`${data.username} is requesting to join the room`);
    // Play notification sound if available
    playNotificationSound();
}

// Fetch pending admissions from server to refresh the list
async function fetchPendingAdmissions() {
    if (!isDemoRoom && token && currentRoom) {
        try {
            const response = await fetch(`/api/rooms/${currentRoom.roomCode}/pending`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();
            if (data.success && data.pending) {
                updatePendingAdmissions(data.pending);
            }
        } catch (error) {
            // Silent fail for pending admissions fetch
        }
    }
}

// Play notification sound
function playNotificationSound() {
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUKzn7bReFQU7k9nywHYpBSl+zPLaizsIHGS57OihUBELTKXh8bRgHQU+mt7yvHEoCCN7yvHajTsJHmW87OWhTxELTaXi8bRgGwU+m9/zvHAoBCN7yvLajzwJH2W98OSgTxEKTaXi8rNgGgU9m97zu3AoBCR8yvHajjsJH2e98eWgUBELTqfj87NhGgU9nN/zvm8pBCR8y/HajDsJH2e98eWfUBELTqfj87RhGwU9nN/zvnApBSR8y/HajDwJH2i+8eWfTxELTqfj8rRiGwU+nd/zvm8pBSR9y/HajDwKIGi+8OWfTxEMT6fj8rRiGwU+nd/zv28qBSR9y/HajDwKIGm+8OWfTxEMT6fj8rRiGwU+nt/zv3AqBSR9y/HajDwKIGq+8OWfTxEMUKfj8rNiGwU+nt/zv3AqBSV9y/HajDwKIWq+8OWfTxEMUKfj8rNiGwU/nt/zwHAqBSV9y/HajDwKIWq+8OWfThEMUKfj8rNiGwU/nt/zwHAqBSV+y/HajDwKIWq+8OWfThEMUKfj8rNjGwVAnt/zwHAqBSV+y/HajDwKIWq+8OWfThEMUKjj8rNjGwVAn9/zwHEqBSV+y/HajDwKIWq+8OWfThEMUKjj8rNjGwVAn9/zwHEqBSV+y/HajDwKIWu+8OWfThEMUKjj8rNjGwVAn9/zwHEqBSZ+y/HajDwKIWu+8OWeTREMUKjj8rNkGwVAn9/zwHEqBSZ+y/HajDwKIWu+8OWeTREMUKjj8rNkGwVAn9/zwHEqBSZ+y/HajDwKIWu+8OWeTREMUKjj8rNkGwVAn9/zwHEqBSZ+y/HajDwKIWu+8OWeTREMUKjj8rNkGwVAn9/zwHEqBSZ+y/HajDwKIWu+8OWeTREMUKjj8rNkGwVAn9/zwHEqBSZ+y/HajDwKIWu+8OWeTREMUKjj8rNkGwVAn9/zwHEqBSZ/y/HajDwKIWu+8OWeTREMUKjj8rNkGwVAoN/zwHEqBSZ/y/HajDwKIWu+8OWeTREMUKjj8rNkGwVAoN/zwHEqBSZ/y/HajDwKIWy+8OWeTREMUKjj8rNkGwVAoN/zwHEqBSZ/y/HajDwKIWy+8OWeTREMUKjj8rNkGwVAoN/zwHEqBSZ/y/HajDwKIWy+8OWeTREMUKjj8rNkGwVAoN/zwHEqBSZ/y/HajDwKIWy+8OWeTREMUKjj8rNkGwVAoN/zwHEqBSZ/y/HajDwKIWy+8OWeTREMUKjj8rNkGwVAoN/zwHEqBSZ/y/HajDwKIWy+8OWeTREMUKjj8rNkGwVAoN/zwHEqBSZ/y/HajDwKIWy+8OWeTREMUKjj8rNkGwVAoN/zwHEqBSZ/y/HajDwKIWy+8OWeTREMUKjj8Q==');
        audio.play().catch(() => {});
    } catch (error) {
        // Silent fail
    }
}

// Global functions for admission actions
window.approveAdmission = function(username, decision) {
    socket.emit('approveAdmission', { username, decision });
    closeModal(admissionModal);
    setTimeout(() => {
        fetchPendingAdmissions();
    }, 200);
};

// Remove user from room (owner only)
function removeUser(username) {
    if (!confirm(`Are you sure you want to remove ${username} from the room?`)) {
        return;
    }
    
    socket.emit('removeUser', { username });
    displaySystemMessage(`Removing ${username} from the room...`);
}

window.castVote = function(username, decision) {
    socket.emit('castVote', { username, decision });
    closeModal(admissionModal);
    setTimeout(() => {
        fetchPendingAdmissions();
    }, 200);
};

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Download file function
window.downloadFile = function(url, filename) {
    try {
        // Convert view URL to download URL
        const downloadUrl = url.replace('/api/media/file/', '/api/media/download/');
        
        // Create a temporary anchor element
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename || 'download';
        a.target = '_blank';
        a.style.display = 'none';
        
        // Append to body, click, and remove
        document.body.appendChild(a);
        a.click();
        
        // Clean up
        setTimeout(() => {
            document.body.removeChild(a);
            showNotification(`💾 Downloading ${filename}...`);
        }, 100);
    } catch (error) {
        console.error('Download error:', error);
        showError('Failed to download file');
    }
};

function showError(message) {
    // Create error notification
    const errorDiv = document.createElement('div');
    errorDiv.className = 'fixed top-4 right-4 bg-red-500 text-white p-3 border-2 border-black font-mono text-sm z-50';
    errorDiv.style.boxShadow = '3px 3px 0px 0px #000000';
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
    // Remove after 5 seconds
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 5000);
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    socket.disconnect();
});

// Event delegation for dynamically created buttons (CSP compliant)
if (chatMessages) {
    chatMessages.addEventListener('click', function(e) {
        // Handle download buttons
        const downloadBtn = e.target.closest('.download-btn');
        if (downloadBtn) {
            const url = downloadBtn.dataset.url;
            const filename = downloadBtn.dataset.filename;
            if (url && filename) {
                downloadFile(url, filename);
            }
            return;
        }
        
        // Handle view buttons
        const viewBtn = e.target.closest('.view-btn');
        if (viewBtn) {
            const url = viewBtn.dataset.url;
            if (url) {
                window.open(url, '_blank');
            }
            return;
        }
        
        // Handle media-view elements (images/videos/audio)
        const mediaView = e.target.closest('.media-view');
        if (mediaView) {
            const url = mediaView.dataset.url;
            if (url) {
                window.open(url, '_blank');
            }
            return;
        }
    });
}
