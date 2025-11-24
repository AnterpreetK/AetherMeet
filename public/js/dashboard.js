// Dashboard JavaScript

// Get authentication data and validate
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || '{}');

// Simple authentication check for dashboard
if (!token) {
    window.location.href = '/';
}

// DOM Elements
const welcomeUser = document.getElementById('welcomeUser');
const logoutBtn = document.getElementById('logoutBtn');
const createInstantBtn = document.getElementById('createInstantBtn');
const createScheduledBtn = document.getElementById('createScheduledBtn');
const joinRoomForm = document.getElementById('joinRoomForm');
const myRoomsList = document.getElementById('myRoomsList');

// Modals
const instantRoomModal = document.getElementById('instantRoomModal');
const scheduledRoomModal = document.getElementById('scheduledRoomModal');
const joinRoomModal = document.getElementById('joinRoomModal');

// Forms
const instantRoomForm = document.getElementById('instantRoomForm');
const scheduledRoomForm = document.getElementById('scheduledRoomForm');
const joinRoomPasswordForm = document.getElementById('joinRoomPasswordForm');

// Error elements
const instantRoomError = document.getElementById('instantRoomError');
const scheduledRoomError = document.getElementById('scheduledRoomError');
const joinRoomError = document.getElementById('joinRoomError');

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    console.log('Dashboard DOMContentLoaded fired');
    console.log('User:', user);
    console.log('Token exists:', !!token);
    
    if (welcomeUser) {
        welcomeUser.textContent = `Welcome, ${user.username}!`;
    }
    loadMyRooms();
    
    // Check if there's a room code in the URL parameters (from shared link)
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('roomCode');
    
    if (roomCode) {
        console.log('Room code from URL:', roomCode);
        // Pre-fill the room code input and automatically trigger join process
        document.getElementById('roomCode').value = roomCode.toUpperCase();
        
        // Automatically check if room exists and show password modal
        checkAndJoinRoom(roomCode.toUpperCase());
    }
});

// Function to check room and start join process
async function checkAndJoinRoom(roomCode) {
    try {
        const response = await fetch(`/api/rooms/${roomCode}/info`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Room exists, show password modal automatically
            joinRoomPasswordForm.dataset.roomCode = roomCode;
            openModal(joinRoomModal);
        } else {
            alert(data.message || 'Room not found or not active');
        }
    } catch (error) {
        console.error('Room check error:', error);
        alert('Failed to check room. Please try again.');
    }
}

// Logout functionality
logoutBtn.addEventListener('click', async () => {
    console.log('Logout button clicked');
    try {
        // Call server logout endpoint
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        // Clear local storage and redirect (even if server call fails)
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('tokenExpiry');
        window.location.href = '/';
    }
});

// Simple logout function
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tokenExpiry');
    window.location.href = '/';
}

// Modal handling
function openModal(modal) {
    modal.classList.remove('hidden');
}

function closeModal(modal) {
    modal.classList.add('hidden');
    // Clear error messages
    const errorDiv = modal.querySelector('.bg-red-100');
    if (errorDiv) {
        errorDiv.classList.add('hidden');
        errorDiv.textContent = '';
    }
    // Reset forms
    const form = modal.querySelector('form');
    if (form) {
        form.reset();
    }
}

// Close modal handlers
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('close')) {
        closeModal(e.target.closest('.fixed'));
    }
    if (e.target.classList.contains('fixed') && e.target.classList.contains('inset-0')) {
        closeModal(e.target);
    }
});

// Create room buttons
createInstantBtn.addEventListener('click', () => {
    console.log('Create Instant Room button clicked');
    openModal(instantRoomModal);
});

createScheduledBtn.addEventListener('click', () => {
    console.log('Create Scheduled Room button clicked');
    openModal(scheduledRoomModal);
    // Set minimum datetime to current time
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('scheduledTime').min = now.toISOString().slice(0, 16);
});

