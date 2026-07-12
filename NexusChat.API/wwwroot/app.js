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
let friendsList = [];
let pendingFriends = [];
let blockedUsers = [];
let currentTab = 'chats'; // 'chats' or 'friends'
let replyToMessageId = null;
let pinnedMessageId = null;

// API Base URL
const API_BASE = '/api';

// --- Auth ---
// --- Google Auth ---
async function handleCredentialResponse(response) {
    loginError.textContent = '';
    
    try {
        const res = await fetch(`${API_BASE}/Auth/google-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: response.credential })
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
}

logoutBtn.addEventListener('click', async () => {
    if (!await customConfirm('Bạn có chắc chắn muốn đăng xuất không?', 'Thoát tài khoản')) return;
    if (hubConnection) {
        hubConnection.stop();
    }
    token = null;
    currentUser = null;
    chatView.style.display = 'none';
    loginView.classList.add('active');
    messagesContainer.innerHTML = '';
});


// --- Tabs Logic ---
const tabChats = document.getElementById('tab-chats');
const tabFriends = document.getElementById('tab-friends');
const friendListUl = document.getElementById('friend-list');
const chatActionsBar = document.getElementById('chat-actions-bar');
const friendActionsBar = document.getElementById('friend-actions-bar');

tabChats?.addEventListener('click', () => {
    currentTab = 'chats';
    tabChats.classList.add('active');
    tabFriends?.classList.remove('active');
    conversationList.style.display = 'block';
    if(friendListUl) friendListUl.style.display = 'none';
    if(chatActionsBar) chatActionsBar.style.display = 'flex';
    if(friendActionsBar) friendActionsBar.style.display = 'none';
    const mainSearchBar = document.getElementById('main-search-bar');
    if(mainSearchBar) mainSearchBar.style.display = 'flex';
});

tabFriends?.addEventListener('click', async () => {
    currentTab = 'friends';
    tabFriends.classList.add('active');
    tabChats?.classList.remove('active');
    conversationList.style.display = 'none';
    if(friendListUl) friendListUl.style.display = 'block';
    if(chatActionsBar) chatActionsBar.style.display = 'none';
    if(friendActionsBar) friendActionsBar.style.display = 'flex';
    const mainSearchBar = document.getElementById('main-search-bar');
    if(mainSearchBar) mainSearchBar.style.display = 'none';
    await fetchFriends();
});

async function fetchFriends() {
    try {
        const res = await fetch('/api/Friends', { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            friendsList = await res.json();
            renderFriends();
        }
    } catch(e) { console.error(e); }
}

function renderFriends() {
    if(!friendListUl) return;
    friendListUl.innerHTML = '';
    friendsList.forEach(f => {
        const li = document.createElement('li');
        li.className = 'conversation-item';
        li.innerHTML = `
            <div class="avatar"><i class="fa-solid fa-user"></i></div>
            <div class="conv-details">
                <span class="conv-name">${escapeHtml(f.userName)} ${f.isOnline ? '<span class="status-indicator online" style="display:inline-block; margin-left: 5px;"></span>' : ''}</span>
                <span class="conv-last-msg">Bạn bè</span>
            </div>
            <button class="icon-btn" onclick="removeFriend('${f.userId}', event)" style="z-index:10;"><i class="fa-solid fa-user-minus"></i></button>
        `;
        li.addEventListener('click', () => {
            selectUser({ id: f.userId, userName: f.userName, isGroup: false, isOnline: f.isOnline });
        });
        friendListUl.appendChild(li);
    });
}

window.removeFriend = async (id, e) => {
    if(e) e.stopPropagation();
    if(!await customConfirm('Xóa bạn bè?')) return;
    await fetch(`/api/Friends/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }});
    fetchFriends();
    fetchUsers();
};

window.addFriend = async (id) => {
    // This adds by ID directly
    await fetch('/api/Friends', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ friendId: id })});
    fetchFriends();
}

// Add friend by Search
const friendSearchInput = document.getElementById('friend-search-input');
const friendSearchResults = document.getElementById('friend-search-results');
let searchTimeout;

