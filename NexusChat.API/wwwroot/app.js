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

let activeConvId = null; // Resolved conversation ID for private chats
let editingMessageId = null; // Track message being edited

async function selectUser(user) {
    activeReceiverId = user.id;
    activeIsGroup = user.isGroup === true;
    activeChatName.innerHTML = `${user.userName} ${!activeIsGroup ? `<span class="status-indicator ${user.isOnline ? 'online' : ''}"></span>` : ''}`;
    
    const disbandBtn = document.getElementById('disband-btn');
    const viewCodeBtn = document.getElementById('view-code-btn');
    const pendingReqBtn = document.getElementById('pending-requests-btn');
    const membersBtn = document.getElementById('members-btn');
    const leaveBtn = document.getElementById('leave-group-btn');
    const renameBtn = document.getElementById('rename-group-btn');
    
    if (activeIsGroup) {
        membersBtn.style.display = 'inline-block';
        membersBtn.onclick = () => openMembersModal(user.id);
        
        if (user.isAdmin) {
            disbandBtn.style.display = 'inline-block';
            disbandBtn.onclick = () => disbandGroup(user.id);
            pendingReqBtn.style.display = 'inline-block';
            pendingReqBtn.onclick = () => openPendingRequestsModal();
            renameBtn.style.display = 'inline-block';
            renameBtn.onclick = () => openRenameModal(user.id, user.userName);
            leaveBtn.style.display = 'none';
        } else {
            disbandBtn.style.display = 'none';
            pendingReqBtn.style.display = 'none';
            renameBtn.style.display = 'none';
            leaveBtn.style.display = 'inline-block';
            leaveBtn.onclick = () => leaveGroup(user.id);
        }
    } else {
        disbandBtn.style.display = 'none';
        pendingReqBtn.style.display = 'none';
        membersBtn.style.display = 'none';
        leaveBtn.style.display = 'none';
        renameBtn.style.display = 'none';
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
        activeConvId = convId;

        const msgRes = await fetch(`${API_BASE}/Chat/messages/${convId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (msgRes.ok) {
            const messages = await msgRes.json();
            messagesContainer.innerHTML = '';
            messages.reverse().forEach(msg => {
                appendMessage(msg.content, msg.senderId === currentUser.id, new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), msg.id, msg.status === 2, msg.isEdited, msg.isDeleted, msg.senderId);
                
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
        // Show toast with approve/deny buttons — does NOT auto-close (duration = 0)
        const toastHtml = `
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <i class="fa-solid fa-user-plus" style="color: var(--primary); font-size: 1.1rem;"></i>
                <span><b>${request.requesterName}</b> muốn tham gia <b>${request.groupName}</b></span>
            </div>
            <div style="display: flex; gap: 10px;">
                <button class="btn-primary small" onclick="reviewJoinRequest('${request.conversationId}', '${request.requesterId}', true, this)"><i class="fa-solid fa-check"></i> Chấp nhận</button>
                <button class="btn-secondary small" style="color: #e74c3c;" onclick="reviewJoinRequest('${request.conversationId}', '${request.requesterId}', false, this)"><i class="fa-solid fa-xmark"></i> Từ chối</button>
            </div>
        `;
        showToast(toastHtml, "", 0); // Never auto-close
        // Update badge count
        updatePendingBadge();
    });

    hubConnection.on("JoinRequestApproved", async (data) => {
        const groupName = data.groupName || 'nhóm';
        showToast(`<i class="fa-solid fa-check-circle" style="color: #2ecc71;"></i> <b>Bạn đã được chấp nhận vào nhóm ${escapeHtml(groupName)}!</b>`, "");
        await fetchUsers();
    });

    hubConnection.on("JoinRequestRejected", (conversationId) => {
        showToast(`<i class="fa-solid fa-circle-xmark" style="color: #e74c3c;"></i> <b>Yêu cầu tham gia nhóm đã bị từ chối.</b>`, '');
    });

    hubConnection.on("GroupDisbanded", (conversationId) => {
        showToast(`<i class="fa-solid fa-circle-xmark" style="color: #e74c3c;"></i> <b>Nhóm đã bị giải tán bởi admin.</b>`, '');
        if (activeReceiverId === conversationId) {
            messagesContainer.innerHTML = `<div class="message system"><span>Nhóm này đã bị giải tán.</span></div>`;
            document.getElementById('message-input').disabled = true;
            document.getElementById('send-btn').disabled = true;
        }
        fetchUsers();
    });

    // --- Message Edit/Delete handlers ---
    hubConnection.on("MessageEdited", (msg) => {
        const msgEl = document.querySelector(`[data-msg-id="${msg.id}"]`);
        if (msgEl) {
            const bubble = msgEl.querySelector('.msg-content');
            if (bubble) bubble.innerHTML = escapeHtml(msg.content) + ' <span class="edited-tag">(đã chỉnh sửa)</span>';
        }
    });

    hubConnection.on("MessageDeleted", (msg) => {
        const msgEl = document.querySelector(`[data-msg-id="${msg.id}"]`);
        if (msgEl) {
            const bubble = msgEl.querySelector('.msg-content');
            if (bubble) {
                bubble.innerHTML = '<i class="fa-solid fa-ban"></i> Tin nhắn đã bị xóa';
                bubble.classList.add('deleted-msg');
            }
            // Remove context menu trigger
            const menuBtn = msgEl.querySelector('.msg-menu-btn');
            if (menuBtn) menuBtn.remove();
        }
    });

    // --- Member events ---
    hubConnection.on("MemberKicked", (data) => {
        showToast(`<i class="fa-solid fa-circle-xmark" style="color: #e74c3c;"></i> <b>Bạn đã bị xóa khỏi nhóm.</b>`, '');
        if (activeReceiverId === data.conversationId) {
            messagesContainer.innerHTML = `<div class="message system"><span>Bạn đã bị xóa khỏi nhóm này.</span></div>`;
            messageInput.disabled = true;
            sendBtn.disabled = true;
        }
        fetchUsers();
    });

    hubConnection.on("MemberLeft", (data) => {
        // Just refresh if viewing this group
        if (activeReceiverId === data.conversationId) {
            // The system message will arrive via ReceiveMessage
        }
    });

    hubConnection.on("GroupRenamed", (data) => {
        // Update sidebar and header
        const user = usersList.find(u => u.id === data.conversationId);
        if (user) {
            user.userName = data.newName;
            renderUsers();
            if (activeReceiverId === data.conversationId) {
                activeChatName.innerHTML = data.newName;
            }
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
    
    // Handle edit mode
    if (editingMessageId) {
        try {
            const result = await hubConnection.invoke('EditMessage', editingMessageId, text);
            if (result) {
                const msgEl = document.querySelector(`[data-msg-id="${editingMessageId}"]`);
                if (msgEl) {
                    const bubble = msgEl.querySelector('.msg-content');
                    bubble.innerHTML = escapeHtml(text) + ' <span class="edited-tag">(đã chỉnh sửa)</span>';
                }
            }
        } catch (e) {
            console.error('Edit failed', e);
        }
        cancelEdit();
        return;
    }

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
            const tempEl = document.querySelector(`[data-msg-id="${tempId}"]`);
            if (tempEl) tempEl.setAttribute('data-msg-id', sentMsg.id);
            const statusIcon = document.getElementById(`status-${tempId}`);
            if (statusIcon) {
                statusIcon.id = `status-${sentMsg.id}`;
            }
        }
    } catch (err) {
        console.error("Send failed: ", err);
    }
}

function appendMessage(text, isSent, timeStr, msgId = null, isRead = false, isEdited = false, isDeleted = false, senderId = null) {
    if (text && text.startsWith("[SYSTEM]")) {
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
    if (msgId) msgDiv.setAttribute('data-msg-id', msgId);
    if (senderId) msgDiv.setAttribute('data-sender-id', senderId);
    
    const time = timeStr || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let statusHtml = '';
    if (isSent) {
        statusHtml = `<i id="status-${msgId}" class="msg-status fa-solid ${isRead ? 'fa-check-double read' : 'fa-check'}"></i>`;
    }

    let contentHtml;
    if (isDeleted) {
        contentHtml = '<i class="fa-solid fa-ban"></i> Tin nhắn đã bị xóa';
    } else {
        contentHtml = escapeHtml(text) + (isEdited ? ' <span class="edited-tag">(đã chỉnh sửa)</span>' : '');
    }

    // Context menu button (only for non-deleted, non-system messages)
    let menuBtnHtml = '';
    if (!isDeleted && msgId && !String(msgId).startsWith('temp-')) {
        menuBtnHtml = `<button class="msg-menu-btn" onclick="openMsgContextMenu(event, '${msgId}', ${isSent})"><i class="fa-solid fa-ellipsis-vertical"></i></button>`;
    }
    
    msgDiv.innerHTML = `
        ${menuBtnHtml}
        <div class="message-bubble msg-content ${isDeleted ? 'deleted-msg' : ''}">${contentHtml}</div>
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

// --- Context Menu for Messages ---
window.openMsgContextMenu = (event, msgId, isSent) => {
    event.stopPropagation();
    // Remove any existing context menu
    document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'msg-context-menu';
    
    let menuItems = '';
    if (isSent) {
        menuItems += `<div class="ctx-item" onclick="startEditMessage('${msgId}')"><i class="fa-solid fa-pen"></i> Sửa</div>`;
    }
    // Both sender and admin can delete
    menuItems += `<div class="ctx-item danger" onclick="deleteMessage('${msgId}')"><i class="fa-solid fa-trash"></i> Xóa</div>`;
    
    menu.innerHTML = menuItems;
    
    // Position menu near the button
    const btn = event.currentTarget;
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left - 80}px`;
    menu.style.zIndex = '1000';
    
    document.body.appendChild(menu);
    
    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }, { once: true });
    }, 10);
};

window.startEditMessage = (msgId) => {
    document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());
    const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (!msgEl) return;
    
    const bubble = msgEl.querySelector('.msg-content');
    // Get text without the edited tag
    const editedTag = bubble.querySelector('.edited-tag');
    let currentText = bubble.textContent;
    if (editedTag) currentText = currentText.replace(editedTag.textContent, '').trim();
    
    editingMessageId = msgId;
    messageInput.value = currentText;
    messageInput.focus();
    
    // Show edit indicator
    const editBar = document.getElementById('edit-indicator');
    editBar.innerHTML = `<i class="fa-solid fa-pen" style="color: var(--primary);"></i> Đang sửa tin nhắn <button onclick="cancelEdit()" class="cancel-edit-btn"><i class="fa-solid fa-xmark"></i></button>`;
    editBar.style.display = 'flex';
};

window.cancelEdit = () => {
    editingMessageId = null;
    messageInput.value = '';
    document.getElementById('edit-indicator').style.display = 'none';
};

window.deleteMessage = async (msgId) => {
    document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());
    if (!confirm('Bạn có chắc muốn xóa tin nhắn này?')) return;
    
    try {
        const result = await hubConnection.invoke('DeleteMessage', msgId);
        if (result) {
            const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
            if (msgEl) {
                const bubble = msgEl.querySelector('.msg-content');
                bubble.innerHTML = '<i class="fa-solid fa-ban"></i> Tin nhắn đã bị xóa';
                bubble.classList.add('deleted-msg');
                const menuBtn = msgEl.querySelector('.msg-menu-btn');
                if (menuBtn) menuBtn.remove();
            }
        }
    } catch (e) {
        console.error('Delete failed', e);
        showToast('<i class="fa-solid fa-circle-xmark" style="color: #e74c3c;"></i> Không thể xóa tin nhắn.', '');
    }
};

// --- Group Member Management ---
async function openMembersModal(conversationId) {
    const modal = document.getElementById('members-modal');
    const list = document.getElementById('members-list');
    list.innerHTML = '<p style="text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải...</p>';
    modal.classList.add('active');

    try {
        const res = await fetch(`${API_BASE}/Chat/group/${conversationId}/members`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const members = await res.json();
            const currentUserData = usersList.find(u => u.id === conversationId);
            const isAdmin = currentUserData?.isAdmin || false;
            
            list.innerHTML = '';
            members.forEach(m => {
                const item = document.createElement('div');
                item.className = 'member-item';
                item.innerHTML = `
                    <div class="member-info">
                        <div class="avatar small"><i class="fa-solid fa-user"></i></div>
                        <div>
                            <span class="member-name">${escapeHtml(m.userName)} ${m.isAdmin ? '<span class="admin-badge">Admin</span>' : ''}</span>
                            <span class="member-status ${m.isOnline ? 'online' : ''}"><i class="fa-solid fa-circle"></i> ${m.isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                    ${isAdmin && !m.isAdmin && m.userId !== currentUser.id ? 
                        `<button class="btn-reject" onclick="kickMember('${conversationId}', '${m.userId}')" title="Xóa khỏi nhóm"><i class="fa-solid fa-user-minus"></i></button>` : ''}
                `;
                list.appendChild(item);
            });
        }
    } catch (e) {
        list.innerHTML = '<p style="text-align: center; color: var(--danger);">Lỗi tải danh sách.</p>';
    }
}

window.kickMember = async (conversationId, memberId) => {
    if (!confirm('Bạn có chắc muốn xóa thành viên này khỏi nhóm?')) return;
    try {
        const res = await fetch(`${API_BASE}/Chat/group/${conversationId}/kick`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ memberId })
        });
        if (res.ok) {
            showToast('<i class="fa-solid fa-check-circle" style="color: #2ecc71;"></i> Đã xóa thành viên.', '');
            openMembersModal(conversationId); // Refresh
        } else {
            alert('Không thể xóa thành viên.');
        }
    } catch (e) { console.error(e); }
};

async function leaveGroup(conversationId) {
    if (!confirm('Bạn có chắc muốn rời nhóm này?')) return;
    try {
        const res = await fetch(`${API_BASE}/Chat/group/${conversationId}/leave`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            showToast('<i class="fa-solid fa-check-circle" style="color: #2ecc71;"></i> Đã rời nhóm.', '');
            await fetchUsers();
            messagesContainer.innerHTML = '';
            activeReceiverId = null;
        } else {
            alert('Không thể rời nhóm.');
        }
    } catch (e) { console.error(e); }
}

// --- Rename Group ---
function openRenameModal(conversationId, currentName) {
    const input = document.getElementById('rename-group-input');
    input.value = currentName;
    document.getElementById('rename-group-modal').classList.add('active');
    document.getElementById('rename-group-save').onclick = async () => {
        const newName = input.value.trim();
        if (!newName) return;
        try {
            const res = await fetch(`${API_BASE}/Chat/group/${conversationId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name: newName })
            });
            if (res.ok) {
                document.getElementById('rename-group-modal').classList.remove('active');
                showToast('<i class="fa-solid fa-check-circle" style="color: #2ecc71;"></i> Đã đổi tên nhóm.', '');
                await fetchUsers();
                activeChatName.innerHTML = newName;
            }
        } catch (e) { console.error(e); }
    };
}

