const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');

const { initializeDatabase, userDB, messageDB, dmDB, fileDB, reactionDB, friendDB, serverDB } = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Логирование для WebRTC
const log = (msg, ...args) => console.log(`[WebRTC ${new Date().toISOString()}] ${msg}`, ...args);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Allow all common file types
        const allowedMimeTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'audio/mpeg', 'audio/mp3', 'video/mp4', 'video/webm', 'video/quicktime',
            'application/zip', 'application/x-rar-compressed'
        ];
        
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.pdf', '.doc', '.docx',
                                   '.txt', '.mp3', '.mp4', '.webm', '.mov', '.zip', '.rar'];
        
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(null, true); // Allow all files for now, can restrict later
        }
    }
});

// Initialize database
initializeDatabase();

// JWT middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// API Routes

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        const existingUser = await userDB.findByEmail(email);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await userDB.create(username, email, hashedPassword);
        
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                status: user.status
            }
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        const user = await userDB.findByEmail(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                status: user.status
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get current user
app.get('/api/user', authenticateToken, async (req, res) => {
    try {
        const user = await userDB.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            status: user.status
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update status
app.put('/api/status', authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;
        await userDB.updateStatus(req.user.id, status);
        res.json({ success: true });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Create server
app.post('/api/servers', authenticateToken, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Server name required' });
        }
        
        const server = await serverDB.create(name, req.user.id);
        await serverDB.addMember(server.id, req.user.id);
        
        res.json(server);
    } catch (error) {
        console.error('Create server error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get user servers
app.get('/api/servers', authenticateToken, async (req, res) => {
    try {
        const servers = await serverDB.getUserServers(req.user.id);
        res.json(servers);
    } catch (error) {
        console.error('Get servers error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get server members
app.get('/api/servers/:id/members', authenticateToken, async (req, res) => {
    try {
        const members = await serverDB.getMembers(req.params.id);
        res.json(members);
    } catch (error) {
        console.error('Get members error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Upload file
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const fileData = {
            filename: req.file.originalname,
            filepath: `/uploads/${req.file.filename}`,
            filetype: req.file.mimetype,
            filesize: req.file.size,
            user_id: req.user.id,
            channel_id: req.body.channelId
        };
        
        const file = await fileDB.create(fileData);
        
        res.json(file);
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Friends routes
app.post('/api/friends/request', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        await friendDB.sendRequest(req.user.id, friendId);
        res.json({ success: true });
    } catch (error) {
        console.error('Friend request error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/friends/accept', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        await friendDB.acceptRequest(req.user.id, friendId);
        res.json({ success: true });
    } catch (error) {
        console.error('Accept friend error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/friends/reject', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        await friendDB.rejectRequest(req.user.id, friendId);
        res.json({ success: true });
    } catch (error) {
        console.error('Reject friend error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/friends/remove', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        await friendDB.removeFriend(req.user.id, friendId);
        res.json({ success: true });
    } catch (error) {
        console.error('Remove friend error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/friends', authenticateToken, async (req, res) => {
    try {
        const friends = await friendDB.getFriends(req.user.id);
        res.json(friends);
    } catch (error) {
        console.error('Get friends error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/friends/requests', authenticateToken, async (req, res) => {
    try {
        const requests = await friendDB.getPendingRequests(req.user.id);
        res.json(requests);
    } catch (error) {
        console.error('Get requests error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Socket.IO logic
const users = new Map(); // socket.id -> user info
const rooms = new Map(); // channelName -> Set of socket.ids

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Authentication
    socket.on('authenticate', async (token) => {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await userDB.findById(decoded.id);
            if (!user) {
                return socket.disconnect();
            }
            
            users.set(socket.id, {
                id: user.id,
                username: user.username,
                avatar: user.avatar || user.username.charAt(0).toUpperCase(),
                status: user.status
            });
            
            socket.userId = user.id;
            
            await userDB.updateStatus(user.id, 'Online');
            
            io.emit('user-list-update', Array.from(users.values()));
        } catch (error) {
            console.error('Auth error:', error);
            socket.disconnect();
        }
    });
    
    // Get online users
    socket.on('get-online-users', () => {
        socket.emit('user-list-update', Array.from(users.values()));
    });
    
    // Send message to channel
    socket.on('channel-message', async (data) => {
        try {
            const message = await messageDB.create(data.content, data.userId, data.channelId);
            io.to(`channel-${data.channelId}`).emit('new-message', message);
        } catch (error) {
            console.error('Message error:', error);
        }
    });
    
    // Send DM
    socket.on('dm-message', async (data) => {
        try {
            const message = await dmDB.create(data.content, data.senderId, data.receiverId);
            
            // Find receiver sockets
            const receiverSockets = Array.from(users.entries())
                .filter(([_, user]) => user.id === data.receiverId)
                .map(([socketId]) => socketId);
            
            receiverSockets.forEach(target => {
                io.to(target).emit('new-dm', message);
            });
            
            socket.emit('new-dm', message); // Send back to sender
        } catch (error) {
            console.error('DM error:', error);
        }
    });
    
    // Typing indicators
    socket.on('typing', (data) => {
        socket.to(data.room).emit('typing', data);
    });
    
    // Add reaction
    socket.on('add-reaction', async (data) => {
        try {
            const reaction = await reactionDB.add(data.emoji, data.messageId, data.userId);
            io.to(`channel-${data.channelId}`).emit('new-reaction', reaction);
        } catch (error) {
            console.error('Reaction error:', error);
        }
    });
    
    // Join channel
    socket.on('join-channel', (channelId) => {
        socket.join(`channel-${channelId}`);
    });
    
    // Leave channel
    socket.on('leave-channel', (channelId) => {
        socket.leave(`channel-${channelId}`);
    });
    
    // Voice channel join
    socket.on('join-voice-channel', (channelName) => {
        socket.join(`voice-${channelName}`);
        
        if (!rooms.has(channelName)) {
            rooms.set(channelName, new Set());
        }
        rooms.get(channelName).add(socket.id);
        
        socket.to(`voice-${channelName}`).emit('user-joined-voice', socket.id);
    });
    
    // Leave voice
    socket.on('leave-voice-channel', (channelName) => {
        socket.leave(`voice-${channelName}`);
        
        if (rooms.has(channelName)) {
            rooms.get(channelName).delete(socket.id);
            socket.to(`voice-${channelName}`).emit('user-left-voice', socket.id);
        }
    });

    // Handle call initiation — УЛУЧШЕННАЯ ВЕРСИЯ
    socket.on('initiate-call', (data) => {
        const { to, type = 'voice', from } = data;

        if (!from || !from.id || !to) {
            console.error('[Звонок] Ошибка: неполные данные от клиента', data);
            return;
        }

        log(`Звонок инициирован от ${socket.id} (user: ${from.username}, id: ${from.id}) к userId: ${to}`);

        // Ищем ВСЕ сокеты пользователя-получателя (на случай нескольких вкладок или реконнектов)
        const receiverSockets = [];
        for (const [socketId, userInfo] of users.entries()) {
            if (userInfo.id === to) {
                receiverSockets.push(socketId);
            }
        }

        if (receiverSockets.length > 0) {
            log(`Найдено ${receiverSockets.length} сокетов получателя. Отправляем incoming-call`);

            receiverSockets.forEach((targetSocketId) => {
                io.to(targetSocketId).emit('incoming-call', {
                    from: {
                        id: from.id,
                        username: from.username,
                        socketId: socket.id,  // сокет звонящего (для WebRTC)
                        avatar: from.username?.charAt(0).toUpperCase() || 'U'
                    },
                    type: type
                });
            });
        } else {
            log(`Пользователь с id ${to} не найден в онлайн-списке (оффлайн или ошибка подключения)`);
            socket.emit('call-rejected', { message: 'Пользователь оффлайн' });
        }
    });

    socket.on('accept-call', (data) => {
        const { to, from } = data;
        log(`Звонок принят от ${socket.id} (userId: ${from.id}) к socket: ${to}`);

        // Notify the caller that call was accepted
        io.to(to).emit('call-accepted', {
            from: {
                id: from.id,
                username: from.username,
                socketId: socket.id
            }
        });
    });

    socket.on('reject-call', (data) => {
        const { to } = data;
        log(`Звонок отклонён от ${socket.id} к socket: ${to}`);

        // Notify the caller that call was rejected
        io.to(to).emit('call-rejected', {
            from: socket.id,
            message: 'Call was declined'
        });
    });
    
    // Video toggle handler
    socket.on('video-toggle', (data) => {
        const { to, enabled } = data;
        if (to) {
            log(`Переключение видео от ${socket.id} к ${to}: ${enabled ? 'вкл' : 'выкл'}`);
            io.to(to).emit('video-toggle', {
                from: socket.id,
                enabled: enabled
            });
        }
    });
    
    // End call
    socket.on('end-call', (data) => {
        const { to } = data;
        if (to) {
            log(`Завершение звонка от ${socket.id} к ${to}`);
            io.to(to).emit('call-ended', { from: socket.id });
        }
    });

    // Добавленные обработчики для WebRTC сигнализации
    socket.on('offer', (data) => {
        const { to, offer } = data;
        log(`Offer от ${socket.id} к ${to}`, offer.type);
        io.to(to).emit('offer', {
            from: socket.id,
            offer: offer
        });
    });

    socket.on('answer', (data) => {
        const { to, answer } = data;
        log(`Answer от ${socket.id} к ${to}`, answer.type);
        io.to(to).emit('answer', {
            from: socket.id,
            answer: answer
        });
    });

    socket.on('ice-candidate', (data) => {
        const { to, candidate } = data;
        log(`ICE-кандидат от ${socket.id} к ${to}`);
        io.to(to).emit('ice-candidate', {
            from: socket.id,
            candidate: candidate
        });
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
        const user = users.get(socket.id);
        
        if (user) {
            console.log(`${user.username} disconnected`);
            
            // Update status in database
            try {
                await userDB.updateStatus(socket.userId, 'Offline');
            } catch (error) {
                console.error('Error updating status:', error);
            }
            
            rooms.forEach((members, roomName) => {
                if (members.has(socket.id)) {
                    members.delete(socket.id);
                    io.to(`voice-${roomName}`).emit('user-left-voice', socket.id);
                }
            });
            
            users.delete(socket.id);
            io.emit('user-list-update', Array.from(users.values()));
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Discord Clone server running on http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/login.html in your browser`);
});