if (friendSearchInput) {
    friendSearchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        
        if (query.length < 2) {
            friendSearchResults.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.9rem; padding: 20px 0;"><i class="fa-solid fa-keyboard"></i> Gõ ít nhất 2 ký tự để tìm kiếm</p>';
            return;
        }

        friendSearchResults.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Đang tìm...</p>';

        searchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`${API_BASE}/Auth/search?query=${encodeURIComponent(query)}`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    cache: 'no-store'
                });
                
                if (res.ok) {
                    const users = await res.json();
                    
                    if (users.length === 0) {
                        friendSearchResults.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px 0;">Không tìm thấy kết quả nào</p>';
                        return;
                    }
                    
                    // Lọc những người đã là bạn bè (hoặc không cần thiết vì backend có thể xử lý, nhưng frontend dễ filter hơn)
                    // Ở đây backend đã lọc user hiện tại, ta có thể lọc thêm friends hiện tại nếu cần.
                    const friendIds = friendsList.map(f => f.userId);
                    const results = users.filter(u => !friendIds.includes(u.id));
                    
                    if (results.length === 0) {
                        friendSearchResults.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px 0;">Các kết quả đều đã là bạn bè</p>';
                        return;
                    }

                    friendSearchResults.innerHTML = '';
                    results.forEach(u => {
                        const item = document.createElement('div');
                        item.className = 'search-result-item';
                        item.innerHTML = `
                            <div class="search-result-info">
                                <div class="avatar small" style="background-color: var(--primary); color: white;"><i class="fa-solid fa-user"></i></div>
                                <div>
                                    <span class="search-result-name">${escapeHtml(u.userName)}</span>
                                    <span class="search-result-email">${escapeHtml(u.email)}</span>
                                </div>
                            </div>
                            <button class="btn-primary small" onclick="sendFriendRequestFromSearch('${escapeHtml(u.email)}')"><i class="fa-solid fa-user-plus"></i></button>
                        `;
                        friendSearchResults.appendChild(item);
                    });
                }
            } catch (err) {
                console.error(err);
                friendSearchResults.innerHTML = '<p style="text-align: center; color: var(--danger); padding: 20px 0;">Lỗi khi tìm kiếm</p>';
            }
        }, 500); // debounce 500ms
    });
}