// Create instant room
instantRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(instantRoomForm);
    const roomData = {
        name: formData.get('name'),
        description: formData.get('description'),
        primaryPassword: formData.get('primaryPassword'),
        secondaryPassword: formData.get('secondaryPassword'),
        admissionType: formData.get('admissionType')
    };
    
    try {
        const response = await fetch('/api/rooms/instant', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(roomData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeModal(instantRoomModal);
            alert(`Room created successfully! Room Code: ${data.room.roomCode}`);
            loadMyRooms();
            // Navigate to room
            window.location.href = `/room/${data.room.roomCode}`;
        } else {
            showError(instantRoomError, data.message);
        }
    } catch (error) {
        console.error('Room creation error:', error);
        showError(instantRoomError, 'Failed to create room. Please try again.');
    }
});

// Create scheduled room
scheduledRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(scheduledRoomForm);
    const roomData = {
        name: formData.get('name'),
        description: formData.get('description'),
        primaryPassword: formData.get('primaryPassword'),
        secondaryPassword: formData.get('secondaryPassword'),
        admissionType: formData.get('admissionType'),
        scheduledTime: formData.get('scheduledTime')
    };
    
    // Validate scheduled time
    const scheduledDate = new Date(roomData.scheduledTime);
    if (scheduledDate <= new Date()) {
        showError(scheduledRoomError, 'Scheduled time must be in the future.');
        return;
    }
    
    try {
        const response = await fetch('/api/rooms/schedule', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(roomData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            closeModal(scheduledRoomModal);
            alert(`Room scheduled successfully! Room Code: ${data.room.roomCode}\\nScheduled for: ${new Date(data.room.scheduledTime).toLocaleString()}`);
            loadMyRooms();
        } else {
            showError(scheduledRoomError, data.message);
        }
    } catch (error) {
        console.error('Room scheduling error:', error);
        showError(scheduledRoomError, 'Failed to schedule room. Please try again.');
    }
});

// Join room form
joinRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const roomCode = document.getElementById('roomCode').value.toUpperCase();
    
    if (roomCode.length !== 6) {
        alert('Room code must be exactly 6 characters.');
        return;
    }
    
    // Use the same function for manual joins
    await checkAndJoinRoom(roomCode);
});

// Join room with password
joinRoomPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(joinRoomPasswordForm);
    const joinData = {
        primaryPassword: formData.get('primaryPassword'),
        secondaryPassword: formData.get('secondaryPassword')
    };
    
    const roomCode = joinRoomPasswordForm.dataset.roomCode;
    
    try {
        const response = await fetch(`/api/rooms/${roomCode}/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(joinData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (data.status === 'joined') {
                closeModal(joinRoomModal);
                window.location.href = `/room/${roomCode}`;
            } else if (data.status === 'pending') {
                closeModal(joinRoomModal);
                alert(data.message);
            }
        } else {
            showError(joinRoomError, data.message);
        }
    } catch (error) {
        console.error('Join room error:', error);
        showError(joinRoomError, 'Failed to join room. Please try again.');
    }
});

// Load user's rooms
async function loadMyRooms() {
    try {
        // This would need to be implemented in the backend
        // For now, we'll show a placeholder
        myRoomsList.innerHTML = `
            <div class="bg-gray-100 border-2 border-black p-4" style="box-shadow: 2px 2px 0px 0px #000000;">
                <h4 class="font-bold uppercase tracking-wide text-sm">No rooms yet</h4>
                <p class="text-xs text-gray-600 font-mono mt-1">Create your first room to get started!</p>
            </div>
        `;
    } catch (error) {
        console.error('Failed to load rooms:', error);
        myRoomsList.innerHTML = `
            <div class="bg-red-100 border-2 border-red-500 p-4 text-red-800" style="box-shadow: 2px 2px 0px 0px #dc2626;">
                <p class="font-mono text-sm">Failed to load rooms.</p>
            </div>
        `;
    }
}

// Helper function to show error messages
function showError(errorElement, message) {
    errorElement.textContent = message;
    errorElement.classList.remove('hidden');
}