// Modals
document.querySelector('.icon-btn[title="Settings"]').addEventListener('click', () => {
    document.getElementById('setting-username').value = currentUser.userName;
    document.getElementById('setting-email').value = currentUser.email;
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
    
    // Create group with only the creator — others must join via code + approval
    const participantIds = [];
    
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
            // Remove toast notification if triggered from toast
            if (btnElement) {
                const toast = btnElement.closest('.toast');
                if (toast) {
                    toast.classList.add('hide');
                    setTimeout(() => toast.remove(), 300);
                }
            }
            // Remove item from pending requests modal if open
            const reqItem = document.getElementById(`req-${conversationId}-${requesterId}`);
            if (reqItem) {
                reqItem.style.animation = 'slideOut 0.3s ease forwards';
                setTimeout(() => reqItem.remove(), 300);
                // Check if list is now empty
                setTimeout(() => {
                    const list = document.getElementById('pending-requests-list');
                    if (list && list.children.length === 0) {
                        list.innerHTML = '<p class="empty-requests"><i class="fa-solid fa-check-circle"></i> Không có yêu cầu nào đang chờ.</p>';
                    }
                }, 350);
            }
            showToast(`<i class="fa-solid fa-${isApproved ? 'check-circle" style="color: #2ecc71;' : 'circle-xmark" style="color: #e74c3c;'}"></i> Yêu cầu đã được ${isApproved ? 'chấp nhận' : 'từ chối'}!`, '');
            updatePendingBadge();
        } else {
            const errorMsg = await res.text();
            alert(`Lỗi: ${errorMsg || 'Không thể xử lý yêu cầu'}`);
        }
    } catch (e) {
        console.error(e);
        alert(`Lỗi: ${e.message}`);
    }
};