window.sendFriendRequestFromSearch = async (email) => {
    try {
        const res = await fetch(`${API_BASE}/Friends/request/${encodeURIComponent(email)}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            showToast(`<i class="fa-solid fa-check" style="color: #2ecc71;"></i> <b>Đã gửi lời mời kết bạn!</b>`, '');
            document.getElementById('add-friend-modal').classList.remove('active');
            if(friendSearchInput) friendSearchInput.value = '';
            if(friendSearchResults) friendSearchResults.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.9rem; padding: 20px 0;"><i class="fa-solid fa-keyboard"></i> Gõ ít nhất 2 ký tự để tìm kiếm</p>';
        } else {
            await customAlert("Không thể gửi lời mời. Vui lòng thử lại.");
        }
    } catch (err) {
        console.error(err);
        await customAlert("Lỗi khi gửi lời mời.");
    }
};

window.blockUser = async (id) => {
    if(!await customConfirm('Chặn người dùng này?')) return;
    await fetch('/api/Blocks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ blockedUserId: id })});
    customAlert('Đã chặn!');
};

// --- Chat Initialization ---
async function initializeChat() {
    await fetchUsers();
    await startSignalR();
}

async function fetchUsers() {
    try {
        const res = await fetch(`/api/Friends`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const friends = await res.json();
        
        // Map FriendDto to user object format expected by UI
        usersList = friends.map(f => ({
            id: f.userId,
            userName: f.userName,
            isOnline: f.isOnline
        }));
        
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
    const membersBtn = document.getElementById('members-btn');
    const leaveBtn = document.getElementById('leave-group-btn');
    const renameBtn = document.getElementById('rename-group-btn');
    
    if (activeIsGroup) {
        membersBtn.style.display = 'inline-block';
        membersBtn.onclick = () => openMembersModal(user.id);
        
        if (user.isAdmin) {
            disbandBtn.style.display = 'inline-block';
            disbandBtn.onclick = () => disbandGroup(user.id);
            renameBtn.style.display = 'inline-block';
            renameBtn.onclick = () => openRenameModal(user.id, user.userName);
            leaveBtn.style.display = 'none';
        } else {
            disbandBtn.style.display = 'none';
            renameBtn.style.display = 'none';
            leaveBtn.style.display = 'inline-block';
            leaveBtn.onclick = () => leaveGroup(user.id);
        }
    } else {
        disbandBtn.style.display = 'none';
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
                appendMessage(msg.content, msg.senderId === currentUser.id, new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), msg.id, msg.status === 2, msg.isEdited, msg.isDeleted, msg.senderId, msg.quote, msg.reactions, msg.isPinned);
                
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

    hubConnection.on("ReceiveFriendRequest", () => {
        updatePendingBadge();
        showToast(`<i class="fa-solid fa-user-plus" style="color: var(--primary);"></i> <b>Có lời mời kết bạn mới!</b>`, '');
    });
    
    hubConnection.on("FriendRequestAccepted", (userId) => {
        fetchUsers();
        fetchFriends();
        showToast(`<i class="fa-solid fa-user-check" style="color: #2ecc71;"></i> <b>Lời mời kết bạn đã được chấp nhận!</b>`, '');
    });

    hubConnection.on("FriendRemoved", (userId) => {
        fetchUsers();
        fetchFriends();
        
        // Nếu đang mở chat với người này thì đóng phần chat
        if (activeReceiverId === userId) {
            activeReceiverId = null;
            activeConvId = null;
            document.getElementById('active-chat-name').textContent = 'Vui lòng chọn một cuộc trò chuyện';
            document.getElementById('messages-container').innerHTML = '<div class="message system"><span>Cuộc trò chuyện đã đóng do không còn là bạn bè</span></div>';
            document.getElementById('chat-actions-bar').style.display = 'none';
            document.getElementById('friend-actions-bar').style.display = 'none';
        }
    });

    hubConnection.on("MessagePinned", (data) => {
        const banner = document.getElementById('pinned-banner');
        const text = document.getElementById('pinned-text');
        if(banner && text) {
            text.textContent = data.content;
            banner.style.display = 'flex';
            pinnedMessageId = data.messageId;
        }
    });

    hubConnection.on("MessageUnpinned", (data) => {
        const banner = document.getElementById('pinned-banner');
        if(banner) banner.style.display = 'none';
        pinnedMessageId = null;
    });

    hubConnection.on("MessageReacted", (data) => {
        const msgEl = document.querySelector(`[data-msg-id="${data.messageId}"]`);
        if (msgEl) {
            let reactBar = msgEl.querySelector('.reactions-bar');
            if(!reactBar) {
                reactBar = document.createElement('div');
                reactBar.className = 'reactions-bar';
                msgEl.querySelector('.msg-content').appendChild(reactBar);
            }
            reactBar.innerHTML = '';
            for(let r in data.reactions) {
                reactBar.innerHTML += `<span class="reaction-badge">${r} ${data.reactions[r]}</span>`;
            }
        }
    });

    hubConnection.on("ReceiveMessage", (message) => {
        const isFromActive = message.senderId === activeReceiverId || message.conversationId === activeReceiverId;
        const isFromMe = message.senderId === currentUser.id;
        const isSystem = message.content && message.content.startsWith('[SYSTEM]');
        
        if (isFromActive) {
            if (!isFromMe || isSystem) {
                appendMessage(message.content, false, null, message.id, false, false, false, message.senderId, message.quote, message.reactions, message.isPinned);
                if (!isFromMe && document.visibilityState === 'visible') {
                    hubConnection.invoke("MarkAsRead", message.id).catch(console.error);
                }
            }
        } else if (!isFromActive && !isFromMe) {
            showToast(`<i class="fa-solid fa-message" style="color: var(--primary);"></i> <b>${escapeHtml(message.senderName)}</b>: ${escapeHtml(message.content)}`);
        }
        
        // Luôn luôn cập nhật danh sách hội thoại để hiện tin nhắn mới nhất và badge
        fetchUsers();
    });
    
    hubConnection.on("ReceiveMention", (senderName, groupName) => {
        showToast(`<i class="fa-solid fa-at" style="color: #f39c12;"></i> Bạn được nhắc đến bởi <b>${escapeHtml(senderName)}</b> trong nhóm <b>${escapeHtml(groupName)}</b>`);
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
    hubConnection.on("UserTyping", (userId, userName, isGroup) => {
        // Cú pháp C# trả về: UserTyping(userIdStr, userName, isGroup) cho nhóm, 
        // riêng private có thể bị thiếu userName, nên ta linh động
        if (typeof isGroup === 'undefined') {
            isGroup = userName; // Trương hợp Private cũ
            userName = '';
        }
        
        const isMatch = (!isGroup && userId.toLowerCase() === activeReceiverId?.toLowerCase()) || (isGroup && activeIsGroup);
        if (isMatch) {
            let nameToDisplay = userName;
            if (!nameToDisplay) {
                const user = usersList.find(u => u.id.toLowerCase() === userId.toLowerCase());
                nameToDisplay = user ? user.userName : 'Ai đó';
            }
            typingDiv.innerHTML = `<span><i class="fa-solid fa-pen"></i> <b>${escapeHtml(nameToDisplay)}</b> đang gõ...</span>`;
            typingDiv.classList.add('active');
            
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                typingDiv.classList.remove('active');
            }, 5000);
        }
    });

    hubConnection.on("UserStoppedTyping", (userId, isGroup) => {
        const isMatch = (!isGroup && userId.toLowerCase() === activeReceiverId?.toLowerCase()) || (isGroup && activeIsGroup);
        if (isMatch) {
            typingDiv.classList.remove('active');
        }
    });

    hubConnection.on("JoinRequestReceived", (request) => {
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
            sentMsg = await hubConnection.invoke("SendMessageToGroup", activeReceiverId, text, replyToMessageId);
        } else {
            sentMsg = await hubConnection.invoke("SendMessageToUser", activeReceiverId, text, replyToMessageId);
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

function appendMessage(text, isSent, timeStr, msgId = null, isRead = false, isEdited = false, isDeleted = false, senderId = null, quote = null, reactions = null, isPinned = false) {
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

    let contentHtml = '';
    if (isDeleted) {
        contentHtml = '<i class="fa-solid fa-ban"></i> Tin nhắn đã bị xóa';
    } else {
        if(quote) {
            contentHtml += `<div class="quote-block" style="border-left: 3px solid var(--primary); margin-bottom: 5px; padding-left: 5px; opacity: 0.8; font-size: 0.9em;">
                <div class="quote-author"><i class="fa-solid fa-reply"></i> ${escapeHtml(quote.authorName || 'Ai đó')}</div>
                <div class="quote-text">${escapeHtml(quote.content)}</div>
            </div>`;
        }
        let parsedText = escapeHtml(text);
        // Highlight mention @username
        parsedText = parsedText.replace(/@(\w+)/g, '<span class="mention" style="color: var(--primary); font-weight: bold; background: rgba(52, 152, 219, 0.1); padding: 2px 4px; border-radius: 4px;">@$1</span>');
        
        contentHtml += parsedText + (isEdited ? ' <span class="edited-tag">(đã chỉnh sửa)</span>' : '');
    }

    // Context menu button
    let menuBtnHtml = '';
    if (!isDeleted && msgId && !String(msgId).startsWith('temp-')) {
        menuBtnHtml = `<button class="msg-menu-btn" onclick="openMsgContextMenu(event, '${msgId}', ${isSent}, '${escapeHtml(text)}')"><i class="fa-solid fa-ellipsis-vertical"></i></button>`;
    }
    
    // Reactions
    let reactionsHtml = '';
    if(reactions && Object.keys(reactions).length > 0) {
        reactionsHtml = '<div class="reactions-bar" style="display: flex; gap: 5px; margin-top: 5px; font-size: 0.8em; flex-wrap: wrap;">';
        for(let r in reactions) {
            reactionsHtml += `<span class="reaction-badge" style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 10px;">${r} ${reactions[r]}</span>`;
        }
        reactionsHtml += '</div>';
    }

    let hoverReactionsHtml = '';
    if (!isDeleted && msgId && !String(msgId).startsWith('temp-')) {
        hoverReactionsHtml = `
            <div class="msg-hover-reactions">
                <button class="hover-reaction-btn" onclick="reactMessage('${msgId}', '👍')" title="Thích">👍</button>
                <button class="hover-reaction-btn" onclick="reactMessage('${msgId}', '❤️')" title="Yêu">❤️</button>
                <button class="hover-reaction-btn" onclick="reactMessage('${msgId}', '😂')" title="Haha">😂</button>
                <button class="hover-reaction-btn" onclick="reactMessage('${msgId}', '😢')" title="Buồn">😢</button>
                <button class="hover-reaction-btn" onclick="reactMessage('${msgId}', '😡')" title="Phẫn nộ">😡</button>
            </div>
        `;
    }

    msgDiv.innerHTML = `
        <div class="msg-bubble-wrapper">
            ${isSent ? menuBtnHtml : ''}
            ${hoverReactionsHtml}
            <div class="message-bubble msg-content ${isDeleted ? 'deleted-msg' : ''}">${contentHtml}${reactionsHtml}</div>
            ${!isSent ? menuBtnHtml : ''}
        </div>
        <span class="message-time">${time} ${statusHtml} ${isPinned ? '<i class="fa-solid fa-thumbtack" style="color:var(--primary); margin-left: 5px;"></i>' : ''}</span>
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
window.openMsgContextMenu = (event, msgId, isSent, text) => {
    event.stopPropagation();
    document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'msg-context-menu';
    
    let menuItems = '';
    if (isSent) {
        menuItems += `<div class="ctx-item" onclick="startEditMessage('${msgId}')"><i class="fa-solid fa-pen"></i> Sửa</div>`;
    }
    menuItems += `<div class="ctx-item" onclick="replyMessage('${msgId}', '${text}')"><i class="fa-solid fa-reply"></i> Trả lời</div>`;
    menuItems += `<div class="ctx-item" onclick="pinMessage('${msgId}')"><i class="fa-solid fa-thumbtack"></i> Ghim</div>`;
    menuItems += `<div class="ctx-item danger" onclick="deleteMessage('${msgId}')"><i class="fa-solid fa-trash"></i> Xóa</div>`;
    
    menu.innerHTML = menuItems;
    
    const btn = event.currentTarget;
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left - 80}px`;
    menu.style.zIndex = '1000';
    
    document.body.appendChild(menu);
    
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }, { once: true });
    }, 10);
};

