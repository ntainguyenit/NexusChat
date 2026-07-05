const loginView = document.getElementById('login-view');
const chatView = document.getElementById('chat-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const conversationList = document.getElementById('conversation-list');
const activeChatName = document.getElementById('active-chat-name');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const logoutBtn = document.getElementById('logout-btn');
const currentUsernameSpan = document.getElementById('current-username');

let token = null;
let currentUser = null;
let hubConnection = null;
let activeReceiverId = null;
let usersList = [];

// API Base URL
const API_BASE = '/api';

// --- Auth ---
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    
    loginError.textContent = '';
    
    try {
        const res = await fetch(`${API_BASE}/Auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || 'Login failed');
        }
        
        const data = await res.json();
        token = data.token;
        currentUser = data.user;
        
        // Setup UI
        currentUsernameSpan.textContent = currentUser.userName;
        loginView.classList.remove('active');
        chatView.style.display = 'flex';
        
        await initializeChat();
    } catch (err) {
        loginError.textContent = err.message;
    }
});

logoutBtn.addEventListener('click', () => {
    if (hubConnection) {
        hubConnection.stop();
    }
    token = null;
    currentUser = null;
    chatView.style.display = 'none';
    loginView.classList.add('active');
    messagesContainer.innerHTML = '';
});

// --- Chat Initialization ---
async function initializeChat() {
    await fetchUsers();
    await startSignalR();
}

async function fetchUsers() {
    try {
        const res = await fetch(`${API_BASE}/Auth/users`);
        const users = await res.json();
        
        // Filter out current user
        usersList = users.filter(u => u.id !== currentUser.id);
        
        renderUsers();
        
        // Select first user by default if available
        if (usersList.length > 0) {
            selectUser(usersList[0]);
        } else {
            activeChatName.textContent = "No other users found";
        }

        // Setup search
        const searchInput = document.querySelector('.search-bar input');
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            document.querySelectorAll('.conversation-item').forEach(li => {
                const name = li.querySelector('.conv-name').textContent.toLowerCase();
                li.style.display = name.includes(term) ? 'flex' : 'none';
            });
        });
    } catch (err) {
        console.error("Failed to fetch users", err);
    }
}

function renderUsers() {
    conversationList.innerHTML = '';
    usersList.forEach(user => {
        const li = document.createElement('li');
        li.className = 'conversation-item';
        li.dataset.id = user.id;
        
        li.innerHTML = `
            <div class="avatar"><i class="fa-solid fa-user"></i></div>
            <div class="conv-details">
                <span class="conv-name">${user.userName} <span class="status-indicator ${user.isOnline ? 'online' : ''}" style="display:inline-block; margin-left: 5px;"></span></span>
                <span class="conv-last-msg">Click to chat</span>
            </div>
        `;
        
        li.addEventListener('click', () => selectUser(user));
        conversationList.appendChild(li);
    });
}

async function selectUser(user) {
    activeReceiverId = user.id;
    activeChatName.innerHTML = `${user.userName} <span class="status-indicator ${user.isOnline ? 'online' : ''}"></span>`;
    
    // Highlight active in sidebar
    document.querySelectorAll('.conversation-item').forEach(el => {
        el.classList.remove('active');
        if (el.dataset.id === user.id) {
            el.classList.add('active');
        }
    });
    
    // Load history
    messagesContainer.innerHTML = `<div class="message system"><span>Loading history...</span></div>`;
    try {
        const convRes = await fetch(`${API_BASE}/Chat/private/${user.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (convRes.ok) {
            const conv = await convRes.json();
            const msgRes = await fetch(`${API_BASE}/Chat/messages/${conv.id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (msgRes.ok) {
                const messages = await msgRes.json();
                messagesContainer.innerHTML = '';
                // The messages API usually returns newest first or oldest first. Assuming oldest first or we need to reverse if skip/take is used
                // Let's assume the backend returns them sorted appropriately. If not, we can sort them here.
                messages.forEach(msg => {
                    appendMessage(msg.content, msg.senderId === currentUser.id, new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                });
            }
        }
    } catch (e) {
        messagesContainer.innerHTML = `<div class="message system"><span>Error loading history</span></div>`;
    }
}

// --- SignalR ---
async function startSignalR() {
    hubConnection = new signalR.HubConnectionBuilder()
        .withUrl("/hubs/chat", { accessTokenFactory: () => token })
        .withAutomaticReconnect()
        .build();

    hubConnection.on("ReceiveMessage", (message) => {
        // If the message is from or to the active receiver, display it
        const isFromActive = message.senderId === activeReceiverId;
        const isFromMe = message.senderId === currentUser.id;
        
        if (isFromActive && !isFromMe) {
            appendMessage(message.content, false);
        } else if (!isFromActive && !isFromMe) {
            console.log(`New message from ${message.senderName}`);
        }
    });

    try {
        await hubConnection.start();
        console.log("SignalR Connected.");
    } catch (err) {
        console.error("SignalR Connection Error: ", err);
    }
}

// --- Messaging ---
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !activeReceiverId || !hubConnection) return;
    
    // Optimistically append the message
    appendMessage(text, true);
    
    // Call SendMessageToUser on Hub
    hubConnection.invoke("SendMessageToUser", activeReceiverId, text)
        .catch(err => console.error("Send failed: ", err));
    
    messageInput.value = '';
}

function appendMessage(text, isSent, timeStr) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    
    const time = timeStr || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    msgDiv.innerHTML = `
        <div class="message-bubble">${escapeHtml(text)}</div>
        <span class="message-time">${time}</span>
    `;
    
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Modals
document.querySelector('.icon-btn[title="Settings"]').addEventListener('click', () => {
    document.getElementById('setting-username').textContent = currentUser.userName;
    document.getElementById('setting-email').textContent = currentUser.email;
    document.getElementById('settings-modal').classList.add('active');
});

document.querySelector('.icon-btn[title="New Conversation"]').addEventListener('click', () => {
    document.getElementById('group-name').value = '';
    document.getElementById('group-modal').classList.add('active');
});

document.getElementById('create-group-btn').addEventListener('click', async () => {
    const name = document.getElementById('group-name').value.trim();
    if (!name) return alert("Please enter a group name");
    
    // Create group with all other users
    const participantIds = usersList.map(u => u.id);
    
    try {
        const res = await fetch(`${API_BASE}/Chat/group`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ name, participantIds })
        });
        
        if (res.ok) {
            document.getElementById('group-modal').classList.remove('active');
            alert("Group created successfully! Note: Due to UI simplicity, the group won't appear in sidebar until we implement GET /conversations, but API works!");
        } else {
            alert("Failed to create group");
        }
    } catch(err) {
        alert("Error creating group");
    }
});

document.querySelectorAll('.icon-btn[title="Attach file"], .icon-btn[title="Search in chat"]').forEach(btn => {
    btn.addEventListener('click', () => {
        alert("Upload file và Search nội dung chat sẽ được phát triển sau (theo phương án đã chốt)!");
    });
});