// --- Pending Requests Management ---
async function openPendingRequestsModal() {
    const modal = document.getElementById('pending-requests-modal');
    const list = document.getElementById('pending-requests-list');
    list.innerHTML = '<p style="text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải...</p>';
    modal.classList.add('active');

    try {
        const res = await fetch(`${API_BASE}/Chat/group/requests`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const requests = await res.json();
            if (requests.length === 0) {
                list.innerHTML = '<p class="empty-requests"><i class="fa-solid fa-check-circle"></i> Không có yêu cầu nào đang chờ.</p>';
            } else {
                list.innerHTML = '';
                requests.forEach(req => {
                    const item = document.createElement('div');
                    item.className = 'pending-request-item';
                    item.id = `req-${req.conversationId}-${req.requesterId}`;
                    item.innerHTML = `
                        <div class="pending-request-info">
                            <div class="avatar small"><i class="fa-solid fa-user"></i></div>
                            <div>
                                <span class="pending-request-name">${escapeHtml(req.requesterName)}</span>
                                <span class="pending-request-group">muốn tham gia <b>${escapeHtml(req.groupName)}</b></span>
                            </div>
                        </div>
                        <div class="pending-request-actions">
                            <button class="btn-approve" onclick="reviewJoinRequest('${req.conversationId}', '${req.requesterId}', true, this)" title="Chấp nhận"><i class="fa-solid fa-check"></i></button>
                            <button class="btn-reject" onclick="reviewJoinRequest('${req.conversationId}', '${req.requesterId}', false, this)" title="Từ chối"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    `;
                    list.appendChild(item);
                });
            }
        }
    } catch (e) {
        list.innerHTML = '<p style="text-align: center; color: var(--danger);">Lỗi tải danh sách yêu cầu.</p>';
        console.error(e);
    }
}

