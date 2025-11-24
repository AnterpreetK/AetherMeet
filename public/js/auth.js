// Authentication JavaScript for index page

// Prevent multiple initializations
if (!window.authInitialized) {
    window.authInitialized = true;

// DOM Elements (only if they exist on this page)
const loginBtn2 = document.getElementById('loginBtn2'); // Hero section login button
const registerBtn = document.getElementById('registerBtn'); // Hero section register button
const headerLoginBtn = document.getElementById('headerLoginBtn'); // Header login button
const headerGetStartedBtn = document.getElementById('headerGetStartedBtn'); // Header get started button
const footerLoginBtn = document.getElementById('footerLoginBtn'); // Footer login button
const footerRegisterBtn = document.getElementById('footerRegisterBtn'); // Footer register button
const loginModal = document.getElementById('loginModal');
const registerModal = document.getElementById('registerModal');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');

// Only add event listeners if modals exist (on home page)
if (loginModal && registerModal) {

// Check if user is already logged in (only on home/login page)
if (localStorage.getItem('token') && window.location.pathname === '/') {
    window.location.href = '/dashboard';
}

// Modal handling
function openModal(modal) {
    modal.classList.remove('hidden');
}

function closeModal(modal) {
    modal.classList.add('hidden');
    // Clear error messages
    const errorDiv = modal.querySelector('.hidden');
    if (errorDiv && errorDiv.classList.contains('bg-red-100')) {
        errorDiv.classList.add('hidden');
        errorDiv.textContent = '';
    }
}

// Event listeners for modal buttons - add them if the elements exist
if (loginBtn2) loginBtn2.addEventListener('click', () => openModal(loginModal));
if (registerBtn) registerBtn.addEventListener('click', () => openModal(registerModal));
if (headerLoginBtn) headerLoginBtn.addEventListener('click', () => openModal(loginModal));
if (headerGetStartedBtn) headerGetStartedBtn.addEventListener('click', () => openModal(registerModal));
if (footerLoginBtn) footerLoginBtn.addEventListener('click', () => openModal(loginModal));
if (footerRegisterBtn) footerRegisterBtn.addEventListener('click', () => openModal(registerModal));

// Close modal when clicking close button or outside modal
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('close')) {
        closeModal(e.target.closest('.fixed'));
    }
    if (e.target.classList.contains('fixed') && e.target.classList.contains('inset-0')) {
        closeModal(e.target);
    }
});

// Login form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Store token and user info with expiration
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            localStorage.setItem('tokenExpiry', data.expiresAt);
            
            // Set up auto-logout timer
            setupAutoLogout(data.expiresAt);
            
            // Check if there's a pending room code
            if (window.pendingRoomCode && window.pendingRoomCode.trim()) {
                // Redirect to dashboard with room code
                window.location.href = `/dashboard?roomCode=${window.pendingRoomCode}`;
            } else {
                // Redirect to dashboard
                window.location.href = '/dashboard';
            }
        } else {
            showError(loginError, data.message);
        }
    } catch (error) {
        console.error('Login error:', error);
        showError(loginError, 'An error occurred during login. Please try again.');
    }
});

// Register form submission
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
    // Basic validation
    if (password.length < 6) {
        showError(registerError, 'Password must be at least 6 characters long.');
        return;
    }
    
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Store token and user info with expiration
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            localStorage.setItem('tokenExpiry', data.expiresAt);
            
            // Set up auto-logout timer
            setupAutoLogout(data.expiresAt);
            
            // Check if there's a pending room code
            if (window.pendingRoomCode && window.pendingRoomCode.trim()) {
                // Redirect to dashboard with room code
                window.location.href = `/dashboard?roomCode=${window.pendingRoomCode}`;
            } else {
                // Redirect to dashboard
                window.location.href = '/dashboard';
            }
        } else {
            showError(registerError, data.message);
        }
    } catch (error) {
        console.error('Registration error:', error);
        showError(registerError, 'An error occurred during registration. Please try again.');
    }
});

} // End of DOM elements check

// Helper function to show error messages
function showError(errorElement, message) {
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.remove('hidden');
    }
}

// Session management functions
function logout() {
    const token = localStorage.getItem('token');
    
    if (token) {
        // Call logout endpoint
        fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }).then(() => {
            clearSession();
        }).catch(() => {
            // Even if logout fails on server, clear local session
            clearSession();
        });
    } else {
        clearSession();
    }
}

function clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('tokenExpiry');
    
    // Clear any auto-logout timer
    if (window.autoLogoutTimer) {
        clearTimeout(window.autoLogoutTimer);
    }
    
    // Redirect to home page
    window.location.href = '/';
}

function setupAutoLogout(expiresAt) {
    if (!expiresAt) return;
    
    const expirationTime = new Date(expiresAt).getTime();
    const currentTime = Date.now();
    const timeUntilExpiry = expirationTime - currentTime;
    
    // If token is already expired, logout immediately
    if (timeUntilExpiry <= 0) {
        clearSession();
        return;
    }
    
    // Set timer to logout 30 seconds before actual expiry
    const logoutTime = Math.max(timeUntilExpiry - 30000, 1000);
    
    window.autoLogoutTimer = setTimeout(() => {
        showLogoutWarning();
    }, logoutTime);
}

function showLogoutWarning() {
    const shouldStayLoggedIn = confirm('Your session is about to expire. Click OK to extend your session, or Cancel to logout.');
    
    if (shouldStayLoggedIn) {
        refreshToken();
    } else {
        logout();
    }
}

function refreshToken() {
    const token = localStorage.getItem('token');
    
    if (!token) {
        clearSession();
        return;
    }
    
    fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('tokenExpiry', data.expiresAt);
            setupAutoLogout(data.expiresAt);
        } else {
            clearSession();
        }
    })
    .catch(() => {
        clearSession();
    });
}

// Check token expiry on page load
function checkTokenExpiry() {
    const tokenExpiry = localStorage.getItem('tokenExpiry');
    const token = localStorage.getItem('token');
    
    // Only check if we're on a protected page (dashboard, room, notes)
    const currentPath = window.location.pathname;
    const protectedPaths = ['/dashboard', '/room/', '/notes/'];
    const isProtectedPage = protectedPaths.some(path => currentPath.includes(path));
    
    if (!isProtectedPage) {
        return; // Don't check on public pages like home/login
    }
    
    if (token && tokenExpiry) {
        const expirationTime = new Date(tokenExpiry).getTime();
        const currentTime = Date.now();
        
        if (currentTime >= expirationTime) {
            clearSession();
        } else {
            setupAutoLogout(tokenExpiry);
        }
    } else if (token) {
        // If we have token but no expiry info, assume it's expired
        clearSession();
    }
}

// Initialize session check only if not on home page
if (window.location.pathname !== '/') {
    checkTokenExpiry();
}

// Global logout function for other scripts
window.logout = logout;

} // End of authInitialized check
