// Global state
let currentChannel = 'general';
let channels = { 'general': [], 'random': [] };
let servers = [];
let inCall = false;
let localAudioStream = null;
let screenStream = null;
let isScreenSharing = false;
let peerConnections = {};
let isAudioEnabled = true;
let isMuted = false;
let isDeafened = false;
let currentUser = null;
let socket = null;
let token = null;
let currentView = 'friends';
let currentServerId = null;
let currentDMUserId = null;
let currentDMUsername = null; 
let isCallMinimized = false; // ← ДОБАВЬТЕ ЭТУ СТРОКУ
let callTimer = null;
let callStartTime = null;
let chatCallActive = false;
let ringSound = null;
let disconnectSound = null;
let participants = new Map(); // socketId => {username, status}
let connectSound = null;


// Initialize
document.addEventListener('DOMContentLoaded', () => {
    token = localStorage.getItem('token');
    const userStr = localStorage.getItem('currentUser');
    
    if (!token || !userStr) {
        window.location.replace('login.html');
        return;
    }
    
    try {
        currentUser = JSON.parse(userStr);
        initializeApp();
    } catch (e) {
        console.error('Error parsing user data:', e);
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        window.location.replace('login.html');
    }
});

function showChatCall(friendUsername, status = "Calling...") {
    const chatCallInterface = document.getElementById('chatCallInterface');
    chatCallInterface.classList.remove('hidden');
    
    // Обновляем информацию о звонке
    const remoteAvatar = document.getElementById('remoteCallAvatar');
    const remoteName = document.getElementById('remoteCallName');
    const remoteStatus = document.getElementById('remoteCallStatus');
    const callStatusText = document.getElementById('callStatusText');
    
    if (remoteAvatar && friendUsername) {
        remoteAvatar.textContent = friendUsername.charAt(0).toUpperCase();
        remoteName.textContent = friendUsername;
        remoteStatus.textContent = status;
        callStatusText.innerHTML = `<span>${status}</span>`;
    }
    
    // Запускаем таймер если звонок принят
    if (status === "Connected") {
        startCallTimer();
    }
    
    // Добавляем сообщение в чат
    addCallStartedMessage(friendUsername);
    
    chatCallActive = true;
}

// Функция для скрытия звонка в чате
function hideChatCall() {
    const chatCallInterface = document.getElementById('chatCallInterface');
    chatCallInterface.classList.add('hidden');
    
    // Останавливаем демонстрацию экрана если активна
    if (screenStream) {
        stopScreenShare();
    }
    
    // Останавливаем таймер
    stopCallTimer();
    
    chatCallActive = false;
}

// Таймер звонка
function startCallTimer() {
    callStartTime = Date.now();
    updateCallTimerDisplay();
    
    callTimer = setInterval(() => {
        updateCallTimerDisplay();
    }, 1000);
}

function stopCallTimer() {
    if (callTimer) {
        clearInterval(callTimer);
        callTimer = null;
    }
}

function updateCallTimerDisplay() {
    if (!callStartTime) return;
    
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    
    // Обновляем таймер в чат-интерфейсе
    const chatTimerElement = document.getElementById('chatCallTimer');
    if (chatTimerElement) {
        chatTimerElement.textContent = `${minutes}:${seconds}`;
    }
    
    // Также обновляем старый таймер если есть
    const timerElement = document.querySelector('.call-timer');
    if (timerElement) {
        timerElement.textContent = `${minutes}:${seconds}`;
    }
}

// Добавление сообщения о начале звонка
function addCallStartedMessage(friendUsername) {
    const messagesContainer = document.getElementById('messagesContainer');
    
    const callMessage = document.createElement('div');
    callMessage.className = 'call-started-message';
    callMessage.innerHTML = `
        <strong>📞 Начат звонок с ${friendUsername}</strong>
        <div style="font-size: 12px; color: #999; margin-top: 4px;">
            Нажмите на кнопки выше для управления звонком
        </div>
    `;
    
    messagesContainer.appendChild(callMessage);
    scrollToBottom();
}

// Добавление сообщения о завершении звонка
function addCallEndedMessage(friendUsername) {
    const messagesContainer = document.getElementById('messagesContainer');
    
    const callMessage = document.createElement('div');
    callMessage.className = 'call-ended-message';
    callMessage.innerHTML = `
        <strong>📞 Звонок с ${friendUsername} завершен</strong>
        <div style="font-size: 12px; color: #999; margin-top: 4px;">
            Длительность: <span id="callDuration">00:00</span>
        </div>
    `;
    
    messagesContainer.appendChild(callMessage);
    
    // Обновляем длительность
    if (callStartTime) {
        const duration = Math.floor((Date.now() - callStartTime) / 1000);
        const minutes = Math.floor(duration / 60).toString().padStart(2, '0');
        const seconds = (duration % 60).toString().padStart(2, '0');
        document.getElementById('callDuration').textContent = `${minutes}:${seconds}`;
    }
    
    scrollToBottom();
}

// Инициализация контролов чат-звонка
function initializeChatCallControls() {
    const chatToggleAudioBtn = document.getElementById('chatToggleAudioBtn');
    const chatToggleScreenBtn = document.getElementById('chatToggleScreenBtn');
    const chatEndCallBtn = document.getElementById('chatEndCallBtn');
    
    if (chatToggleAudioBtn) {
        chatToggleAudioBtn.addEventListener('click', () => {
            toggleChatAudio();
        });
    }
    
    if (chatToggleScreenBtn) {
        chatToggleScreenBtn.addEventListener('click', () => {
            toggleScreenShare();
        });
    }
    
    if (chatEndCallBtn) {
        chatEndCallBtn.addEventListener('click', () => {
            if (confirm('Завершить звонок?')) {
                endChatCall();
            }
        });
    }
}

// Управление аудио в чат-звонке
function toggleChatAudio() {
    if (!localAudioStream) return;
    
    isAudioEnabled = !isAudioEnabled;
    localAudioStream.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled;
    });
    
    const chatToggleAudioBtn = document.getElementById('chatToggleAudioBtn');
    if (chatToggleAudioBtn) {
        chatToggleAudioBtn.classList.toggle('active', !isAudioEnabled);
    }
    
    // Также обновляем кнопку в обычном интерфейсе
    document.getElementById('toggleAudioBtn')?.classList.toggle('active', !isAudioEnabled);
}

// Завершение чат-звонка
function endChatCall() {
    // Останавливаем демонстрацию экрана если активна
    if (screenStream) {
        stopScreenShare();
    }
    
    // Остальной код остаётся прежним...
    // Отправляем событие завершения звонка
    if (socket && socket.connected) {
        Object.keys(peerConnections).forEach(socketId => {
            socket.emit('end-call', { to: socketId });
        });
    }
    
    // Закрываем все peer connections
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    // Останавливаем медиа потоки
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
        localAudioStream = null;
    }
    
    // Добавляем сообщение о завершении
    if (currentDMUsername) {
        addCallEndedMessage(currentDMUsername);
    }
    
    // Скрываем интерфейс звонка
    hideChatCall();
    
    // Скрываем плавающее окно звонка (если оно есть)
    const callInterface = document.getElementById('callInterface');
    if (callInterface) {
        callInterface.classList.add('hidden');
    }
    
    inCall = false;
    chatCallActive = false;
}

function initializeApp() {
	ringSound = document.getElementById('ringSound');
    disconnectSound = document.getElementById('disconnectSound');
	connectSound = document.getElementById('connectSound');

    // Опционально: проверка, что звуки загрузились
    if (!ringSound) console.error('Не найден элемент #ringSound');
    if (!disconnectSound) console.error('Не найден элемент #disconnectSound');
    updateUserInfo();
    initializeFriendsTabs();
    initializeChannels();
    initializeMessageInput();
    initializeUserControls();
    initializeCallControls();
    initializeServerManagement();
    initializeFileUpload();
    initializeEmojiPicker();
    initializeDraggableCallWindow();
    connectToSocketIO();
    requestNotificationPermission();
    loadUserServers();
    showFriendsView();
	initializeCallFriendButton();
	initializeChatCallControls();	
}

async function ensureLocalAudio() {
    if (localAudioStream) {
        // Проверяем, активен ли еще поток
        const activeTracks = localAudioStream.getTracks().filter(track => track.readyState === 'live');
        if (activeTracks.length > 0) {
            return localAudioStream;
        }
    }

    try {
        localAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });

        console.log('Microphone access granted, stream created:', localAudioStream.id);
        return localAudioStream;
    } catch (err) {
        console.error("Не удалось получить микрофон:", err);
        alert("Не удалось получить доступ к микрофону. Проверьте разрешения.");
        throw err;
    }
}

