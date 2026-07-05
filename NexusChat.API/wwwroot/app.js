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

const typingDiv = document.getElementById('typing-indicator');

let token = null;
let currentUser = null;
let hubConnection = null;
let activeReceiverId = null; // Can be UserId (private) or ConversationId (group)
let activeIsGroup = false;
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
        
        // Fetch groups
        try {
            const convRes = await fetch(`${API_BASE}/Chat/conversations`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (convRes.ok) {
                const convs = await convRes.json();
                const groups = convs.filter(c => c.isGroup).map(g => ({
                    id: g.id,
                    userName: g.name,
                    joinCode: g.joinCode,
                    isOnline: true,
                    isGroup: true,
                    isAdmin: g.isAdmin,
                    isPending: g.isPending
                }));
                usersList = [...usersList, ...groups];
            }
        } catch (e) {
            console.error("Failed to fetch groups", e);
        }
        
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
            <div class="avatar"><i class="fa-solid ${user.isGroup ? 'fa-users' : 'fa-user'}"></i></div>
            <div class="conv-details">
                <span class="conv-name">${user.userName} ${!user.isGroup ? `<span class="status-indicator ${user.isOnline ? 'online' : ''}" style="display:inline-block; margin-left: 5px;"></span>` : ''}</span>
                <span class="conv-last-msg">Click to chat</span>
            </div>
        `;
        
        li.addEventListener('click', () => selectUser(user));
        conversationList.appendChild(li);
    });
}

async function selectUser(user) {
    activeReceiverId = user.id;
    activeIsGroup = user.isGroup === true;
    activeChatName.innerHTML = `${user.userName} ${!activeIsGroup ? `<span class="status-indicator ${user.isOnline ? 'online' : ''}"></span>` : ''}`;
    
    const disbandBtn = document.getElementById('disband-btn');
    const viewCodeBtn = document.getElementById('view-code-btn');
    if (activeIsGroup && user.isAdmin) {
        disbandBtn.style.display = 'inline-block';
        disbandBtn.onclick = () => disbandGroup(user.id);
    } else {
        disbandBtn.style.display = 'none';
        disbandBtn.onclick = null;
    }
    
    if (activeIsGroup && user.joinCode) {
        viewCodeBtn.style.display = 'inline-block';
        viewCodeBtn.onclick = () => {
            document.getElementById('group-name-group').style.display = 'none';
            document.getElementById('group-modal-footer').style.display = 'none';
            document.getElementById('group-modal-title').textContent = user.userName;
            document.getElementById('new-group-code').textContent = user.joinCode;
            document.getElementById('group-code-display').style.display = 'block';
            document.getElementById('group-modal').classList.add('active');
        };
    } else {
        viewCodeBtn.style.display = 'none';
        viewCodeBtn.onclick = null;
    }
    
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
        let convId = activeReceiverId;
        if (!activeIsGroup) {
            const convRes = await fetch(`${API_BASE}/Chat/private/${activeReceiverId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (convRes.ok) {
                const conv = await convRes.json();
                convId = conv.id;
            }
        }

        const msgRes = await fetch(`${API_BASE}/Chat/messages/${convId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (msgRes.ok) {
            const messages = await msgRes.json();
            messagesContainer.innerHTML = '';
            messages.reverse().forEach(msg => {
                appendMessage(msg.content, msg.senderId === currentUser.id, new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), msg.id, msg.status === 2);
                
                // Mark as read if not sent by me and not read
                if (msg.senderId !== currentUser.id && msg.status !== 2) {
                    hubConnection.invoke("MarkAsRead", msg.id).catch(console.error);
                }
            });
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
        const isFromActive = message.senderId === activeReceiverId || message.conversationId === activeReceiverId;
        const isFromMe = message.senderId === currentUser.id;
        
        if (isFromActive && !isFromMe) {
            appendMessage(message.content, false, null, message.id, false);
            if (document.visibilityState === 'visible') {
                hubConnection.invoke("MarkAsRead", message.id).catch(console.error);
            }
        } else if (!isFromActive && !isFromMe) {
            console.log(`New message from ${message.senderName}`);
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && activeReceiverId && hubConnection) {
            // Re-fetch or at least loop over visible unread messages to mark them
            const unreadMessages = messagesContainer.querySelectorAll('.message.received'); // Actually we just re-select user to refresh history and mark read
            selectUser(usersList.find(u => u.id === activeReceiverId));
        }
    });

    hubConnection.on("MessageRead", (messageId) => {
        const statusSpan = document.getElementById(`status-${messageId}`);
        if (statusSpan) {
            statusSpan.className = 'msg-status read fa-solid fa-check-double';
        }
    });

    let typingTimeout;
    hubConnection.on("UserTyping", (userId, isGroup) => {
        const isMatch = (!isGroup && userId.toLowerCase() === activeReceiverId?.toLowerCase()) || isGroup;
        if (isMatch) {
            const user = usersList.find(u => u.id.toLowerCase() === userId.toLowerCase());
            typingDiv.textContent = `${user ? user.userName : 'Someone'} is typing...`;
            typingDiv.classList.add('active');
            
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                typingDiv.classList.remove('active');
            }, 3000);
        }
    });

    hubConnection.on("UserStoppedTyping", (userId, isGroup) => {
        const isMatch = (!isGroup && userId.toLowerCase() === activeReceiverId?.toLowerCase()) || isGroup;
        if (isMatch) {
            typingDiv.classList.remove('active');
        }
    });

    hubConnection.on("JoinRequestReceived", (request) => {
        // Show toast with approve/deny buttons
        const toastHtml = `
            <b>${request.requesterName}</b> wants to join <b>${request.groupName}</b>
            <div style="margin-top: 10px; display: flex; gap: 10px;">
                <button class="btn-primary small" onclick="reviewJoinRequest('${request.conversationId}', '${request.requesterId}', true, this)">Approve</button>
                <button class="btn-secondary small" onclick="reviewJoinRequest('${request.conversationId}', '${request.requesterId}', false, this)">Deny</button>
            </div>
        `;
        showToast(toastHtml, "", 10000); // 10 seconds
    });

    hubConnection.on("JoinRequestApproved", async (conversationId) => {
        showToast(`<i class="fa-solid fa-check-circle" style="color: #2ecc71;"></i> <b>Đã tham gia nhóm thành công!</b>`, "");
        await fetchUsers();
    });

    hubConnection.on("JoinRequestRejected", (conversationId) => {
        showToast(`Your join request was denied.`, '');
    });

    hubConnection.on("GroupDisbanded", (conversationId) => {
        showToast(`A group you were in has been disbanded by the admin.`, '');
        if (activeReceiverId === conversationId) {
            messagesContainer.innerHTML = `<div class="message system"><span>This group was disbanded.</span></div>`;
            document.getElementById('message-input').disabled = true;
            document.getElementById('send-btn').disabled = true;
        }
        fetchUsers();
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

messageInput.addEventListener('focus', () => {
    if (activeReceiverId && hubConnection) {
        hubConnection.invoke('Typing', activeReceiverId, activeIsGroup);
    }
});

messageInput.addEventListener('blur', () => {
    if (activeReceiverId && hubConnection) {
        hubConnection.invoke('StoppedTyping', activeReceiverId, activeIsGroup);
    }
});

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !activeReceiverId || !hubConnection) return;
    
    // Generate a temporary ID for the optimistic message
    const tempId = 'temp-' + Date.now();
    appendMessage(text, true, null, tempId);
    
    messageInput.value = '';
    
    // Stop typing
    hubConnection.invoke("StoppedTyping", activeReceiverId, activeIsGroup).catch(console.error);
    
    try {
        let sentMsg;
        if (activeIsGroup) {
            sentMsg = await hubConnection.invoke("SendMessageToGroup", activeReceiverId, text);
        } else {
            sentMsg = await hubConnection.invoke("SendMessageToUser", activeReceiverId, text);
        }
        
        // Update the temporary ID with the real ID from the server
        if (sentMsg) {
            const statusIcon = document.getElementById(`status-${tempId}`);
            if (statusIcon) {
                statusIcon.id = `status-${sentMsg.id}`;
            }
        }
    } catch (err) {
        console.error("Send failed: ", err);
    }
}

function appendMessage(text, isSent, timeStr, msgId = null, isRead = false) {
    if (text.startsWith("[SYSTEM]")) {
        const sysText = text.substring(8).trim();
        const sysDiv = document.createElement('div');
        sysDiv.className = 'message system';
        sysDiv.innerHTML = `<span>${sysText}</span>`;
        messagesContainer.appendChild(sysDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return;
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    
    const time = timeStr || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let statusHtml = '';
    if (isSent) {
        statusHtml = `<i id="status-${msgId}" class="msg-status fa-solid ${isRead ? 'fa-check-double read' : 'fa-check'}"></i>`;
    }
    
    msgDiv.innerHTML = `
        <div class="message-bubble msg-content">${escapeHtml(text)}</div>
        <span class="message-time">${time} ${statusHtml}</span>
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

// Removed unused New Conversation block

document.querySelector('.icon-btn[title="New Group"]').addEventListener('click', () => {
    document.getElementById('group-name').value = '';
    document.getElementById('group-name-group').style.display = 'block';
    document.getElementById('group-modal-footer').style.display = 'flex';
    document.getElementById('group-code-display').style.display = 'none';
    document.getElementById('group-modal-title').textContent = 'New Group';
    document.getElementById('group-modal').classList.add('active');
});

function closeGroupModal() {
    document.getElementById('group-modal').classList.remove('active');
}

document.getElementById('copy-code-btn').addEventListener('click', () => {
    const code = document.getElementById('new-group-code').textContent;
    navigator.clipboard.writeText(code);
    const btn = document.getElementById('copy-code-btn');
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    setTimeout(() => {
        btn.innerHTML = '<i class="fa-solid fa-copy"></i> Copy Code';
    }, 2000);
});

document.getElementById('create-group-btn').addEventListener('click', async () => {
    const name = document.getElementById('group-name').value.trim();
    if (!name) return alert("Please enter a group name");
    
    // Create group with all other users (excluding groups)
    const participantIds = usersList.filter(u => !u.isGroup).map(u => u.id);
    
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
            const group = await res.json();
            // Show code in UI instead of alert
            document.getElementById('group-name-group').style.display = 'none';
            document.getElementById('group-modal-footer').style.display = 'none';
            document.getElementById('group-modal-title').textContent = 'Group Created!';
            document.getElementById('new-group-code').textContent = group.joinCode;
            document.getElementById('group-code-display').style.display = 'block';
            
            await fetchUsers(); // Refresh sidebar to show new group
        } else {
            const errText = await res.text();
            alert("Failed to create group: " + errText);
        }
    } catch(err) {
        alert("Error creating group");
    }
});