window.replyMessage = (msgId, text) => {
    replyToMessageId = msgId;
    document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());
    const editBar = document.getElementById('edit-indicator');
    editBar.innerHTML = `<i class="fa-solid fa-reply" style="color: var(--primary);"></i> Trả lời <button onclick="cancelEdit()" class="cancel-edit-btn"><i class="fa-solid fa-xmark"></i></button>`;
    editBar.style.display = 'flex';
    messageInput.focus();
};

window.pinMessage = async (msgId) => {
    document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());
    if(!await customConfirm('Ghim tin nhắn này?')) return;
    try {
        await hubConnection.invoke('PinMessage', msgId);
    } catch(e) { console.error(e); }
};

window.reactMessage = async (msgId, reaction) => {
    document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());
    try {
        await hubConnection.invoke('ReactMessage', msgId, reaction);
    } catch(e) { console.error(e); }
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
    replyToMessageId = null;
    messageInput.value = '';
    document.getElementById('edit-indicator').style.display = 'none';
};

window.deleteMessage = async (msgId) => {
    document.querySelectorAll('.msg-context-menu').forEach(m => m.remove());
    if (!await customConfirm('Bạn có chắc muốn xóa tin nhắn này?')) return;
    
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
    document.getElementById('members-modal').classList.remove('active');
    if (!await customConfirm('Bạn có chắc muốn xóa thành viên này khỏi nhóm?')) {
        document.getElementById('members-modal').classList.add('active'); // Re-open if cancelled
        return;
    }
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
            await customAlert('Không thể xóa thành viên.');
        }
    } catch (e) { console.error(e); }
};