function initializeCallFriendButton() {
    const callFriendBtn = document.getElementById('callFriendBtn');
    if (callFriendBtn) {
        callFriendBtn.addEventListener('click', () => {
            if (currentDMUserId && currentDMUsername) {
                console.log('Calling friend:', currentDMUserId, currentDMUsername);
                initiateCall(currentDMUserId);
            } else {
                alert('Please select a friend to call first');
            }
        });
    }
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/assets/icon.png' });
    }
}

function updateUserInfo() {
    const userAvatar = document.querySelector('.user-avatar');
    const username = document.querySelector('.username');
    
    if (userAvatar) userAvatar.textContent = currentUser.avatar;
    if (username) username.textContent = currentUser.username;
}

function connectToSocketIO() {
    if (typeof io !== 'undefined') {
        socket = io({ auth: { token: token } });

        socket.on('connect', () => {
            console.log('Connected to server');
        });

        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            if (error.message === 'Authentication error') {
                localStorage.removeItem('token');
                localStorage.removeItem('currentUser');
                window.location.replace('login.html');
            }
        });

        // === Сообщения в каналах ===
        socket.on('new-message', (data) => {
            const channelId = data.channelId;
            const channelName = getChannelNameById(channelId);
            if (!channels[channelName]) {
                channels[channelName] = [];
            }
            channels[channelName].push(data.message);

            if (channelName === currentChannel && currentView === 'server') {
                addMessageToUI(data.message);
                scrollToBottom();
            }

            if (document.hidden) {
                showNotification('New Message', `${data.message.author}: ${data.message.text}`);
            }
        });

        socket.on('reaction-update', (data) => {
            updateMessageReactions(data.messageId, data.reactions);
        });

        // === WebRTC и голосовые звонки ===
        socket.on('user-joined-voice', (data) => {
            console.log('User joined voice:', data);
            createPeerConnection(data.socketId, true);

            // Визуально добавляем участника в звонок
            addParticipant(data.socketId, data.username || 'User');
        });

        socket.on('existing-voice-users', (users) => {
            users.forEach(user => {
                createPeerConnection(user.socketId, false);
                addParticipant(user.socketId, user.username || 'User');
            });
        });

        socket.on('user-left-voice', (socketId) => {
            if (peerConnections[socketId]) {
                peerConnections[socketId].close();
                delete peerConnections[socketId];
            }

            // Удаляем участника из интерфейса и проигрываем звук отключения
            removeParticipant(socketId);
        });

        // === Сигнализация WebRTC ===
        socket.on('offer', async (data) => {
            console.log('Received offer from:', data.from);
            if (!peerConnections[data.from]) {
                await createPeerConnection(data.from, false);
            }
            const pc = peerConnections[data.from];
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.emit('answer', { to: data.from, answer: answer });
            } catch (error) {
                console.error('Error handling offer:', error);
            }
        });

        socket.on('answer', async (data) => {
            console.log('Received answer from:', data.from);
            const pc = peerConnections[data.from];
            if (pc) {
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                } catch (error) {
                    console.error('Error setting remote description:', error);
                }
            }
        });

        socket.on('ice-candidate', async (data) => {
            const pc = peerConnections[data.from];
            if (pc && data.candidate) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (error) {
                    console.error('Error adding ICE candidate:', error);
                }
            }
        });

        // === Личные сообщения (DM) ===
        socket.on('new-dm', (data) => {
            if (data.senderId === currentDMUserId) {
                addMessageToUI({
                    id: data.message.id,
                    author: data.message.author,
                    avatar: data.message.avatar,
                    text: data.message.text,
                    timestamp: data.message.timestamp
                });
                scrollToBottom();
            }
        });

        socket.on('dm-sent', (data) => {
            if (data.receiverId === currentDMUserId) {
                addMessageToUI({
                    id: data.message.id,
                    author: currentUser.username,
                    avatar: currentUser.avatar || currentUser.username.charAt(0).toUpperCase(),
                    text: data.message.text,
                    timestamp: data.message.timestamp
                });
                scrollToBottom();
            }
        });

        socket.on('new-friend-request', () => {
            loadPendingRequests();
            showNotification('New Friend Request', 'You have a new friend request!');
        });

        // === Входящий звонок ===
        socket.on('incoming-call', (data) => {
            const { from, type } = data;
            if (from) {
                showIncomingCall(from, type);

                // Запускаем рингтон
                if (ringSound) {
                    ringSound.currentTime = 0;
                    ringSound.play().catch(e => console.error('Ошибка воспроизведения рингтона:', e));
                }
			
            }
        });

        // === Звонок принят ===
        socket.on('call-accepted', (data) => {
            console.log('Call accepted by:', data.from);

            // Обновляем статус звонка
            const statusEl = document.getElementById('remoteCallStatus');
            const chatStatusEl = document.getElementById('callStatusText');
            if (statusEl) statusEl.textContent = 'Connected';
            if (chatStatusEl) chatStatusEl.innerHTML = `<span>Connected</span>`;

            startCallTimer();

            // Добавляем участника, если ещё нет
            if (data.from && data.from.socketId) {
                addParticipant(data.from.socketId, data.from.username);
                if (!peerConnections[data.from.socketId]) {
                    createPeerConnection(data.from.socketId, true);
                }
            }

            // Останавливаем рингтон
            if (ringSound && !ringSound.paused) {
                ringSound.pause();
                ringSound.currentTime = 0;
            }
			if (connectSound) {
				connectSound.currentTime = 0;
				connectSound.play().catch(e => console.error('Ошибка connect звука:', e));
			}
        });

        // === Звонок отклонён ===
        socket.on('call-rejected', (data) => {
            alert('Call was declined');

            const callInterface = document.getElementById('callInterface');
            if (callInterface) callInterface.classList.add('hidden');

            // Очищаем локальный поток
            if (localAudioStream) {
                localAudioStream.getTracks().forEach(track => track.stop());
                localAudioStream = null;
            }
            inCall = false;

            // Останавливаем рингтон
            if (ringSound && !ringSound.paused) {
                ringSound.pause();
                ringSound.currentTime = 0;
            }
			
        });

        // === Звонок завершён ===
        socket.on('call-ended', (data) => {
            console.log('Call ended by:', data.from);

            if (data.from && peerConnections[data.from]) {
                peerConnections[data.from].close();
                delete peerConnections[data.from];
                removeParticipant(data.from);
            }

            // Если больше никого нет — выходим из звонка
            if (Object.keys(peerConnections).length === 0) {
                leaveVoiceChannel(true);
            }

            // Останавливаем рингтон на всякий случай
            if (ringSound && !ringSound.paused) {
                ringSound.pause();
                ringSound.currentTime = 0;
            }
        });
    }
}

// Initialize friends tabs
function initializeFriendsTabs() {
    const tabs = document.querySelectorAll('.friends-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            switchFriendsTab(tabName);
        });
    });
    
    const searchBtn = document.getElementById('searchUserBtn');
    if (searchBtn) {
        searchBtn.addEventListener('click', searchUsers);
    }
    
    loadFriends();
}