// Join Group
document.getElementById('join-group-btn').addEventListener('click', async () => {
    const code = document.getElementById('join-code').value.trim();
    if (!code) return alert("Please enter a join code");
    
    try {
        const res = await fetch(`${API_BASE}/Chat/group/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ code })
        });
        
        if (res.ok) {
            const data = await res.json();
            document.getElementById('join-modal').classList.remove('active');
            if (data.isPending) {
                showToast(`<i class="fa-solid fa-hourglass-half" style="color: var(--primary);"></i> <b>Đang chờ xác nhận từ trưởng nhóm...</b>`, '');
            } else {
                showToast(`<i class="fa-solid fa-check-circle" style="color: #2ecc71;"></i> <b>Joined group successfully!</b>`, '');
                await fetchUsers();
            }
        } else {
            alert("Failed to join group. Check the code.");
        }
    } catch (e) {
        console.error(e);
    }
});

// Toast Notifications
function showToast(contentHtml, actionsHtml = '', duration = 5000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <div class="toast-content">${contentHtml}</div>
        ${actionsHtml ? `<div class="toast-actions">${actionsHtml}</div>` : ''}
    `;
    container.appendChild(toast);
    
    if (duration > 0) {
        setTimeout(() => {
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
}

window.reviewJoinRequest = async (conversationId, requesterId, isApproved, btnElement) => {
    const action = isApproved ? 'approve' : 'reject';
    try {
        const res = await fetch(`${API_BASE}/Chat/group/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ conversationId, requesterId })
        });
        if (res.ok) {
            if (btnElement) {
                const toast = btnElement.closest('.toast');
                if (toast) {
                    toast.classList.add('hide');
                    setTimeout(() => toast.remove(), 300);
                }
            }
            showToast(`Yêu cầu đã được ${isApproved ? 'chấp nhận' : 'từ chối'} thành công!`, '');
        } else {
            const errorMsg = await res.text();
            alert(`Lỗi: ${errorMsg || 'Không thể xử lý yêu cầu'}`);
        }
    } catch (e) {
        console.error(e);
        alert(`Lỗi: ${e.message}`);
    }
};

async function disbandGroup(conversationId) {
    if (!confirm("Are you sure you want to disband this group? This will delete all messages and remove all members. This action cannot be undone.")) return;
    
    try {
        const res = await fetch(`${API_BASE}/Chat/group/${conversationId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            alert("Group disbanded successfully.");
            await fetchUsers();
            messagesContainer.innerHTML = '';
        } else {
            alert("Failed to disband group.");
        }
    } catch (e) {
        console.error(e);
    }
}

// Message Search filtering
const toggleSearchBtn = document.getElementById('toggle-search-btn');
const messageSearchBar = document.getElementById('message-search-bar');
const messageSearchInput = document.getElementById('message-search-input');

toggleSearchBtn.addEventListener('click', () => {
    if (messageSearchBar.style.display === 'none') {
        messageSearchBar.style.display = 'block';
        messageSearchInput.focus();
    } else {
        messageSearchBar.style.display = 'none';
        messageSearchInput.value = '';
        messageSearchInput.dispatchEvent(new Event('input')); // Reset filter
    }
});

messageSearchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const messages = messagesContainer.querySelectorAll('.message:not(.system)');
    messages.forEach(msg => {
        const content = msg.querySelector('.msg-content').textContent.toLowerCase();
        if (content.includes(term)) {
            msg.style.opacity = '1';
        } else {
            msg.style.opacity = '0.1'; // Dim unmatching messages
        }
    });
});

// Settings Modal