async function leaveGroup(conversationId) {
    if (!await customConfirm('Bạn có chắc muốn rời nhóm này?')) return;
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
            await customAlert('Không thể rời nhóm.');
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
        if (!newName) { await customAlert('Tên không hợp lệ'); return; }
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
function openCreateGroupModal() {
    document.getElementById('group-name').value = '';
    document.getElementById('group-name-group').style.display = 'block';
    document.getElementById('group-modal-footer').style.display = 'flex';
    document.getElementById('group-code-display').style.display = 'none';
    document.getElementById('group-modal-title').innerHTML = '<i class="fa-solid fa-users" style="color: var(--primary); margin-right: 8px;"></i>Tạo nhóm mới';
    document.getElementById('group-modal').classList.add('active');
}

function closeGroupModal() {
    document.getElementById('group-modal').classList.remove('active');
}

document.getElementById('copy-code-btn').addEventListener('click', () => {
    const code = document.getElementById('new-group-code').textContent;
    let success = false;
    
    // Cách 1: Thử dùng execCommand đồng bộ trước (hoạt động tốt cho HTTP)
    try {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed'; 
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        success = document.execCommand('copy');
        document.body.removeChild(textarea);
    } catch (err) {
        console.error('Lỗi execCommand:', err);
    }

    // Cách 2: Nếu thất bại, thử dùng Clipboard API
    if (!success && navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(code).catch(e => console.error(e));
    }

    const btn = document.getElementById('copy-code-btn');
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Đã chép!';
    setTimeout(() => {
        btn.innerHTML = '<i class="fa-solid fa-copy"></i> Sao chép mã';
    }, 2000);
});

document.getElementById('create-group-btn').addEventListener('click', async () => {
    const name = document.getElementById('group-name').value.trim();
    if (!name) { await customAlert("Vui lòng nhập tên nhóm"); return; }
    
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
            await customAlert("Không thể tạo nhóm: " + errText);
        }
    } catch(err) {
        await customAlert("Lỗi khi tạo nhóm");
    }
});