function switchFriendsTab(tabName) {
    document.querySelectorAll('.friends-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    document.querySelectorAll('.friends-list').forEach(l => l.classList.remove('active-tab'));
    const contentMap = {
        'online': 'friendsOnline',
        'all': 'friendsAll',
        'pending': 'friendsPending',
        'add': 'friendsAdd'
    };
    document.getElementById(contentMap[tabName]).classList.add('active-tab');
    
    if (tabName === 'pending') {
        loadPendingRequests();
    }
}

async function loadFriends() {
    try {
        const response = await fetch('/api/friends', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const friends = await response.json();
        displayFriends(friends);
        populateDMList(friends);
    } catch (error) {
        console.error('Error loading friends:', error);
    }
}

function displayFriends(friends) {
    const onlineList = document.getElementById('friendsOnline');
    const allList = document.getElementById('friendsAll');
    
    onlineList.innerHTML = '';
    allList.innerHTML = '';
    
    if (friends.length === 0) {
        onlineList.innerHTML = '<div class="friends-empty">No friends yet</div>';
        allList.innerHTML = '<div class="friends-empty">No friends yet</div>';
        return;
    }
    
    const onlineFriends = friends.filter(f => f.status === 'Online');
    
    if (onlineFriends.length === 0) {
        onlineList.innerHTML = '<div class="friends-empty">No one is online</div>';
    } else {
        onlineFriends.forEach(friend => {
            onlineList.appendChild(createFriendItem(friend));
        });
    }
    
    friends.forEach(friend => {
        allList.appendChild(createFriendItem(friend));
    });
}

function createFriendItem(friend) {
    const div = document.createElement('div');
    div.className = 'friend-item';
    
    div.innerHTML = `
        <div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>
        <div class="friend-info">
            <div class="friend-name">${friend.username}</div>
            <div class="friend-status ${friend.status === 'Online' ? '' : 'offline'}">${friend.status}</div>
        </div>
        <div class="friend-actions">
            <button class="friend-action-btn message" title="Message">💬</button>
            <!-- УБРАТЬ ЭТУ КНОПКУ: <button class="friend-action-btn audio-call" title="Audio Call">📞</button> -->
            <button class="friend-action-btn remove" title="Remove">🗑️</button>
        </div>
    `;

    div.querySelector('.message').addEventListener('click', () => startDM(friend.id, friend.username));
    // УБРАТЬ ЭТУ СТРОКУ: div.querySelector('.audio-call').addEventListener('click', () => initiateCall(friend.id));
    div.querySelector('.remove').addEventListener('click', () => removeFriend(friend.id));
    
    return div;
}

async function searchUsers() {
    const searchInput = document.getElementById('searchUserInput');
    const query = searchInput.value.trim();
    
    if (!query) return;
    
    try {
        const response = await fetch('/api/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const users = await response.json();
        
        const results = users.filter(u => 
            u.username.toLowerCase().includes(query.toLowerCase()) && 
            u.id !== currentUser.id
        );
        
        displaySearchResults(results);
    } catch (error) {
        console.error('Error searching users:', error);
    }
}

function displaySearchResults(users) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '';
    
    if (users.length === 0) {
        resultsDiv.innerHTML = '<div class="friends-empty">No users found</div>';
        return;
    }
    
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-search-item';
        
        div.innerHTML = `
            <div class="user-avatar">${user.avatar || user.username.charAt(0).toUpperCase()}</div>
            <div class="user-info">
                <div class="user-name">${user.username}</div>
            </div>
            <button class="add-friend-btn" onclick="sendFriendRequest(${user.id})">Add Friend</button>
        `;
        
        resultsDiv.appendChild(div);
    });
}

window.sendFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/request', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            alert('Friend request sent!');
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to send request');
        }
    } catch (error) {
        console.error('Error sending friend request:', error);
        alert('Failed to send friend request');
    }
};

async function loadPendingRequests() {
    try {
        const response = await fetch('/api/friends/pending', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const requests = await response.json();
        
        const pendingList = document.getElementById('friendsPending');
        pendingList.innerHTML = '';
        
        if (requests.length === 0) {
            pendingList.innerHTML = '<div class="friends-empty">No pending requests</div>';
            return;
        }
        
        requests.forEach(request => {
            const div = document.createElement('div');
            div.className = 'friend-item';
            
            div.innerHTML = `
                <div class="friend-avatar">${request.avatar || request.username.charAt(0).toUpperCase()}</div>
                <div class="friend-info">
                    <div class="friend-name">${request.username}</div>
                    <div class="friend-status">Incoming Friend Request</div>
                </div>
                <div class="friend-actions">
                    <button class="friend-action-btn accept" onclick="acceptFriendRequest(${request.id})">✓</button>
                    <button class="friend-action-btn reject" onclick="rejectFriendRequest(${request.id})">✕</button>
                </div>
            `;
            
            pendingList.appendChild(div);
        });
    } catch (error) {
        console.error('Error loading pending requests:', error);
    }
}

window.acceptFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/accept', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            loadPendingRequests();
            loadFriends();
        }
    } catch (error) {
        console.error('Error accepting friend request:', error);
    }
};

window.rejectFriendRequest = async function(friendId) {
    try {
        const response = await fetch('/api/friends/reject', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendId })
        });
        
        if (response.ok) {
            loadPendingRequests();
        }
    } catch (error) {
        console.error('Error rejecting friend request:', error);
    }
};