async function updatePendingBadge() {
    try {
        const res = await fetch(`${API_BASE}/Chat/group/requests`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const requests = await res.json();
            const badge = document.getElementById('pending-badge');
            if (requests.length > 0) {
                badge.textContent = requests.length;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    } catch (e) {
        console.error(e);
    }
}

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

// --- Settings / Profile ---
document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
    const userName = document.getElementById('setting-username').value.trim();
    const email = document.getElementById('setting-email').value.trim();
    if (!userName || !email) return alert('Vui lòng nhập đầy đủ thông tin.');
    
    try {
        const res = await fetch(`${API_BASE}/Auth/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ userName, email })
        });
        if (res.ok) {
            const user = await res.json();
            currentUser.userName = user.userName;
            currentUser.email = user.email;
            currentUsernameSpan.textContent = user.userName;
            showToast('<i class="fa-solid fa-check-circle" style="color: #2ecc71;"></i> Cập nhật hồ sơ thành công!', '');
        } else {
            const err = await res.text();
            alert(err || 'Không thể cập nhật.');
        }
    } catch (e) { console.error(e); }
});

document.getElementById('save-password-btn')?.addEventListener('click', async () => {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if (!currentPassword || !newPassword) return alert('Vui lòng nhập đầy đủ.');
    if (newPassword !== confirmPassword) return alert('Mật khẩu mới không khớp!');
    if (newPassword.length < 6) return alert('Mật khẩu mới tối thiểu 6 ký tự.');
    
    try {
        const res = await fetch(`${API_BASE}/Auth/password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        if (res.ok) {
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-password').value = '';
            showToast('<i class="fa-solid fa-check-circle" style="color: #2ecc71;"></i> Đổi mật khẩu thành công!', '');
        } else {
            const err = await res.text();
            alert(err || 'Không thể đổi mật khẩu.');
        }
    } catch (e) { console.error(e); }
});