// Join Group
document.getElementById('join-group-btn').addEventListener('click', async () => {
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!code) { await customAlert("Vui lòng nhập mã tham gia"); return; }
    
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
            await customAlert("Không thể tham gia nhóm. Hãy kiểm tra lại mã.");
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
            await customAlert(`Lỗi: ${errorMsg || 'Không thể xử lý yêu cầu'}`);
        }
    } catch (e) {
        console.error(e);
        await customAlert(`Lỗi: ${e.message}`);
    }
};

// --- Pending Requests Management ---
async function openPendingRequestsModal() {
    const modal = document.getElementById('pending-requests-modal');
    const list = document.getElementById('pending-requests-list');
    list.innerHTML = '<p style="text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải...</p>';
    modal.classList.add('active');

    try {
        const [groupRes, friendRes] = await Promise.all([
            fetch(`${API_BASE}/Chat/group/requests`, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch(`${API_BASE}/Friends/requests`, { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        
        list.innerHTML = '';
        let hasRequests = false;
        
        if (groupRes.ok) {
            const requests = await groupRes.json();
            if (requests.length > 0) {
                hasRequests = true;
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
        
        if (friendRes.ok) {
            const friendReqs = await friendRes.json();
            if (friendReqs.length > 0) {
                hasRequests = true;
                friendReqs.forEach(req => {
                    const item = document.createElement('div');
                    item.className = 'pending-request-item';
                    item.innerHTML = `
                        <div class="pending-request-info">
                            <div class="avatar small"><i class="fa-solid fa-user"></i></div>
                            <div>
                                <span class="pending-request-name">${escapeHtml(req.userName)}</span>
                                <span class="pending-request-group">muốn kết bạn với bạn</span>
                            </div>
                        </div>
                        <div class="pending-request-actions">
                            <button class="btn-approve" onclick="acceptFriend('${req.userId}', this)" title="Chấp nhận"><i class="fa-solid fa-check"></i></button>
                            <button class="btn-reject" onclick="rejectFriend('${req.userId}', this)" title="Từ chối"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    `;
                    list.appendChild(item);
                });
            }
        }
        
        if (!hasRequests) {
            list.innerHTML = '<p class="empty-requests"><i class="fa-solid fa-check-circle"></i> Không có yêu cầu nào đang chờ.</p>';
        }
    } catch (e) {
        list.innerHTML = '<p style="text-align: center; color: var(--danger);">Lỗi tải danh sách yêu cầu.</p>';
        console.error(e);
    }
}

async function updatePendingBadge() {
    try {
        const [groupRes, friendRes] = await Promise.all([
            fetch(`${API_BASE}/Chat/group/requests`, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch(`${API_BASE}/Friends/requests`, { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        
        let totalCount = 0;
        
        if (groupRes.ok) {
            const requests = await groupRes.json();
            totalCount += requests.length;
        }
        
        if (friendRes.ok) {
            const friendReqs = await friendRes.json();
            totalCount += friendReqs.length;
        }
        
        const badge = document.getElementById('pending-badge');
        if (totalCount > 0) {
            badge.textContent = totalCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {
        console.error(e);
    }
}

window.acceptFriend = async (friendId, btn) => {
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/Friends/accept/${friendId}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }});
        if (res.ok) {
            btn.parentElement.parentElement.remove();
            updatePendingBadge();
            fetchUsers();
            fetchFriends();
            showToast('<i class="fa-solid fa-check" style="color: #2ecc71;"></i> <b>Đã chấp nhận kết bạn!</b>', '');
            
            // Check if list is empty or close modal as requested
            const list = document.getElementById('pending-requests-list');
            if (list.children.length === 0) {
                list.innerHTML = '<p class="empty-requests"><i class="fa-solid fa-check-circle"></i> Không có yêu cầu nào đang chờ.</p>';
            }
            document.getElementById('pending-requests-modal').classList.remove('active');
        } else {
            await customAlert("Không thể chấp nhận yêu cầu.");
            btn.disabled = false;
        }
    } catch(e) { console.error(e); btn.disabled = false; }
};

window.rejectFriend = async (friendId, btn) => {
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/Friends/reject/${friendId}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }});
        if (res.ok) {
            btn.parentElement.parentElement.remove();
            updatePendingBadge();
            showToast('<i class="fa-solid fa-xmark" style="color: #e74c3c;"></i> <b>Đã từ chối kết bạn!</b>', '');
            
            const list = document.getElementById('pending-requests-list');
            if (list.children.length === 0) {
                list.innerHTML = '<p class="empty-requests"><i class="fa-solid fa-check-circle"></i> Không có yêu cầu nào đang chờ.</p>';
                document.getElementById('pending-requests-modal').classList.remove('active');
            }
        } else {
            await customAlert("Không thể từ chối yêu cầu.");
            btn.disabled = false;
        }
    } catch(e) { console.error(e); btn.disabled = false; }
};

async function disbandGroup(conversationId) {
    if (!await customConfirm("Bạn có chắc chắn muốn giải tán nhóm này? Hành động này không thể hoàn tác.")) return;
    
    try {
        const res = await fetch(`${API_BASE}/Chat/group/${conversationId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            await customAlert("Giải tán nhóm thành công.");
            await fetchUsers();
            messagesContainer.innerHTML = '';
        } else {
            await customAlert("Không thể giải tán nhóm.");
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
    messageSearchInput.focus();
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
    const bio = document.getElementById('setting-bio').value.trim();
    if (!userName || !email) { await customAlert('Vui lòng nhập đầy đủ thông tin.'); return; }
    
    try {
        const res = await fetch(`${API_BASE}/Auth/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ userName, email, bio })
        });
        if (res.ok) {
            const user = await res.json();
            currentUser.userName = user.userName;
            currentUser.email = user.email;
            currentUser.bio = user.bio;
            currentUsernameSpan.textContent = user.userName;
            const bioSpan = document.getElementById('current-user-bio');
            if (bioSpan) bioSpan.textContent = user.bio || 'Chưa có tiểu sử';
            
            document.getElementById('settings-modal').classList.remove('active');
            showToast('<i class="fa-solid fa-check-circle" style="color: #2ecc71;"></i> Cập nhật hồ sơ thành công!', '');
        } else {
            const err = await res.text();
            await customAlert(err || 'Không thể cập nhật.');
        }
    } catch (e) { console.error(e); }
});


// --- Settings Dropdown & Tabs ---
function toggleSettingsMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('settings-dropdown-menu');
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function openSettingsTab(tab) {
    // Hide dropdown
    document.getElementById('settings-dropdown-menu').style.display = 'none';
    
    // Open settings modal
    document.getElementById('settings-modal').classList.add('active');
    
    const modalContent = document.querySelector('#settings-modal .modal-content');
    const sections = modalContent.querySelectorAll('.settings-section');
    const hrs = modalContent.querySelectorAll('hr');
    const title = modalContent.querySelector('h3');
    
    // Hide all hrs
    hrs.forEach(hr => hr.style.display = 'none');
    
    // Hide all sections and their inner h4 titles
    sections.forEach(s => {
        s.style.display = 'none';
        const h4 = s.querySelector('h4');
        if (h4) h4.style.display = 'none';
    });
    
    if (tab === 'profile' && sections[0]) {
        title.innerHTML = '<i class="fa-solid fa-user" style="color: var(--primary); margin-right: 8px;"></i>Hồ sơ';
        document.getElementById('setting-username').value = currentUser.userName;
        document.getElementById('setting-email').value = currentUser.email;
        sections[0].style.display = 'block';
    } else if (tab === 'blocked' && sections[1]) {
        title.innerHTML = '<i class="fa-solid fa-ban" style="color: var(--primary); margin-right: 8px;"></i>Danh sách chặn';
        sections[1].style.display = 'block';
        fetchBlockedUsers();
    }
}

window.addEventListener('click', (e) => {
    const menu = document.getElementById('settings-dropdown-menu');
    const btn = document.getElementById('settings-dropdown-btn');
    if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.style.display = 'none';
    }
    
    // Đóng modal khi click ra ngoài vùng modal-content
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
    }
});