window.removeFriend = async function(friendId) {
    if (!confirm('Are you sure you want to remove this friend?')) return;
    
    try {
        const response = await fetch(`/api/friends/${friendId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            loadFriends();
        }
    } catch (error) {
        console.error('Error removing friend:', error);
    }
};

async function initiateCall(friendId) {
    try {
        await ensureLocalAudio();

        // Показываем интерфейс звонка в чате
        if (currentDMUsername) {
            showChatCall(currentDMUsername);
        }

        window.currentCallDetails = {
            friendId: friendId,
            isInitiator: true
        };

        if (socket && socket.connected) {
            socket.emit('initiate-call', {
                to: friendId,
                type: 'audio',
                from: {
                    id: currentUser.id,
                    username: currentUser.username,
                    socketId: socket.id
                }
            });
        }

        inCall = true;
        chatCallActive = true;
        isAudioEnabled = true;
        updateCallButtons();

    } catch (error) {
        console.error('Error initiating call:', error);
        alert('Не удалось получить доступ к микрофону. Проверьте разрешения.');
        hideChatCall();
    }
}

// Show incoming call notification
function showIncomingCall(caller, type) {
    const incomingCallDiv = document.getElementById('incomingCall');
    const callerName = incomingCallDiv.querySelector('.caller-name');
    const callerAvatar = incomingCallDiv.querySelector('.caller-avatar');

    // Заполняем информацию о звонящем
    callerName.textContent = caller.username || 'Unknown User';
    callerAvatar.textContent = caller.avatar || caller.username?.charAt(0).toUpperCase() || 'U';

    // Показываем окно входящего звонка
    incomingCallDiv.classList.remove('hidden');

    // === Обработчики кнопок ===
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');

    // Принятие звонка
    acceptBtn.onclick = async () => {
        incomingCallDiv.classList.add('hidden');
        await acceptCall(caller);

        // Останавливаем рингтон
        if (ringSound && !ringSound.paused) {
            ringSound.pause();
            ringSound.currentTime = 0;
        }
    };

    // Отклонение звонка
    rejectBtn.onclick = () => {
        incomingCallDiv.classList.add('hidden');
        rejectCall(caller);

        // Останавливаем рингтон
        if (ringSound && !ringSound.paused) {
            ringSound.pause();
            ringSound.currentTime = 0;
        }
    };

    // Автоматическое отклонение через 30 секунд
    setTimeout(() => {
        if (!incomingCallDiv.classList.contains('hidden')) {
            incomingCallDiv.classList.add('hidden');
            rejectCall(caller);

            // Останавливаем рингтон при таймауте
            if (ringSound && !ringSound.paused) {
                ringSound.pause();
                ringSound.currentTime = 0;
            }
        }
    }, 30000);
}

// Accept incoming call
async function acceptCall(caller) {
    try {
        await ensureLocalAudio();

        // Показываем интерфейс звонка в чате
        showChatCall(caller.username);

        window.currentCallDetails = {
            peerId: caller.socketId,
            isInitiator: false
        };

        if (socket && socket.connected) {
            socket.emit('accept-call', {
                to: caller.socketId,
                from: {
                    id: currentUser.id,
                    username: currentUser.username,
                    socketId: socket.id
                }
            });
        }

        inCall = true;
        chatCallActive = true;
        isAudioEnabled = true;
        updateCallButtons();

        if (!peerConnections[caller.socketId]) {
            await createPeerConnection(caller.socketId, false);
        }

    } catch (error) {
        console.error('Error accepting call:', error);
        alert('Не удалось принять звонок. Проверьте доступ к микрофону.');
        hideChatCall();
    }
}

// Reject incoming call
function rejectCall(caller) {
    if (socket && socket.connected) {
        socket.emit('reject-call', { to: caller.socketId });
    }
}

window.startDM = async function(friendId, friendUsername) {
    currentView = 'dm';
    currentDMUserId = friendId;
    currentDMUsername = friendUsername; // <-- СОХРАНЯЕМ ИМЯ
    currentServerId = null;

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';

    // ПОКАЗЫВАЕМ кнопку звонка
    document.getElementById('callFriendBtn').style.display = 'flex';
    
    const chatHeaderInfo = document.getElementById('chatHeaderInfo');
    chatHeaderInfo.innerHTML = `
        <div class="friend-avatar">${friendUsername.charAt(0).toUpperCase()}</div>
        <span class="channel-name">${friendUsername}</span>
    `;
    
    document.getElementById('messageInput').placeholder = `Message @${friendUsername}`;
    
    await loadDMHistory(friendId);
};

function addParticipant(socketId, username) {
    const container = document.getElementById('remoteParticipants');
    if (!container) return;

    // Удаляем, если уже есть
    let div = document.getElementById(`participant-${socketId}`);
    if (!div) {
        div = document.createElement('div');
        div.id = `participant-${socketId}`;
        div.className = 'participant';

        const avatar = document.createElement('div');
        avatar.className = 'participant-avatar';
        avatar.textContent = username.charAt(0).toUpperCase();

        const name = document.createElement('div');
        name.className = 'participant-name';
        name.textContent = username;

        const status = document.createElement('div');
        status.className = 'participant-status';
        status.textContent = 'В звонке';

        div.appendChild(avatar);
        div.appendChild(name);
        div.appendChild(status);
        container.appendChild(div);
    }

    participants.set(socketId, { username, status: 'В звонке' });
    updateNoParticipantsMessage();
}

function updateParticipantStatus(socketId, statusText, extraClass = '') {
    const div = document.getElementById(`participant-${socketId}`);
    if (div) {
        const statusEl = div.querySelector('.participant-status');
        statusEl.textContent = statusText;
        statusEl.className = 'participant-status'; // сбрасываем классы
        if (extraClass) statusEl.classList.add(extraClass);
    }
}

function removeParticipant(socketId) {
    const div = document.getElementById(`participant-${socketId}`);
    if (div) {
        // Показываем, что вышел
        const statusEl = div.querySelector('.participant-status');
        if (statusEl) {
            statusEl.textContent = 'Вышел';
            statusEl.classList.add('offline');
        }
        setTimeout(() => div.remove(), 2000); // удаляем через 2 секунды
    }

    participants.delete(socketId);
    updateNoParticipantsMessage();

    // Звук отключения
    if (disconnectSound) {
        disconnectSound.currentTime = 0;
        disconnectSound.play().catch(e => console.error('Ошибка звука отключения:', e));
    }
}

function updateNoParticipantsMessage() {
    const container = document.getElementById('remoteParticipants');
    let msg = container.querySelector('.no-participants');

    if (participants.size === 0) {
        if (!msg) {
            msg = document.createElement('div');
            msg.className = 'no-participants';
            msg.textContent = 'Вы один в звонке';
            container.appendChild(msg);
        }
    } else if (msg) {
        msg.remove();
    }
}

// Show friends view
function showFriendsView() {
    currentView = 'friends';
    currentDMUserId = null;
    currentDMUsername = null; // <-- СБРАСЫВАЕМ ИМЯ

    document.getElementById('friendsView').style.display = 'flex';
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';
    
    document.getElementById('serverName').textContent = 'Friends';
    
    // СКРЫВАЕМ кнопку звонка
    document.getElementById('callFriendBtn').style.display = 'none';
    
    document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
    document.getElementById('friendsBtn').classList.add('active');
    
    // Hide chat and show friends content
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('friendsView').style.display = 'flex';
}

// Show server view
function showServerView(server) {
    currentView = 'server';
    currentServerId = server.id;
    currentDMUserId = null;
    currentDMUsername = null; // <-- СБРАСЫВАЕМ ИМЯ

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'block';
    document.getElementById('dmListView').style.display = 'none';

    // СКРЫВАЕМ кнопку звонка (в серверах она не нужна)
    document.getElementById('callFriendBtn').style.display = 'none';
    
    document.getElementById('serverName').textContent = server.name;
    switchChannel('general');
}


async function loadUserServers() {
    try {
        const response = await fetch('/api/servers', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        servers = await response.json();
        servers.forEach(server => addServerToUI(server, false));
    } catch (error) {
        console.error('Error loading servers:', error);
    }
}

function initializeServerManagement() {
    const friendsBtn = document.getElementById('friendsBtn');
    const addServerBtn = document.getElementById('addServerBtn');
    
    friendsBtn.addEventListener('click', () => {
        showFriendsView();
    });
    
    addServerBtn.addEventListener('click', () => {
        createNewServer();
    });
}

async function createNewServer() {
    const serverName = prompt('Enter server name:');
    
    if (!serverName || serverName.trim() === '') return;
    
    try {
        const response = await fetch('/api/servers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: serverName.trim() })
        });
        
        if (response.ok) {
            const server = await response.json();
            servers.push(server);
            addServerToUI(server, true);
        }
    } catch (error) {
        console.error('Error creating server:', error);
        alert('Failed to create server');
    }
}

function addServerToUI(server, switchTo = false) {
    const serverList = document.querySelector('.server-list');
    const addServerBtn = document.getElementById('addServerBtn');
    
    const serverIcon = document.createElement('div');
    serverIcon.className = 'server-icon';
    serverIcon.textContent = server.icon;
    serverIcon.title = server.name;
    serverIcon.setAttribute('data-server-id', server.id);
    
    serverIcon.addEventListener('click', () => {
        document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
        serverIcon.classList.add('active');
        showServerView(server);
    });
    
    serverList.insertBefore(serverIcon, addServerBtn);
    
    if (switchTo) {
        serverIcon.click();
    }
}

function initializeChannels() {
    const channelElements = document.querySelectorAll('.channel');
    
    channelElements.forEach(channel => {
        channel.addEventListener('click', () => {
            const channelName = channel.getAttribute('data-channel');
            const isVoiceChannel = channel.classList.contains('voice-channel');
            
            if (isVoiceChannel) {
                joinVoiceChannel(channelName);
            } else {
                switchChannel(channelName);
            }
        });
    });
}

function switchChannel(channelName) {
    currentChannel = channelName;
    
    document.querySelectorAll('.text-channel').forEach(ch => ch.classList.remove('active'));
    const channelEl = document.querySelector(`[data-channel="${channelName}"]`);
    if (channelEl) channelEl.classList.add('active');
    
    document.getElementById('currentChannelName').textContent = channelName;
    document.getElementById('messageInput').placeholder = `Message #${channelName}`;
    
    loadChannelMessages(channelName);
}

async function loadChannelMessages(channelName) {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.innerHTML = '';

    // For now, we'll use a hardcoded channel ID. This needs to be improved.
    const channelId = channelName === 'general' ? 1 : 2;

    try {
        const response = await fetch(`/api/messages/${channelId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const messages = await response.json();
            messages.forEach(message => {
                addMessageToUI({
                    id: message.id,
                    author: message.username,
                    avatar: message.avatar || message.username.charAt(0).toUpperCase(),
                    text: message.content,
                    timestamp: message.created_at
                });
            });
        } else {
            console.error('Failed to load messages');
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }

    scrollToBottom();
}

function initializeMessageInput() {
    const messageInput = document.getElementById('messageInput');
    
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const text = messageInput.value.trim();
    
    if (text === '') return;

    const message = {
        text: text,
    };

    if (socket && socket.connected) {
        if (currentView === 'dm' && currentDMUserId) {
            socket.emit('send-dm', {
                receiverId: currentDMUserId,
                message: message
            });
        } else if (currentView === 'server') {
            const channelId = getChannelIdByName(currentChannel);
            socket.emit('send-message', {
                channelId: channelId,
                message: message
            });
        }
    }
    
    messageInput.value = '';
}

function addMessageToUI(message) {
    const messagesContainer = document.getElementById('messagesContainer');
    
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group';
    messageGroup.setAttribute('data-message-id', message.id || Date.now());
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = message.avatar;
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const header = document.createElement('div');
    header.className = 'message-header';
    
    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = message.author;
    
    const timestamp = document.createElement('span');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = formatTimestamp(message.timestamp);
    
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.text;
    
    const reactionsContainer = document.createElement('div');
    reactionsContainer.className = 'message-reactions';
    reactionsContainer.style.display = 'none'; // Скрываем реакции по умолчанию
    
    const messageActions = document.createElement('div');
    messageActions.className = 'message-actions';
    messageActions.style.opacity = '0'; // Скрываем действия по умолчанию
    messageActions.style.transition = 'opacity 0.2s';
    
    // Кнопка добавления реакции
    const addReactionBtn = document.createElement('button');
    addReactionBtn.className = 'message-action-btn reaction-btn';
    addReactionBtn.innerHTML = '😊';
    addReactionBtn.title = 'Add reaction';
    addReactionBtn.onclick = () => showEmojiPickerForMessage(message.id || Date.now());
    
    messageActions.appendChild(addReactionBtn);
    
    header.appendChild(author);
    header.appendChild(timestamp);
    content.appendChild(header);
    content.appendChild(text);
    content.appendChild(reactionsContainer);
    content.appendChild(messageActions);
    
    messageGroup.appendChild(avatar);
    messageGroup.appendChild(content);
    
    messagesContainer.appendChild(messageGroup);
    
    // Показываем действия при наведении на сообщение
    messageGroup.addEventListener('mouseenter', () => {
        messageActions.style.opacity = '1';
    });
    
    messageGroup.addEventListener('mouseleave', () => {
        messageActions.style.opacity = '0';
    });
    
    // Показываем реакции при клике на сообщение
    messageGroup.addEventListener('click', (e) => {
        if (!e.target.closest('.message-actions') && !e.target.closest('.emoji-picker')) {
            reactionsContainer.style.display = reactionsContainer.style.display === 'none' ? 'flex' : 'none';
        }
    });
}

function formatTimestamp(date) {
    const messageDate = new Date(date);
    const hours = messageDate.getHours().toString().padStart(2, '0');
    const minutes = messageDate.getMinutes().toString().padStart(2, '0');
    return `Today at ${hours}:${minutes}`;
}

function scrollToBottom() {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Emoji picker
function initializeEmojiPicker() {
    const emojiBtn = document.querySelector('.emoji-btn');
    if (emojiBtn) {
        emojiBtn.addEventListener('click', () => {
            showEmojiPickerForInput();
        });
    }
}

function showEmojiPickerForInput() {
    const emojis = ['😀', '😂', '❤️', '👍', '👎', '🎉', '🔥', '✨', '💯', '🚀'];
    const picker = createEmojiPicker(emojis, (emoji) => {
        const input = document.getElementById('messageInput');
        input.value += emoji;
        input.focus();
    });
    document.body.appendChild(picker);
}

function showEmojiPickerForMessage(messageId) {
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
    const picker = createEmojiPicker(emojis, (emoji) => {
        addReaction(messageId, emoji);
    });
    document.body.appendChild(picker);
}

function createEmojiPicker(emojis, onSelect) {
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-option';
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
            onSelect(emoji);
            picker.remove();
        });
        picker.appendChild(btn);
    });
    
    setTimeout(() => {
        document.addEventListener('click', function closePickerAnywhere(e) {
            if (!picker.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePickerAnywhere);
            }
        });
    }, 100);
    
    return picker;
}

function addReaction(messageId, emoji) {
    if (socket && socket.connected) {
        socket.emit('add-reaction', { messageId, emoji });
    }
}

function updateMessageReactions(messageId, reactions) {
    const reactionsContainer = document.querySelector(`[data-message-id="${messageId}"] .message-reactions`);
    if (!reactionsContainer) return;
    
    reactionsContainer.innerHTML = '';
    
    if (reactions.length === 0) {
        reactionsContainer.style.display = 'none';
        return;
    }
    
    reactionsContainer.style.display = 'flex';
    
    reactions.forEach(reaction => {
        const reactionEl = document.createElement('div');
        reactionEl.className = 'reaction';
        reactionEl.innerHTML = `${reaction.emoji} <span>${reaction.count}</span>`;
        reactionEl.title = reaction.users;
        reactionEl.addEventListener('click', () => {
            if (socket && socket.connected) {
                socket.emit('remove-reaction', { messageId, emoji: reaction.emoji });
            }
        });
        reactionsContainer.appendChild(reactionEl);
    });
}

// File upload
function initializeFileUpload() {
    const attachBtn = document.querySelector('.attach-btn');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    
    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            await uploadFile(file);
        }
        fileInput.value = '';
    });
}

async function uploadFile(file) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('channelId', currentChannel);
        
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Upload failed');
        }
        
        const fileData = await response.json();
        
        const message = {
            author: currentUser.username,
            avatar: currentUser.avatar,
            text: `Uploaded ${file.name}`,
            file: fileData,
            timestamp: new Date()
        };
        
        if (socket && socket.connected) {
            socket.emit('send-message', {
                channel: currentChannel,
                message: message
            });
        }
        
    } catch (error) {
        console.error('Upload error:', error);
        alert('Failed to upload file');
    }
}

// User controls
function initializeUserControls() {
    const muteBtn = document.getElementById('muteBtn');
    const deafenBtn = document.getElementById('deafenBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        muteBtn.querySelector('.icon-normal').style.display = isMuted ? 'none' : 'block';
        muteBtn.querySelector('.icon-slashed').style.display = isMuted ? 'block' : 'none';
        
        if (localAudioStream) {
            localAudioStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
    });
    
    deafenBtn.addEventListener('click', () => {
        isDeafened = !isDeafened;
        deafenBtn.querySelector('.icon-normal').style.display = isDeafened ? 'none' : 'block';
        deafenBtn.querySelector('.icon-slashed').style.display = isDeafened ? 'block' : 'none';
        
        // When deafened, also mute microphone
        if (isDeafened) {
            if (!isMuted) {
                isMuted = true;
                muteBtn.querySelector('.icon-normal').style.display = 'none';
                muteBtn.querySelector('.icon-slashed').style.display = 'block';
            }
            
            // Mute all remote audio
            document.querySelectorAll('.audio-element').forEach(audio => {
                audio.volume = 0;
            });
        } else {
            // Unmute remote audio
            document.querySelectorAll('.audio-element').forEach(audio => {
                audio.volume = 1;
            });
        }

        // Update local stream audio tracks
        if (localAudioStream) {
            localAudioStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
    });
    
    settingsBtn.addEventListener('click', () => {
        if (confirm('Do you want to logout?')) {
            if (inCall) leaveVoiceChannel();
            localStorage.removeItem('token');
            localStorage.removeItem('currentUser');
            if (socket) socket.disconnect();
            window.location.replace('login.html');
        }
    });
}

// Voice channel functions
async function joinVoiceChannel(channelName) {
    if (inCall) {
        const callInterface = document.getElementById('callInterface');
        if (callInterface.classList.contains('hidden')) {
            callInterface.classList.remove('hidden');
        }
        return;
    }
    
    inCall = true;
    
    document.querySelectorAll('.voice-channel').forEach(ch => ch.classList.remove('in-call'));
    const channelEl = document.querySelector(`[data-channel="${channelName}"]`);
    if (channelEl) channelEl.classList.add('in-call');
    
    const callInterface = document.getElementById('callInterface');
    callInterface.classList.remove('hidden');
    
    document.querySelector('.call-channel-name').textContent = channelName;
    
    try {
        await ensureLocalAudio();
        
        // Connect to the socket for voice
        if (socket && socket.connected) {
            socket.emit('join-voice-channel', { channelName, userId: currentUser.id });
        }

    } catch (error) {
        console.error('Error initializing media:', error);
        alert('Error accessing microphone. Please grant permissions.');
        leaveVoiceChannel(true); // Force leave
    }
}

function leaveVoiceChannel(force = false) {
    if (!inCall) return;

    if (force) {
        inCall = false;

        if (localAudioStream) {
            localAudioStream.getTracks().forEach(track => track.stop());
            localAudioStream = null;
        }

        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }
        
        if (socket && socket.connected) {
            socket.emit('leave-voice-channel', currentChannel);
        }

        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};

        document.querySelectorAll('.voice-channel').forEach(ch => ch.classList.remove('in-call'));
        document.getElementById('remoteParticipants').innerHTML = '';
    }

    const callInterface = document.getElementById('callInterface');
    callInterface.classList.add('hidden');

    if (force) {
        isAudioEnabled = true;
        updateCallButtons();
    }
}

function initializeCallControls() {
    const closeCallBtn = document.getElementById('closeCallBtn');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    const endCallBtn = document.getElementById('endCallBtn'); // Новая кнопка завершения звонка
    
    closeCallBtn.addEventListener('click', () => {
        if (window.currentCallDetails) {
            Object.keys(peerConnections).forEach(socketId => {
                if (socket && socket.connected) {
                    socket.emit('end-call', { to: socketId });
                }
            });
        }
        leaveVoiceChannel(true);
    });
    
    // Новая кнопка завершения звонка
    if (endCallBtn) {
        endCallBtn.addEventListener('click', () => {
            if (window.currentCallDetails) {
                Object.keys(peerConnections).forEach(socketId => {
                    if (socket && socket.connected) {
                        socket.emit('end-call', { to: socketId });
                    }
                });
            }
            leaveVoiceChannel(true);
        });
    }
    
    toggleAudioBtn.addEventListener('click', () => {
        toggleAudio();
    });
    
    toggleScreenBtn.addEventListener('click', () => {
        toggleScreenShare();
    });
}

function toggleAudio() {
    if (!localAudioStream) return;
    
    isAudioEnabled = !isAudioEnabled;
    localAudioStream.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled;
    });
    
    if (!isAudioEnabled) {
        isMuted = true;
        document.getElementById('muteBtn').classList.add('active');
    } else {
        isMuted = false;
        document.getElementById('muteBtn').classList.remove('active');
    }
    
    updateCallButtons();
}

async function toggleScreenShare(enabled = null) {
    if (enabled === null) enabled = !isScreenSharing;

    if (enabled) {
        if (screenStream) return; // Уже демонстрируем

        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true  // Включает системный звук (работает в Chrome с флагом, в Firefox — частично)
            });

            // Локальный предпросмотр в плавающем окне
            const floatingVideo = document.getElementById('floatingScreenVideo');
            floatingVideo.srcObject = screenStream;
            document.getElementById('floatingScreenShare').classList.remove('hidden');

            // Добавляем все треки экрана во ВСЕ активные peer-соединения
            screenStream.getTracks().forEach(track => {
                Object.values(peerConnections).forEach(pc => {
                    pc.addTrack(track, screenStream);
                });
            });

            // Автоматически выключаем при нажатии "Stop sharing" в браузере
            screenStream.getVideoTracks()[0].addEventListener('ended', () => {
                toggleScreenShare(false);
            });

            isScreenSharing = true;
            updateScreenShareButton(true);
        } catch (err) {
            console.error('Не удалось начать демонстрацию экрана:', err);
            alert('Не удалось получить доступ к экрану. Проверьте разрешения.');
        }
    } else {
        if (!screenStream) return;

        // Останавливаем все треки
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;

        // Скрываем локальный предпросмотр
        document.getElementById('floatingScreenShare').classList.add('hidden');

        // Удаляем треки экрана из всех peer-соединений
        Object.values(peerConnections).forEach(pc => {
            pc.getSenders().forEach(sender => {
                if (sender.track && (
                    sender.track.label.toLowerCase().includes('screen') ||
                    sender.track.label.toLowerCase().includes('monitor') ||
                    sender.track.label.toLowerCase().includes('display')
                )) {
                    pc.removeTrack(sender);
                }
            });
        });

        isScreenSharing = false;
        updateScreenShareButton(false);
    }
}


async function createRenegotiationOffer(pc, socketId) {
    try {
        console.log('Creating renegotiation offer for', socketId);
        
        // Создаем новое предложение
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        console.log('Renegotiation offer created, sending to', socketId);
        
        // Отправляем новое предложение удаленному пользователю
        if (socket && socket.connected) {
            socket.emit('offer', {
                to: socketId,
                offer: pc.localDescription
            });
        }
        
    } catch (error) {
        console.error('Error creating renegotiation offer:', error);
    }
}

async function renegotiate(pc) {
    if (!pc || pc.signalingState !== 'stable') {
        console.warn('Cannot renegotiate: signalingState is not stable', pc.signalingState);
        return;
    }

    try {
        console.log('Starting renegotiation');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        // Send the new offer to the remote peer (replace 'remoteSocketId' with actual ID)
        // Note: In a multi-user setup, you'd need the socketId associated with this pc
        const remoteSocketId = Object.keys(peerConnections).find(key => peerConnections[key] === pc);
        if (remoteSocketId) {
            socket.emit('offer', {
                to: remoteSocketId,
                offer: pc.localDescription
            });
            console.log('Renegotiation offer sent to', remoteSocketId);
        } else {
            console.error('No socketId found for this peer connection');
        }
    } catch (error) {
        console.error('Error during renegotiation:', error);
    }
}

function updateScreenShareButton(active) {
    const btn = document.getElementById('toggleScreenBtn');
    if (btn) {
        btn.classList.toggle('active', active);
    }
}

function handleRemoteTrack(event, remoteSocketId) {
    const track = event.track;
    const stream = new MediaStream([track]);

    if (track.kind === 'video') {
        const label = track.label.toLowerCase();

        // Определяем, это экран или камера
        if (label.includes('screen') || label.includes('monitor') || label.includes('display') || label.includes('window')) {
            // Это демонстрация экрана — показываем отдельно
            createOrUpdateRemoteScreenShare(remoteSocketId, stream);
        } else {
            // Это камера — показываем в основном видео
            const remoteVideo = document.getElementById(`remote-video-${remoteSocketId}`);
            if (remoteVideo) {
                if (!remoteVideo.srcObject) remoteVideo.srcObject = new MediaStream();
                remoteVideo.srcObject.addTrack(track);
                remoteVideo.play().catch(e => console.error('Ошибка воспроизведения камеры:', e));
            }
        }
    }
}

function createOrUpdateRemoteScreenShare(socketId, stream) {
    let container = document.getElementById(`remote-screen-${socketId}`);

    if (!container) {
        container = document.createElement('div');
        container.id = `remote-screen-${socketId}`;
        container.className = 'remote-screen-share';

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.className = 'remote-screen-video';

        const label = document.createElement('div');
        label.className = 'screen-share-label';
        label.textContent = 'Экран собеседника';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'screen-close-btn';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = () => container.remove();

        container.appendChild(video);
        container.appendChild(label);
        container.appendChild(closeBtn);

        // Вставляем в область звонка (например, в .call-banner или .chat-call-participants)
        const parent = document.querySelector('.call-banner') || document.body;
        parent.appendChild(container);

        // Делаем перемещаемым и изменяемым по размеру
        makeDraggable(container);
        makeResizable(container);
    }

    const video = container.querySelector('video');
    video.srcObject = stream;
    video.play().catch(e => console.error('Ошибка воспроизведения экрана:', e));
}

function makeDraggable(el) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    el.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        if (e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDrag;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        el.style.top = (el.offsetTop - pos2) + "px";
        el.style.left = (el.offsetLeft - pos1) + "px";
    }

    function closeDrag() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

function showLocalScreenShare(stream) {
    const remoteParticipants = document.getElementById('remoteParticipants');
    if (!remoteParticipants) return;
    
    // Удаляем старую локальную демонстрацию если есть
    const oldLocalScreen = document.getElementById('screen-share-local');
    if (oldLocalScreen) {
        oldLocalScreen.remove();
    }
    
    // Создаем элемент для локальной демонстрации
    const screenShareDiv = document.createElement('div');
    screenShareDiv.className = 'participant screen-share local';
    screenShareDiv.id = 'screen-share-local';
    
    const videoElement = document.createElement('video');
    videoElement.className = 'screen-video';
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.muted = true; // Не нужно слышать свой же экран
    
    const screenShareLabel = document.createElement('div');
    screenShareLabel.className = 'participant-name';
    screenShareLabel.textContent = 'Your Screen';
    screenShareLabel.style.color = '#4CAF50';
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'screen-controls';
    
    // Кнопка остановки демонстрации
    const stopButton = document.createElement('button');
    stopButton.className = 'screen-control-btn stop-btn';
    stopButton.innerHTML = '⏹';
    stopButton.title = 'Stop Sharing';
    stopButton.onclick = () => toggleScreenShare();
    
    controlsDiv.appendChild(stopButton);
    
    screenShareDiv.appendChild(videoElement);
    screenShareDiv.appendChild(screenShareLabel);
    screenShareDiv.appendChild(controlsDiv);
    
    // Вставляем в начало списка участников
    remoteParticipants.insertBefore(screenShareDiv, remoteParticipants.firstChild);
    
    // Устанавливаем поток
    videoElement.srcObject = stream;
    
    // Автоматическое воспроизведение
    videoElement.play().catch(e => {
        console.error('Error playing local screen share:', e);
    });
}


function showScreenShare(stream) {
    const screenShareContainer = document.getElementById('screenShareContainer');
    const screenShareVideo = document.getElementById('screenShareVideo');
    const chatCallParticipants = document.querySelector('.chat-call-participants');
    
    if (screenShareContainer && screenShareVideo) {
        // Показываем контейнер
        screenShareContainer.classList.remove('hidden');
        
        // Добавляем класс для затемнения фона
        chatCallParticipants.classList.add('has-screen-share');
        
        // Устанавливаем поток в видео элемент
        screenShareVideo.srcObject = stream;
        
        // Автовоспроизведение
        screenShareVideo.play().catch(e => {
            console.error('Error playing screen share video:', e);
        });
        
        // Настройка обработчика для кнопки остановки
        const stopScreenShareBtn = document.getElementById('stopScreenShareBtn');
        if (stopScreenShareBtn) {
            stopScreenShareBtn.onclick = () => toggleScreenShare();
        }
    }
}

function stopScreenShare() {
    console.log('Stopping screen share');
    
    if (screenStream) {
        // Останавливаем все треки
        screenStream.getTracks().forEach(track => {
            console.log('Stopping track:', track.id, track.kind);
            track.stop();
        });
        
        // Удаляем видео-треки из всех соединений
        Object.keys(peerConnections).forEach(socketId => {
            const pc = peerConnections[socketId];
            if (pc) {
                const senders = pc.getSenders();
                senders.forEach(sender => {
                    if (sender.track && sender.track.kind === 'video') {
                        console.log('Removing video sender from connection with', socketId);
                        pc.removeTrack(sender);
                    }
                });
                
                // Создаем новое предложение БЕЗ видео-трека
                createRenegotiationOffer(pc, socketId);
            }
        });
        
        screenStream = null;
    }
    
    // Удаляем локальный элемент демонстрации
    removeScreenShareElement();
    
    // Обновляем кнопку
    updateScreenShareButton(false);
	debugPeerConnections();
    console.log('Screen share stopped');
}
	
	// Добавьте в глобальную область видимости
// Добавьте эту функцию в глобальную область видимости (например, рядом с другими глобальными функциями)
function debugPeerConnections() {
    console.log('=== DEBUG: Peer Connections ===');
    console.log('Active connections:', Object.keys(peerConnections).length);
    
    Object.keys(peerConnections).forEach(socketId => {
        const pc = peerConnections[socketId];
        console.log(`\nConnection to ${socketId}:`);
        console.log('  State:', pc.connectionState);
        console.log('  ICE state:', pc.iceConnectionState);
        console.log('  Signaling:', pc.signalingState);
        
        const senders = pc.getSenders();
        console.log('  Senders:', senders.length);
        senders.forEach((sender, i) => {
            if (sender.track) {
                console.log(`    ${i}: ${sender.track.kind} - ${sender.track.label} (${sender.track.readyState})`);
            } else {
                console.log(`    ${i}: No track`);
            }
        });
        
        const receivers = pc.getReceivers();
        console.log('  Receivers:', receivers.length);
        receivers.forEach((receiver, i) => {
            if (receiver.track) {
                console.log(`    ${i}: ${receiver.track.kind} - ${receiver.track.label} (${receiver.track.readyState})`);
            } else {
                console.log(`    ${i}: No track`);
            }
        });
    });
    
    console.log('Screen stream active:', !!screenStream);
    if (screenStream) {
        console.log('Screen tracks:', screenStream.getTracks().length);
        screenStream.getTracks().forEach((track, i) => {
            console.log(`  Track ${i}: ${track.kind} - ${track.label} (${track.readyState})`);
        });
    }
    console.log('Local audio stream active:', !!localAudioStream);
    console.log('========================\n');
}

// Функция обновления кнопки демонстрации экрана
function updateScreenShareButton(isActive) {
    const chatToggleScreenBtn = document.getElementById('chatToggleScreenBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    
    if (chatToggleScreenBtn) {
        chatToggleScreenBtn.classList.toggle('screen-active', isActive);
        chatToggleScreenBtn.title = isActive ? 'Stop sharing screen' : 'Share screen';
    }
    
    if (toggleScreenBtn) {
        toggleScreenBtn.classList.toggle('screen-active', isActive);
        toggleScreenBtn.title = isActive ? 'Stop sharing screen' : 'Share screen';
    }
}

// Создать элемент для демонстрации экрана
function createScreenShareElement(stream) {
    const remoteParticipants = document.getElementById('remoteParticipants');
    
    // Создаем контейнер для демонстрации экрана
    const screenShareDiv = document.createElement('div');
    screenShareDiv.className = 'participant screen-share';
    screenShareDiv.id = 'screen-share-local';
    
    // Создаем видео элемент
    const videoElement = document.createElement('video');
    videoElement.className = 'screen-video';
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.muted = true; // Не нужно слышать свой же экран
    
    const screenShareLabel = document.createElement('div');
    screenShareLabel.className = 'participant-name';
    screenShareLabel.textContent = 'Your Screen';
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'screen-controls';
    
    // Кнопка развернуть на полный экран
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'screen-control-btn fullscreen-btn';
    fullscreenBtn.innerHTML = '⛶';
    fullscreenBtn.title = 'Fullscreen';
    fullscreenBtn.onclick = () => {
        if (videoElement.requestFullscreen) {
            videoElement.requestFullscreen();
        } else if (videoElement.webkitRequestFullscreen) {
            videoElement.webkitRequestFullscreen();
        } else if (videoElement.mozRequestFullScreen) {
            videoElement.mozRequestFullScreen();
        }
    };
    
    // Кнопка остановки демонстрации экрана
    const stopButton = document.createElement('button');
    stopButton.className = 'screen-control-btn stop-btn';
    stopButton.innerHTML = '⏹';
    stopButton.title = 'Stop Sharing';
    stopButton.onclick = () => toggleScreenShare();
    
    controlsDiv.appendChild(fullscreenBtn);
    controlsDiv.appendChild(stopButton);
    
    screenShareDiv.appendChild(videoElement);
    screenShareDiv.appendChild(screenShareLabel);
    screenShareDiv.appendChild(controlsDiv);
    remoteParticipants.appendChild(screenShareDiv);
    
    // Устанавливаем поток в видео элемент
    videoElement.srcObject = stream;
    
    // Автоматическое воспроизведение
    videoElement.play().catch(e => {
        console.error('Error playing screen share video:', e);
    });
    
    // Добавляем возможность изменения размера
    makeResizable(screenShareDiv);
}

// Удалить элемент демонстрации экрана
function removeScreenShareElement() {
    const screenShareDiv = document.getElementById('screen-share-local');
    if (screenShareDiv) {
        screenShareDiv.remove();
    }
}

function updateCallButtons() {
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    
    if (toggleAudioBtn) {
        toggleAudioBtn.classList.toggle('active', !isAudioEnabled);
    }
    
    if (toggleScreenBtn) {
        toggleScreenBtn.classList.toggle('active', screenStream !== null);
    }
}

function initializeDraggableCallWindow() {
   const callInterface = document.getElementById('callInterface');
   const callHeader = callInterface.querySelector('.call-header');
   let isDragging = false;
   let offsetX, offsetY;

   callHeader.addEventListener('mousedown', (e) => {
       isDragging = true;
       offsetX = e.clientX - callInterface.offsetLeft;
       offsetY = e.clientY - callInterface.offsetTop;
       callInterface.style.transition = 'none';
   });

   document.addEventListener('mousemove', (e) => {
       if (isDragging) {
           let newX = e.clientX - offsetX;
           let newY = e.clientY - offsetY;

           const maxX = window.innerWidth - callInterface.offsetWidth;
           const maxY = window.innerHeight - callInterface.offsetHeight;

           newX = Math.max(0, Math.min(newX, maxX));
           newY = Math.max(0, Math.min(newY, maxY));

           callInterface.style.left = `${newX}px`;
           callInterface.style.top = `${newY}px`;
       }
   });

   document.addEventListener('mouseup', () => {
       if (isDragging) {
           isDragging = false;
           callInterface.style.transition = 'all 0.3s ease';
       }
   });
   
   // Добавляем возможность изменения размера окна звонка
   makeResizable(callInterface);
}

function getChannelIdByName(name) {
   return name === 'general' ? 1 : 2;
}

function getChannelNameById(id) {
   return id === 1 ? 'general' : 'random';
}

async function loadDMHistory(userId) {
   const messagesContainer = document.getElementById('messagesContainer');
   messagesContainer.innerHTML = '';

   try {
       const response = await fetch(`/api/dm/${userId}`, {
           headers: { 'Authorization': `Bearer ${token}` }
       });
       if (response.ok) {
           const messages = await response.json();
           messages.forEach(message => {
               addMessageToUI({
                   id: message.id,
                   author: message.username,
                   avatar: message.avatar || message.username.charAt(0).toUpperCase(),
                   text: message.content,
                   timestamp: message.created_at
               });
           });
       } else {
           console.error('Failed to load DM history');
       }
   } catch (error) {
       console.error('Error loading DM history:', error);
   }

   scrollToBottom();
}

console.log('Discord Clone initialized successfully!');
if (currentUser) {
   console.log('Logged in as:', currentUser.username);
}

function populateDMList(friends) {
    const dmList = document.getElementById('dmList');
    dmList.innerHTML = '';

    if (friends.length === 0) {
        const emptyDM = document.createElement('div');
        emptyDM.className = 'empty-dm-list';
        emptyDM.textContent = 'No conversations yet.';
        dmList.appendChild(emptyDM);
        return;
    }

    friends.forEach(friend => {
        const dmItem = document.createElement('div');
        dmItem.className = 'channel';
        dmItem.setAttribute('data-dm-id', friend.id);
        dmItem.innerHTML = `
            <div class="friend-avatar">${friend.avatar || friend.username.charAt(0).toUpperCase()}</div>
            <span>${friend.username}</span>
            <!-- УБРАТЬ ЭТУ СТРОКУ: <button class="dm-call-btn" title="Call ${friend.username}" data-friend-id="${friend.id}">📞</button> -->
        `;
        dmItem.addEventListener('click', () => {
            startDM(friend.id, friend.username);
        });
        dmList.appendChild(dmItem);
    });
}

// WebRTC Functions
async function createPeerConnection(remoteSocketId, isInitiator) {
    console.log(`Creating peer connection with ${remoteSocketId}, initiator: ${isInitiator}`);
    
    if (peerConnections[remoteSocketId]) {
        console.log('Peer connection already exists');
        return peerConnections[remoteSocketId];
    }
    
    // Убеждаемся, что у нас есть локальный аудио поток
    if (!localAudioStream) {
        try {
            await ensureLocalAudio();
        } catch (error) {
            console.error('Failed to get local audio stream:', error);
            return null;
        }
    }
    
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
    });

    peerConnections[remoteSocketId] = pc;

    // Добавляем локальный аудио поток
    if (localAudioStream) {
        const audioTracks = localAudioStream.getAudioTracks();
        console.log(`Adding ${audioTracks.length} audio tracks`);
        
        audioTracks.forEach(track => {
            console.log(`Adding audio track: ${track.label}, enabled: ${track.enabled}`);
            pc.addTrack(track, localAudioStream);
        });
    }
    
    // Если есть экранный поток (демонстрация экрана), добавляем его тоже
    if (screenStream) {
        const videoTracks = screenStream.getVideoTracks();
        console.log(`Adding ${videoTracks.length} video tracks from screen`);
        
        videoTracks.forEach(track => {
            console.log(`Adding screen track: ${track.label}`);
            pc.addTrack(track, screenStream);
        });
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate to', remoteSocketId);
            socket.emit('ice-candidate', {
                to: remoteSocketId,
                candidate: event.candidate
            });
        }
    };
    
    // Handle connection state changes
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for ${remoteSocketId}: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed') {
            console.error('ICE connection failed');
        }
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            console.log('Peer connection established successfully with', remoteSocketId);
        }
    };
    
    pc.onconnectionstatechange = () => {
        console.log(`Connection state for ${remoteSocketId}: ${pc.connectionState}`);
    };

    // Handle incoming remote stream
pc.ontrack = (event) => {
    console.log('Received remote track from', remoteSocketId, 
                'kind:', event.track.kind, 
                'label:', event.track.label,
                'streams:', event.streams.length);
        
        const remoteParticipants = document.getElementById('remoteParticipants');
        
        let participantDiv = document.getElementById(`participant-${remoteSocketId}`);
        
        if (!participantDiv) {
            participantDiv = document.createElement('div');
            participantDiv.className = 'participant';
            participantDiv.id = `participant-${remoteSocketId}`;
            
            // Создаем аудио элемент для удаленного аудио
            const audioElement = document.createElement('audio');
            audioElement.id = `remote-audio-${remoteSocketId}`;
            audioElement.className = 'audio-element';
            audioElement.autoplay = true;
            audioElement.playsInline = true;
            audioElement.volume = isDeafened ? 0 : 1;
            
            const participantName = document.createElement('div');
            participantName.className = 'participant-name';
            participantName.textContent = 'Friend';
            
            const participantStatus = document.createElement('div');
            participantStatus.className = 'participant-status';
            participantStatus.textContent = 'Speaking...';
            participantStatus.style.display = 'none';
            
            participantDiv.appendChild(audioElement);
            participantDiv.appendChild(participantName);
            participantDiv.appendChild(participantStatus);
            remoteParticipants.appendChild(participantDiv);
        }
        
        // Если это видео-трек (демонстрация экрана от другого пользователя)
        if (event.track.kind === 'video') {
            console.log('Received screen share from', remoteSocketId);
            createRemoteScreenShareElement(remoteSocketId, event.streams[0]);
        }
        // Если это аудио-трек
        else if (event.track.kind === 'audio') {
            console.log('Setting remote audio stream for', remoteSocketId);
            const audioElement = document.getElementById(`remote-audio-${remoteSocketId}`);
            if (audioElement) {
                audioElement.srcObject = event.streams[0];
                
                // Автоматическое воспроизведение
                audioElement.play().catch(e => {
                    console.error('Error playing remote audio:', e);
                    // Пытаемся воспроизвести после пользовательского взаимодействия
                    document.addEventListener('click', () => {
                        audioElement.play().catch(err => console.error('Still cannot play:', err));
                    }, { once: true });
                });
            }
        }
    };

    // Create offer if initiator
    if (isInitiator) {
        try {
            const offer = await pc.createOffer();
            console.log('Created offer for', remoteSocketId);
            await pc.setLocalDescription(offer);
            console.log('Sending offer to:', remoteSocketId);
            socket.emit('offer', {
                to: remoteSocketId,
                offer: pc.localDescription
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }
    
	debugPeerConnections();
	
    return pc;
}

// Создать элемент для удаленной демонстрации экрана
function createRemoteScreenShareElement(socketId, stream) {
    const remoteParticipants = document.getElementById('remoteParticipants');
    
    // Удаляем старый элемент если существует
    const oldElement = document.getElementById(`screen-share-remote-${socketId}`);
    if (oldElement) {
        oldElement.remove();
    }
    
    // Создаем контейнер для удаленной демонстрации экрана
    const screenShareDiv = document.createElement('div');
    screenShareDiv.className = 'participant screen-share remote';
    screenShareDiv.id = `screen-share-remote-${socketId}`;
    
    // Создаем видео элемент
    const videoElement = document.createElement('video');
    videoElement.className = 'screen-video';
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    
    const screenShareLabel = document.createElement('div');
    screenShareLabel.className = 'participant-name';
    screenShareLabel.textContent = `Friend's Screen`;
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'screen-controls';
    
    // Кнопка развернуть на полный экран
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'screen-control-btn fullscreen-btn';
    fullscreenBtn.innerHTML = '⛶';
    fullscreenBtn.title = 'Fullscreen';
    fullscreenBtn.onclick = () => {
        if (videoElement.requestFullscreen) {
            videoElement.requestFullscreen();
        } else if (videoElement.webkitRequestFullscreen) {
            videoElement.webkitRequestFullscreen();
        } else if (videoElement.mozRequestFullScreen) {
            videoElement.mozRequestFullScreen();
        }
    };
    
    controlsDiv.appendChild(fullscreenBtn);
    
    screenShareDiv.appendChild(videoElement);
    screenShareDiv.appendChild(screenShareLabel);
    screenShareDiv.appendChild(controlsDiv);
    remoteParticipants.appendChild(screenShareDiv);
    
    // Устанавливаем поток в видео элемент
    videoElement.srcObject = stream;
    
    // Автоматическое воспроизведение
    videoElement.play().catch(e => {
        console.error('Error playing remote screen share video:', e);
    });
    
    // Добавляем возможность изменения размера
    makeResizable(screenShareDiv);
}

function removeRemoteParticipant(socketId) {
    const participantDiv = document.getElementById(`participant-${socketId}`);
    if (participantDiv) {
        participantDiv.remove();
    }
    
    // Удаляем демонстрацию экрана если была
    const remoteScreen = document.getElementById(`screen-share-remote-${socketId}`);
    if (remoteScreen) {
        remoteScreen.remove();
    }
}

// Функция для создания возможности изменения размера элементов
function makeResizable(element) {
    if (element.hasAttribute('data-resizable')) return;
    
    element.setAttribute('data-resizable', 'true');
    
    // Добавляем стили для изменения размера
    element.style.resize = 'both';
    element.style.overflow = 'auto';
    element.style.minWidth = '200px';
    element.style.minHeight = '150px';
    element.style.maxWidth = '90vw';
    element.style.maxHeight = '90vh';
    
    // Добавляем индикатор изменения размера
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.innerHTML = '↘';
    resizeHandle.style.cssText = `
        position: absolute;
        bottom: 5px;
        right: 5px;
        width: 20px;
        height: 20px;
        background: rgba(255,255,255,0.3);
        cursor: nwse-resize;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
        font-size: 12px;
        color: white;
        user-select: none;
        z-index: 100;
    `;
    
    element.appendChild(resizeHandle);
    
    // Добавляем обработчик для изменения размера
    let isResizing = false;
    let startX, startY, startWidth, startHeight;
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = parseInt(document.defaultView.getComputedStyle(element).width, 10);
        startHeight = parseInt(document.defaultView.getComputedStyle(element).height, 10);
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const newWidth = startWidth + e.clientX - startX;
        const newHeight = startHeight + e.clientY - startY;
        
        if (newWidth > 200 && newWidth < window.innerWidth * 0.9) {
            element.style.width = newWidth + 'px';
        }
        if (newHeight > 150 && newHeight < window.innerHeight * 0.9) {
            element.style.height = newHeight + 'px';
        }
    });
    
    document.addEventListener('mouseup', () => {
        isResizing = false;
    });
}