// --- Custom Modals ---
function customAlert(message, title = 'Thông báo') {
    return new Promise(resolve => {
        document.getElementById('confirm-title').innerHTML = title;
        document.getElementById('confirm-message').innerHTML = message;
        document.getElementById('confirm-cancel-btn').style.display = 'none';
        
        const modal = document.getElementById('confirm-modal');
        const okBtn = document.getElementById('confirm-ok-btn');
        
        const handleOk = () => {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', handleOk);
            resolve();
        };
        okBtn.addEventListener('click', handleOk);
        modal.classList.add('active');
    });
}

function customConfirm(message, title = 'Xác nhận') {
    return new Promise(resolve => {
        document.getElementById('confirm-title').innerHTML = title;
        document.getElementById('confirm-message').innerHTML = message;
        document.getElementById('confirm-cancel-btn').style.display = 'inline-block';
        
        const modal = document.getElementById('confirm-modal');
        const okBtn = document.getElementById('confirm-ok-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');
        
        const handleOk = () => {
            modal.classList.remove('active');
            cleanup();
            resolve(true);
        };
        const handleCancel = () => {
            modal.classList.remove('active');
            cleanup();
            resolve(false);
        };
        
        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
        };
        
        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        modal.classList.add('active');
    });
}

document.getElementById('unpin-btn')?.addEventListener('click', async () => {
    if(!pinnedMessageId) return;
    if(!await customConfirm('Bỏ ghim tin nhắn?')) return;
    await hubConnection.invoke('UnpinMessage', pinnedMessageId);
});

const globalPendingBtn = document.getElementById('pending-requests-btn');
if (globalPendingBtn) {
    globalPendingBtn.addEventListener('click', openPendingRequestsModal);
}
