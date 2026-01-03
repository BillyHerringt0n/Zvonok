// ============================================================================
// GLOBAL STATE
// ============================================================================
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
let isCallMinimized = false;
let callTimer = null;
let callStartTime = null;
let chatCallActive = false;
let audioDevices = {
    input: [],
    output: []
};
let selectedAudioInput = localStorage.getItem('selectedAudioInput') || null;
let selectedAudioOutput = localStorage.getItem('selectedAudioOutput') || null;
let audioConstraints = {
    echoCancellation: localStorage.getItem('echoCancellationEnabled') !== 'false',
    autoGainControl: localStorage.getItem('autoGainControlEnabled') !== 'false',
    noiseSuppression: false // Мы сами обрабатываем
};
let settingsModalOpen = false;
let testAudioContext = null;
let testAnalyser = null;
let testMicrophoneStream = null;
let audioOutputDevice = null;

// Noise suppression
let noiseSuppressionEnabled = localStorage.getItem('noiseSuppressionEnabled') !== 'false';
let noiseSuppressor = null;
let audioContext = null;
let sourceNode = null;
let destinationNode = null;

// ============================================================================
// PROFESSIONAL NOISE SUPPRESSION SYSTEM (Discord Level)
// ============================================================================

class ProfessionalNoiseSuppressor {
    constructor() {
        this.audioContext = null;
        this.workletNode = null;
        this.source = null;
        this.destination = null;
        this.isActive = false;
        this.isInitialized = false;
        
        // Professional settings (optimized for voice)
        this.settings = {
            threshold: -50,       // dB - lower for more aggressive noise gate
            ratio: 4.0,           // Compression ratio
            attack: 0.005,        // seconds - slightly longer attack for smoothness
            release: 0.150,       // seconds - longer release to avoid chopping
            knee: 20,             // dB - softer knee for smoother transition
            makeupGain: 6,        // dB - compensate for reduction
            noiseReduction: 25,   // dB - amount of noise reduction
            highPassFreq: 100,    // Hz - remove low rumble
            lowPassFreq: 8000,    // Hz - remove high frequency hiss
            preGain: 1.2,         // Pre-amplification before processing
            postGain: 0.9,        // Post-amplification after processing
            adaptive: true,       // Adaptive noise floor
            smoothness: 0.95      // Smoothing factor (0-1)
        };
        
        // Analysis buffers
        this.noiseFloor = -60;
        this.rms = 0;
        this.voiceActivity = 0;
        this.isSpeech = false;
        this.speechHistory = [];
        this.stabilityCounter = 0;
    }
    
    async initialize() {
        if (this.isInitialized) return true;
        
        try {
            // Create high-quality audio context with latency optimization
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 48000,
                latencyHint: 'interactive',
                echoCancellation: false, // We'll handle it ourselves
                noiseSuppression: false  // Disable browser's noise suppression
            });
            
            // Resume context (required by some browsers)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            console.log('Professional noise suppressor initialized');
            this.isInitialized = true;
            return true;
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
            return false;
        }
    }
    
    async processStream(inputStream) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        if (this.isActive) {
            this.disconnect();
        }
        
        try {
            // Create audio graph
            this.source = this.audioContext.createMediaStreamSource(inputStream);
            this.destination = this.audioContext.createMediaStreamDestination();
            
            // Create processing chain
            await this.createProcessingChain();
            
            this.isActive = true;
            
            // Output stream with processed audio
            const outputStream = this.destination.stream;
            
            // Preserve video tracks if any
            inputStream.getTracks().forEach(track => {
                if (track.kind === 'video') {
                    outputStream.addTrack(track);
                }
            });
            
            console.log('Professional noise suppression active');
            return outputStream;
            
        } catch (error) {
            console.error('Error processing stream:', error);
            // Fallback to raw stream if processing fails
            return inputStream;
        }
    }
    
    async createProcessingChain() {
        // Create nodes
        const preGain = this.audioContext.createGain();
        const highPass = this.audioContext.createBiquadFilter();
        const lowPass = this.audioContext.createBiquadFilter();
        const compressor = this.audioContext.createDynamicsCompressor();
        const postGain = this.audioContext.createGain();
        const analyser = this.audioContext.createAnalyser();
        
        // Configure nodes
        preGain.gain.value = this.settings.preGain;
        
        // High-pass filter (remove rumble)
        highPass.type = 'highpass';
        highPass.frequency.value = this.settings.highPassFreq;
        highPass.Q.value = 0.5; // Gentle roll-off
        
        // Low-pass filter (remove hiss)
        lowPass.type = 'lowpass';
        lowPass.frequency.value = this.settings.lowPassFreq;
        lowPass.Q.value = 0.5; // Gentle roll-off
        
        // Compressor settings (aggressive for noise reduction)
        compressor.threshold.value = this.settings.threshold;
        compressor.knee.value = this.settings.knee;
        compressor.ratio.value = this.settings.ratio;
        compressor.attack.value = this.settings.attack;
        compressor.release.value = this.settings.release;
        
        postGain.gain.value = this.settings.postGain;
        
        // Analyser for real-time analysis
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        
        // Create script processor for advanced noise suppression
        const processor = this.audioContext.createScriptProcessor(2048, 1, 1);
        
        // Initialize analysis buffers
        const fftSize = analyser.frequencyBinCount;
        let noiseEstimate = new Float32Array(fftSize).fill(-80);
        let signalEstimate = new Float32Array(fftSize).fill(-80);
        let spectralWeights = new Float32Array(fftSize).fill(1.0);
        
        processor.onaudioprocess = (event) => {
            const inputBuffer = event.inputBuffer;
            const outputBuffer = event.outputBuffer;
            
            const input = inputBuffer.getChannelData(0);
            const output = outputBuffer.getChannelData(0);
            
            // Calculate RMS (for voice activity detection)
            let sum = 0;
            for (let i = 0; i < input.length; i++) {
                sum += input[i] * input[i];
            }
            const rms = Math.sqrt(sum / input.length);
            const dB = 20 * Math.log10(Math.max(rms, 0.0001));
            
            // Smooth RMS value
            this.rms = this.settings.smoothness * this.rms + (1 - this.settings.smoothness) * dB;
            
            // Get frequency data
            const frequencyData = new Float32Array(fftSize);
            analyser.getFloatFrequencyData(frequencyData);
            
            // Update noise floor (adaptive learning)
            if (this.rms < this.noiseFloor + 10) {
                // We're in a quiet period, update noise floor
                this.noiseFloor = 0.999 * this.noiseFloor + 0.001 * this.rms;
            }
            
            // Voice activity detection with hysteresis
            const voiceThreshold = this.noiseFloor + 12; // 12dB above noise floor
            const isCurrentSpeech = this.rms > voiceThreshold;
            
            // Update voice activity with smoothing
            if (isCurrentSpeech) {
                this.voiceActivity = Math.min(this.voiceActivity + 0.15, 1.0);
                this.stabilityCounter = Math.min(this.stabilityCounter + 1, 10);
            } else {
                this.voiceActivity = Math.max(this.voiceActivity - 0.05, 0.0);
                this.stabilityCounter = Math.max(this.stabilityCounter - 1, 0);
            }
            
            // Speech is detected if we have high voice activity AND stability
            this.isSpeech = this.voiceActivity > 0.4 && this.stabilityCounter > 3;
            
            // Update speech history
            this.speechHistory.push(this.isSpeech);
            if (this.speechHistory.length > 30) this.speechHistory.shift();
            
            // Spectral processing for noise reduction
            for (let i = 0; i < fftSize; i++) {
                const power = Math.pow(10, frequencyData[i] / 10);
                
                if (this.isSpeech) {
                    // During speech: update signal estimate
                    signalEstimate[i] = 0.98 * signalEstimate[i] + 0.02 * power;
                } else {
                    // During silence: update noise estimate
                    noiseEstimate[i] = 0.995 * noiseEstimate[i] + 0.005 * power;
                }
                
                // Calculate SNR for this frequency bin
                const snr = 10 * Math.log10((signalEstimate[i] + 0.0001) / (noiseEstimate[i] + 0.0001));
                
                // Apply spectral subtraction with smooth curve
                let gain = 1.0;
                if (snr < 0) {
                    // Below noise floor: aggressive reduction
                    gain = 0.1;
                } else if (snr < 15) {
                    // In transition zone: smooth reduction
                    gain = 0.3 + 0.7 * (snr / 15);
                } else {
                    // Above noise floor: full signal
                    gain = 1.0;
                }
                
                // Apply frequency-dependent weighting
                const freq = i * this.audioContext.sampleRate / (2 * fftSize);
                if (freq < 300 || freq > 6000) {
                    // Reduce gain for extreme frequencies
                    gain *= 0.7;
                }
                
                spectralWeights[i] = 0.9 * spectralWeights[i] + 0.1 * gain;
            }
            
            // Apply processing to time domain with overlap-add for smoothness
            const windowSize = 512;
            const overlap = 0.75;
            const hopSize = windowSize * (1 - overlap);
            
            for (let pos = 0; pos < input.length; pos += hopSize) {
                // Create window (Hanning)
                const window = new Float32Array(windowSize);
                for (let i = 0; i < windowSize && pos + i < input.length; i++) {
                    window[i] = input[pos + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (windowSize - 1)));
                }
                
                // Apply spectral weighting (simplified)
                const freqIndex = Math.min(Math.floor(pos / input.length * fftSize), fftSize - 1);
                const windowGain = spectralWeights[freqIndex];
                
                // Apply noise gate with soft knee
                let processedWindow = new Float32Array(windowSize);
                for (let i = 0; i < windowSize && pos + i < input.length; i++) {
                    let sample = window[i];
                    
                    // Apply adaptive noise gate
                    if (!this.isSpeech && Math.abs(sample) < Math.pow(10, this.noiseFloor / 20) * 1.5) {
                        sample *= 0.05; // Very aggressive reduction during silence
                    }
                    
                    // Apply spectral gain
                    sample *= windowGain;
                    
                    // Soft clipping to prevent distortion
                    if (Math.abs(sample) > 0.9) {
                        sample = Math.sign(sample) * (0.9 + 0.1 * Math.tanh((Math.abs(sample) - 0.9) * 5));
                    }
                    
                    processedWindow[i] = sample;
                    
                    // Overlap-add to output
                    if (pos + i < output.length) {
                        output[pos + i] = (output[pos + i] || 0) + processedWindow[i];
                    }
                }
            }
            
            // Normalize output to prevent clipping
            let maxAmplitude = 0;
            for (let i = 0; i < output.length; i++) {
                maxAmplitude = Math.max(maxAmplitude, Math.abs(output[i]));
            }
            
            if (maxAmplitude > 0.95) {
                const scale = 0.95 / maxAmplitude;
                for (let i = 0; i < output.length; i++) {
                    output[i] *= scale;
                }
            }
        };
        
        // Connect audio graph
        this.source.connect(preGain);
        preGain.connect(highPass);
        highPass.connect(lowPass);
        lowPass.connect(compressor);
        compressor.connect(postGain);
        postGain.connect(analyser);
        analyser.connect(processor);
        processor.connect(this.destination);
        
        // Store references for cleanup
        this.processingNodes = {
            preGain, highPass, lowPass, compressor,
            postGain, analyser, processor
        };
    }
    
    disconnect() {
        if (!this.isActive) return;
        
        try {
            // Disconnect all nodes
            if (this.processingNodes) {
                Object.values(this.processingNodes).forEach(node => {
                    if (node && node.disconnect) {
                        try {
                            node.disconnect();
                        } catch (e) {
                            // Ignore disconnection errors
                        }
                    }
                });
            }
            
            if (this.source) {
                try {
                    this.source.disconnect();
                } catch (e) {}
            }
            
            if (this.destination) {
                try {
                    this.destination.disconnect();
                } catch (e) {}
            }
            
            this.isActive = false;
            console.log('Noise suppressor disconnected');
        } catch (error) {
            console.warn('Error disconnecting noise suppressor:', error);
        }
    }
    
    updateSettings(newSettings) {
        Object.assign(this.settings, newSettings);
        
        if (this.isActive && this.processingNodes) {
            // Update nodes with new settings
            try {
                this.processingNodes.preGain.gain.value = this.settings.preGain;
                this.processingNodes.postGain.gain.value = this.settings.postGain;
                
                this.processingNodes.highPass.frequency.value = this.settings.highPassFreq;
                this.processingNodes.lowPass.frequency.value = this.settings.lowPassFreq;
                
                this.processingNodes.compressor.threshold.value = this.settings.threshold;
                this.processingNodes.compressor.ratio.value = this.settings.ratio;
                this.processingNodes.compressor.attack.value = this.settings.attack;
                this.processingNodes.compressor.release.value = this.settings.release;
                this.processingNodes.compressor.knee.value = this.settings.knee;
            } catch (error) {
                console.warn('Error updating noise suppressor settings:', error);
            }
        }
    }
    
    getMetrics() {
        return {
            noiseFloor: this.noiseFloor,
            rms: this.rms,
            voiceActivity: this.voiceActivity,
            isSpeech: this.isSpeech,
            stability: this.stabilityCounter
        };
    }
    
    destroy() {
        this.disconnect();
        
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(() => {});
        }
        
        this.isInitialized = false;
        this.audioContext = null;
    }
}

// ============================================================================
// AUDIO PROCESSING FUNCTIONS
// ============================================================================

async function applyNoiseSuppression(stream) {
    if (!noiseSuppressionEnabled || !stream) {
        return stream;
    }
    
    try {
        // Create or reuse noise suppressor
        if (!noiseSuppressor) {
            noiseSuppressor = new ProfessionalNoiseSuppressor();
            await noiseSuppressor.initialize();
        }
        
        console.log('Applying professional noise suppression...');
        const processedStream = await noiseSuppressor.processStream(stream);
        console.log('Noise suppression applied successfully');
        
        // Log metrics for debugging
        setInterval(() => {
            if (noiseSuppressor && noiseSuppressor.isActive) {
                const metrics = noiseSuppressor.getMetrics();
                console.log('Noise suppressor metrics:', {
                    noiseFloor: metrics.noiseFloor.toFixed(1),
                    rms: metrics.rms.toFixed(1),
                    voiceActivity: metrics.voiceActivity.toFixed(2),
                    isSpeech: metrics.isSpeech,
                    stability: metrics.stability
                });
            }
        }, 5000);
        
        return processedStream;
    } catch (error) {
        console.warn('Professional noise suppression failed, using raw audio:', error);
        return stream;
    }
}

function cleanupAudioProcessing() {
    try {
        if (noiseSuppressor) {
            noiseSuppressor.destroy();
            noiseSuppressor = null;
        }
        
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close().catch(() => {});
            audioContext = null;
        }
        
        sourceNode = null;
        destinationNode = null;
        
        console.log('Audio processing cleaned up');
    } catch (error) {
        console.warn('Error cleaning up audio processing:', error);
    }
}

async function restartAudioWithNoiseSuppression(enabled) {
    if (!localAudioStream || !inCall) return;
    
    const oldStream = localAudioStream;
    const wasMuted = isMuted;
    
    try {
        // Stop old tracks gently
        oldStream.getTracks().forEach(track => {
            try {
                track.stop();
            } catch (e) {
                // Ignore stop errors
            }
        });
        
        // Get new stream with appropriate settings
        await ensureLocalAudio(enabled);
        
        // Update all peer connections with new audio track
        const newAudioTrack = localAudioStream.getAudioTracks()[0];
        if (newAudioTrack) {
            Object.values(peerConnections).forEach(pc => {
                try {
                    const senders = pc.getSenders();
                    senders.forEach(sender => {
                        if (sender.track && sender.track.kind === 'audio') {
                            sender.replaceTrack(newAudioTrack);
                        }
                    });
                } catch (error) {
                    console.warn('Error updating peer connection:', error);
                }
            });
        }
        
        // Restore mute state
        if (wasMuted && localAudioStream) {
            localAudioStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
        }
        
        console.log(`Noise suppression ${enabled ? 'enabled' : 'disabled'} successfully`);
        showNotification(
            'Шумоподавление',
            noiseSuppressionEnabled ? 'Включено (профессиональный режим)' : 'Выключено'
        );
        
    } catch (error) {
        console.error('Error restarting audio:', error);
        // Try to restore old stream if possible
        if (oldStream.active) {
            localAudioStream = oldStream;
        }
    }
}

// ============================================================================
// SOUND EFFECTS
// ============================================================================

function playRingSound() {
    const sound = document.getElementById('ringSound');
    if (sound) {
        sound.currentTime = 0;
        sound.volume = 0.5;
        sound.play().catch(e => console.log('Cannot play ring sound:', e));
    }
}

function stopRingSound() {
    const sound = document.getElementById('ringSound');
    if (sound) {
        sound.pause();
        sound.currentTime = 0;
    }
}

function playConnectSound() {
    const sound = document.getElementById('connectSound');
    if (sound) {
        sound.currentTime = 0;
        sound.volume = 0.3;
        sound.play().catch(e => console.log('Cannot play connect sound:', e));
    }
}

function playDisconnectSound() {
    const sound = document.getElementById('disconnectSound');
    if (sound) {
        sound.currentTime = 0;
        sound.volume = 0.3;
        sound.play().catch(e => console.log('Cannot play disconnect sound:', e));
    }
}

// ============================================================================
// CALL MANAGEMENT
// ============================================================================

function showChatCall(friendUsername, status = "Calling...") {
    const chatCallInterface = document.getElementById('chatCallInterface');
    chatCallInterface.classList.remove('hidden');
    
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
    
    if (status === "Connected") {
        startCallTimer();
    }
    
    addCallStartedMessage(friendUsername);
    chatCallActive = true;
}

function hideChatCall() {
    const chatCallInterface = document.getElementById('chatCallInterface');
    chatCallInterface.classList.add('hidden');
    
    if (screenStream) {
        stopScreenShare();
    }
    
    stopCallTimer();
    chatCallActive = false;
}

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
    
    const chatTimerElement = document.getElementById('chatCallTimer');
    if (chatTimerElement) {
        chatTimerElement.textContent = `${minutes}:${seconds}`;
    }
}

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
    
    if (callStartTime) {
        const duration = Math.floor((Date.now() - callStartTime) / 1000);
        const minutes = Math.floor(duration / 60).toString().padStart(2, '0');
        const seconds = (duration % 60).toString().padStart(2, '0');
        document.getElementById('callDuration').textContent = `${minutes}:${seconds}`;
    }
    
    scrollToBottom();
}

// ============================================================================
// INITIALIZATION
// ============================================================================

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

function initializeApp() {
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
    
    // Инициализация настроек ДО загрузки настроек
    initializeSettingsModal();
    
    // Загрузка настроек и применение их
    loadSettings();
    applyOutputVolume();
    
    // Загрузка списка устройств
    setTimeout(() => {
        loadAudioDevices();
    }, 1000);
    
    // Инициализация шумоподавления
    if (noiseSuppressionEnabled) {
        noiseSuppressor = new ProfessionalNoiseSuppressor();
    }
    
    console.log('Discord Clone инициализирован!');
    if (currentUser) {
        console.log('Вход выполнен как:', currentUser.username);
    }
}

// Создание тестового аудио элемента
function createTestSoundElement() {
    // Теперь генерируем звук на лету, так что ничего не создаем
    console.log('Тестовый звук будет генерироваться динамически');
}

// ============================================================================
// AUDIO MANAGEMENT
// ============================================================================

async function ensureLocalAudio(useNoiseSuppression = true) {
    // Если у нас есть валидный поток, переиспользуем его
    if (localAudioStream) {
        const activeTracks = localAudioStream.getTracks().filter(track => 
            track.readyState === 'live' && track.enabled !== false
        );
        if (activeTracks.length > 0) {
            return localAudioStream;
        }
    }

    try {
        // Загрузка сохраненных настроек
        const savedInput = selectedAudioInput || localStorage.getItem('selectedAudioInput');
        const savedEchoCancellation = localStorage.getItem('echoCancellationEnabled') !== 'false';
        const savedAutoGainControl = localStorage.getItem('autoGainControlEnabled') !== 'false';
        
        // Параметры с учетом настроек
        const constraints = {
            audio: {
                deviceId: savedInput ? { exact: savedInput } : undefined,
                echoCancellation: { ideal: savedEchoCancellation },
                noiseSuppression: { ideal: false }, // Мы сами обрабатываем шумоподавление
                autoGainControl: { ideal: savedAutoGainControl },
                sampleRate: 48000,
                channelCount: 1,
                sampleSize: 16,
                latency: 0.01
            },
            video: false
        };

        console.log('Запрашиваю микрофон с настройками:', constraints.audio);

        let stream;
        
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('Доступ к микрофону получен. Устройство:', 
                stream.getAudioTracks()[0]?.label || 'Неизвестно');
        } catch (highQualityError) {
            console.warn('Высококачественное аудио недоступно, используем базовое:', highQualityError);
            // Fallback к базовому аудио
            const fallbackConstraints = {
                audio: {
                    deviceId: savedInput ? { exact: savedInput } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                },
                video: false
            };
            stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
            console.log('Базовый доступ к микрофону получен');
        }

        // Применение шумоподавления если включено
        if (useNoiseSuppression && noiseSuppressionEnabled) {
            try {
                localAudioStream = await applyNoiseSuppression(stream);
            } catch (suppressionError) {
                console.warn('Шумоподавление не сработало, используем исходный поток:', suppressionError);
                localAudioStream = stream;
            }
        } else {
            localAudioStream = stream;
        }

        // Установка начального состояния mute
        if (isMuted && localAudioStream) {
            localAudioStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
        }

        // Применение громкости микрофона из настроек
        const inputVolume = localStorage.getItem('inputVolume') || 100;
        applyInputVolume(parseInt(inputVolume) / 100);

        return localAudioStream;
    } catch (err) {
        console.error("Ошибка получения микрофона:", err);
        
        // Показать понятное сообщение об ошибке
        if (err.name === 'NotAllowedError') {
            alert("Микрофон заблокирован. Пожалуйста, разрешите доступ к микрофону в настройках браузера.");
        } else if (err.name === 'NotFoundError') {
            alert("Микрофон не найден. Убедитесь, что микрофон подключен и включен.");
        } else if (err.name === 'OverconstrainedError') {
            alert("Запрошенные параметры микрофона недоступны. Попробуйте выбрать другое устройство.");
        } else {
            alert("Не удалось получить доступ к микрофону. Ошибка: " + err.message);
        }
        
        throw err;
    }
}

function applyInputVolume(volume) {
    if (!localAudioStream) return;
    
    const tracks = localAudioStream.getAudioTracks();
    if (tracks.length > 0) {
        console.log('Установка громкости микрофона:', volume);
    }
}

// ============================================================================
// UI CONTROLS
// ============================================================================

function updateNoiseSuppressionButton() {
    const btn = document.getElementById('noiseSuppressionBtn');
    if (!btn) return;
    
    const normalIcon = btn.querySelector('.icon-normal');
    const slashedIcon = btn.querySelector('.icon-slashed');
    
    if (normalIcon && slashedIcon) {
        normalIcon.style.display = noiseSuppressionEnabled ? 'block' : 'none';
        slashedIcon.style.display = noiseSuppressionEnabled ? 'none' : 'block';
    }
    
    btn.title = noiseSuppressionEnabled ? 
        'Шумоподавление: ВКЛЮЧЕНО (Профессиональный режим)' : 
        'Шумоподавление: ВЫКЛЮЧЕНО';
    
    // Update button state
    btn.classList.toggle('active', noiseSuppressionEnabled);
}

function initializeUserControls() {
    const muteBtn = document.getElementById('muteBtn');
    const deafenBtn = document.getElementById('deafenBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const noiseSuppressionBtn = document.getElementById('noiseSuppressionBtn');
    
    // Mute button
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        const normalIcon = muteBtn.querySelector('.icon-normal');
        const slashedIcon = muteBtn.querySelector('.icon-slashed');
        
        if (normalIcon && slashedIcon) {
            normalIcon.style.display = isMuted ? 'none' : 'block';
            slashedIcon.style.display = isMuted ? 'block' : 'none';
        }
        
        muteBtn.classList.toggle('active', isMuted);
        
        if (localAudioStream) {
            localAudioStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
        }
        
        // Update call buttons
        updateCallButtons();
    });
    
    // Deafen button
    deafenBtn.addEventListener('click', () => {
        isDeafened = !isDeafened;
        const normalIcon = deafenBtn.querySelector('.icon-normal');
        const slashedIcon = deafenBtn.querySelector('.icon-slashed');
        
        if (normalIcon && slashedIcon) {
            normalIcon.style.display = isDeafened ? 'none' : 'block';
            slashedIcon.style.display = isDeafened ? 'block' : 'none';
        }
        
        deafenBtn.classList.toggle('active', isDeafened);
        
        if (isDeafened) {
            // Mute microphone when deafened
            if (!isMuted) {
                isMuted = true;
                muteBtn.querySelector('.icon-normal').style.display = 'none';
                muteBtn.querySelector('.icon-slashed').style.display = 'block';
                muteBtn.classList.add('active');
                
                if (localAudioStream) {
                    localAudioStream.getAudioTracks().forEach(track => {
                        track.enabled = false;
                    });
                }
            }
            
            // Mute all remote audio
            document.querySelectorAll('.audio-element').forEach(audio => {
                audio.volume = 0;
                audio.muted = true;
            });
        } else {
            // Unmute remote audio
            document.querySelectorAll('.audio-element').forEach(audio => {
                audio.volume = 1;
                audio.muted = false;
            });
            
            // Restore microphone state
            if (localAudioStream) {
                localAudioStream.getAudioTracks().forEach(track => {
                    track.enabled = !isMuted;
                });
            }
        }
        
        updateCallButtons();
    });
    
    // Noise suppression button (теперь скрыта - управление в настройках)
    if (noiseSuppressionBtn) {
        noiseSuppressionBtn.style.display = 'none'; // Скрываем кнопку, так как управление в настройках
    }
    
    // Settings button - открывает модальное окно настроек
    settingsBtn.addEventListener('click', () => {
        if (typeof openSettingsModal === 'function') {
            openSettingsModal();
        } else {
            console.error('Модальное окно настроек не инициализировано');
        }
    });
}

function initializeCallFriendButton() {
    const callFriendBtn = document.getElementById('callFriendBtn');
    if (callFriendBtn) {
        callFriendBtn.addEventListener('click', () => {
            if (currentDMUserId && currentDMUsername) {
                initiateCall(currentDMUserId);
            } else {
                alert('Выберите друга для звонка');
            }
        });
    }
}

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

function toggleChatAudio() {
    if (!localAudioStream) return;
    
    isAudioEnabled = !isAudioEnabled;
    localAudioStream.getAudioTracks().forEach(track => {
        track.enabled = isAudioEnabled;
    });
    
    isMuted = !isAudioEnabled;
    updateCallButtons();
    
    const chatToggleAudioBtn = document.getElementById('chatToggleAudioBtn');
    if (chatToggleAudioBtn) {
        chatToggleAudioBtn.classList.toggle('active', !isAudioEnabled);
    }
    
    document.getElementById('toggleAudioBtn')?.classList.toggle('active', !isAudioEnabled);
}

function endChatCall() {
    stopRingSound();
    playDisconnectSound();
    
    if (screenStream) {
        stopScreenShare();
    }
    
    if (socket && socket.connected) {
        Object.keys(peerConnections).forEach(socketId => {
            socket.emit('end-call', { to: socketId });
        });
    }
    
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
        localAudioStream = null;
    }
    
    cleanupAudioProcessing();
    
    if (currentDMUsername) {
        addCallEndedMessage(currentDMUsername);
    }
    
    hideChatCall();
    
    const callInterface = document.getElementById('callInterface');
    if (callInterface) {
        callInterface.classList.add('hidden');
    }
    
    inCall = false;
    chatCallActive = false;
    isAudioEnabled = true;
    isMuted = false;
    updateCallButtons();
}

// ============================================================================
// SOCKET.IO CONNECTION
// ============================================================================

function connectToSocketIO() {
    if (typeof io !== 'undefined') {
        socket = io({
            auth: { token: token },
            transports: ['websocket', 'polling']
        });
        
        socket.on('connect', () => {
            console.log('Connected to server with ID:', socket.id);
        });
        
        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            if (error.message === 'Authentication error') {
                localStorage.removeItem('token');
                localStorage.removeItem('currentUser');
                window.location.replace('login.html');
            }
        });
        
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

        // WebRTC Signaling
        socket.on('user-joined-voice', (data) => {
            console.log('User joined voice:', data);
            createPeerConnection(data.socketId, true);
        });

        socket.on('existing-voice-users', (users) => {
            users.forEach(user => {
                createPeerConnection(user.socketId, false);
            });
        });

        socket.on('user-left-voice', (socketId) => {
            if (peerConnections[socketId]) {
                peerConnections[socketId].close();
                delete peerConnections[socketId];
            }
            removeRemoteParticipant(socketId);
        });

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
            console.log('Received ICE candidate from:', data.from);
            const pc = peerConnections[data.from];
            if (pc && data.candidate) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (error) {
                    console.error('Error adding ICE candidate:', error);
                }
            }
        });
        
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
                    avatar: currentUser.avatar,
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

        socket.on('incoming-call', (data) => {
            const { from, type } = data;
            if (from) {
                showIncomingCall(from, type);
            }
        });

        socket.on('call-accepted', (data) => {
            console.log('Call accepted by:', data.from);
            
            stopRingSound();
            playConnectSound();
            
            document.getElementById('remoteCallStatus').textContent = 'Connected';
            document.getElementById('callStatusText').innerHTML = `<span>Connected</span>`;
            
            startCallTimer();
            
            if (!peerConnections[data.from.socketId]) {
                createPeerConnection(data.from.socketId, true);
            }
        });

        socket.on('call-rejected', (data) => {
            stopRingSound();
            playDisconnectSound();
            
            alert('Call was declined');
            const callInterface = document.getElementById('callInterface');
            callInterface.classList.add('hidden');
            if (localAudioStream) {
                localAudioStream.getTracks().forEach(track => track.stop());
                localAudioStream = null;
            }
            inCall = false;
        });
        
        socket.on('call-ended', (data) => {
            playDisconnectSound();
            
            console.log('Call ended by:', data.from);
            if (peerConnections[data.from]) {
                peerConnections[data.from].close();
                delete peerConnections[data.from];
            }
            removeRemoteParticipant(data.from);
            
            if (Object.keys(peerConnections).length === 0) {
                leaveVoiceChannel(true);
            }
        });
    }
}

// ============================================================================
// FRIENDS SYSTEM
// ============================================================================

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
            <button class="friend-action-btn remove" title="Remove">🗑️</button>
        </div>
    `;

    div.querySelector('.message').addEventListener('click', () => startDM(friend.id, friend.username));
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

// ============================================================================
// CALL INITIATION
// ============================================================================

async function initiateCall(friendId) {
    try {
        // Get microphone with noise suppression
        await ensureLocalAudio(noiseSuppressionEnabled);

        // Show chat call interface
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

        playRingSound();

        inCall = true;
        chatCallActive = true;
        isAudioEnabled = true;
        isMuted = false;
        updateCallButtons();

        console.log(`Initiating call to ${friendId}`);

    } catch (error) {
        console.error('Error initiating call:', error);
        alert('Не удалось получить доступ к микрофону.');
        stopRingSound();
        hideChatCall();
    }
}

function showIncomingCall(caller, type) {
    const incomingCallDiv = document.getElementById('incomingCall');
    const callerName = incomingCallDiv.querySelector('.caller-name');
    const callerAvatar = incomingCallDiv.querySelector('.caller-avatar');
    
    callerName.textContent = caller.username || 'Unknown User';
    callerAvatar.textContent = caller.avatar || caller.username?.charAt(0).toUpperCase() || 'U';
    
    incomingCallDiv.classList.remove('hidden');
    
    playRingSound();
    
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    
    acceptBtn.onclick = async () => {
        incomingCallDiv.classList.add('hidden');
        await acceptCall(caller);
    };
    
    rejectBtn.onclick = () => {
        incomingCallDiv.classList.add('hidden');
        rejectCall(caller);
    };
    
    setTimeout(() => {
        if (!incomingCallDiv.classList.contains('hidden')) {
            incomingCallDiv.classList.add('hidden');
            rejectCall(caller);
        }
    }, 300000);
}

async function acceptCall(caller) {
    try {
        await ensureLocalAudio(noiseSuppressionEnabled);

        stopRingSound();
        playConnectSound();

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
        isMuted = false;
        updateCallButtons();

        if (!peerConnections[caller.socketId]) {
            await createPeerConnection(caller.socketId, false);
        }

    } catch (error) {
        console.error('Error accepting call:', error);
        alert('Не удалось принять звонок.');
        stopRingSound();
        hideChatCall();
    }
}

function rejectCall(caller) {
    stopRingSound();
    playDisconnectSound();
    
    if (socket && socket.connected) {
        socket.emit('reject-call', { to: caller.socketId });
    }
}

// ============================================================================
// DM AND VIEW MANAGEMENT
// ============================================================================

window.startDM = async function(friendId, friendUsername) {
    currentView = 'dm';
    currentDMUserId = friendId;
    currentDMUsername = friendUsername;
    currentServerId = null;

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';

    document.getElementById('callFriendBtn').style.display = 'flex';
    
    const chatHeaderInfo = document.getElementById('chatHeaderInfo');
    chatHeaderInfo.innerHTML = `
        <div class="friend-avatar">${friendUsername.charAt(0).toUpperCase()}</div>
        <span class="channel-name">${friendUsername}</span>
    `;
    
    document.getElementById('messageInput').placeholder = `Message @${friendUsername}`;
    
    await loadDMHistory(friendId);
};

function showFriendsView() {
    currentView = 'friends';
    currentDMUserId = null;
    currentDMUsername = null;

    document.getElementById('friendsView').style.display = 'flex';
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('channelsView').style.display = 'none';
    document.getElementById('dmListView').style.display = 'block';
    
    document.getElementById('serverName').textContent = 'Friends';
    
    document.getElementById('callFriendBtn').style.display = 'none';
    
    document.querySelectorAll('.server-icon').forEach(icon => icon.classList.remove('active'));
    document.getElementById('friendsBtn').classList.add('active');
    
    document.getElementById('chatView').style.display = 'none';
    document.getElementById('friendsView').style.display = 'flex';
}

function showServerView(server) {
    currentView = 'server';
    currentServerId = server.id;
    currentDMUserId = null;
    currentDMUsername = null;

    document.getElementById('friendsView').style.display = 'none';
    document.getElementById('chatView').style.display = 'flex';
    document.getElementById('channelsView').style.display = 'block';
    document.getElementById('dmListView').style.display = 'none';

    document.getElementById('callFriendBtn').style.display = 'none';
    
    document.getElementById('serverName').textContent = server.name;
    switchChannel('general');
}

// ============================================================================
// SERVER MANAGEMENT
// ============================================================================

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

// ============================================================================
// CHANNEL MANAGEMENT
// ============================================================================

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

// ============================================================================
// MESSAGING
// ============================================================================

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
    reactionsContainer.style.display = 'none';
    
    const messageActions = document.createElement('div');
    messageActions.className = 'message-actions';
    messageActions.style.opacity = '0';
    messageActions.style.transition = 'opacity 0.2s';
    
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
    
    messageGroup.addEventListener('mouseenter', () => {
        messageActions.style.opacity = '1';
    });
    
    messageGroup.addEventListener('mouseleave', () => {
        messageActions.style.opacity = '0';
    });
    
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

// ============================================================================
// EMOJI AND REACTIONS
// ============================================================================

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

// ============================================================================
// FILE UPLOAD
// ============================================================================

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

// ============================================================================
// VOICE CHANNEL
// ============================================================================

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
        await ensureLocalAudio(noiseSuppressionEnabled);
        
        const remoteParticipants = document.getElementById('remoteParticipants');
        remoteParticipants.innerHTML = '';
        
        const localParticipant = document.createElement('div');
        localParticipant.className = 'participant';
        localParticipant.id = 'participant-local';
        localParticipant.innerHTML = `
            <div class="participant-avatar">${currentUser.avatar || 'U'}</div>
            <div class="participant-info">
                <div class="participant-name">${currentUser.username} (You)</div>
                <div class="participant-status">Connected</div>
            </div>
        `;
        remoteParticipants.appendChild(localParticipant);
        
        if (socket && socket.connected) {
            socket.emit('join-voice-channel', { 
                channelName, 
                userId: currentUser.id 
            });
        }

        updateCallButtons();

        console.log(`Joined voice channel: ${channelName}`);

    } catch (error) {
        console.error('Error initializing media for voice channel:', error);
        alert('Error accessing microphone. Please grant permissions.');
        leaveVoiceChannel(true);
    }
}

function leaveVoiceChannel(force = false) {
    if (!inCall && !force) return;

    if (force) {
        inCall = false;

        if (localAudioStream) {
            localAudioStream.getTracks().forEach(track => track.stop());
            localAudioStream = null;
        }

        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
            isScreenSharing = false;
        }

        cleanupAudioProcessing();

        if (socket && socket.connected) {
            socket.emit('leave-voice-channel', currentChannel);
        }

        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};

        const remoteParticipants = document.getElementById('remoteParticipants');
        if (remoteParticipants) {
            remoteParticipants.innerHTML = '';
        }

        document.querySelectorAll('.voice-channel').forEach(ch => {
            ch.classList.remove('in-call');
        });

        removeScreenShareElement();
        stopCallTimer();
        chatCallActive = false;

        if (window.currentCallDetails) {
            window.currentCallDetails = null;
        }

        stopRingSound();
    }

    const callInterface = document.getElementById('callInterface');
    if (callInterface) {
        callInterface.classList.add('hidden');
    }

    const chatCallInterface = document.getElementById('chatCallInterface');
    if (chatCallInterface) {
        chatCallInterface.classList.add('hidden');
    }

    if (force) {
        isAudioEnabled = true;
        isMuted = false;
        isDeafened = false;
        
        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            muteBtn.querySelector('.icon-normal').style.display = 'block';
            muteBtn.querySelector('.icon-slashed').style.display = 'none';
            muteBtn.classList.remove('active');
        }
        
        const deafenBtn = document.getElementById('deafenBtn');
        if (deafenBtn) {
            deafenBtn.querySelector('.icon-normal').style.display = 'block';
            deafenBtn.querySelector('.icon-slashed').style.display = 'none';
            deafenBtn.classList.remove('active');
        }
        
        updateCallButtons();
        currentChannel = 'general';
        currentDMUserId = null;
        currentDMUsername = null;
        
        console.log('Voice channel fully cleaned up');
    }
}

function initializeCallControls() {
    const closeCallBtn = document.getElementById('closeCallBtn');
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    
    closeCallBtn.addEventListener('click', () => {
        playDisconnectSound();
        stopRingSound();
        
        if (window.currentCallDetails) {
            Object.keys(peerConnections).forEach(socketId => {
                if (socket && socket.connected) {
                    socket.emit('end-call', { to: socketId });
                }
            });
        }
        leaveVoiceChannel(true);
    });
    
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
        if (screenStream) return;

        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: "always",
                    displaySurface: "monitor"
                },
                audio: true
            });

            const floatingVideo = document.getElementById('floatingScreenVideo');
            floatingVideo.srcObject = screenStream;
            document.getElementById('floatingScreenShare').classList.remove('hidden');

            screenStream.getTracks().forEach(track => {
                Object.values(peerConnections).forEach(pc => {
                    pc.addTrack(track, screenStream);
                });
            });

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

        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;

        document.getElementById('floatingScreenShare').classList.add('hidden');

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

function updateScreenShareButton(active) {
    const btn = document.getElementById('toggleScreenBtn');
    if (btn) {
        btn.classList.toggle('active', active);
    }
    
    const chatBtn = document.getElementById('chatToggleScreenBtn');
    if (chatBtn) {
        chatBtn.classList.toggle('active', active);
    }
}

function removeScreenShareElement() {
    const screenShareDiv = document.getElementById('screen-share-local');
    if (screenShareDiv) {
        screenShareDiv.remove();
    }
}

function updateCallButtons() {
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    const toggleScreenBtn = document.getElementById('toggleScreenBtn');
    const chatToggleAudioBtn = document.getElementById('chatToggleAudioBtn');
    const chatToggleScreenBtn = document.getElementById('chatToggleScreenBtn');
    
    if (toggleAudioBtn) {
        toggleAudioBtn.classList.toggle('active', !isAudioEnabled);
    }
    
    if (toggleScreenBtn) {
        toggleScreenBtn.classList.toggle('active', isScreenSharing);
    }
    
    if (chatToggleAudioBtn) {
        chatToggleAudioBtn.classList.toggle('active', !isAudioEnabled);
    }
    
    if (chatToggleScreenBtn) {
        chatToggleScreenBtn.classList.toggle('active', isScreenSharing);
    }
}

// ============================================================================
// WEBRTC PEER CONNECTIONS
// ============================================================================

async function createPeerConnection(remoteSocketId, isInitiator) {
    console.log(`Creating peer connection with ${remoteSocketId}, initiator: ${isInitiator}`);
    
    if (peerConnections[remoteSocketId]) {
        console.log('Peer connection already exists');
        return peerConnections[remoteSocketId];
    }
    
    if (!localAudioStream) {
        try {
            await ensureLocalAudio(noiseSuppressionEnabled);
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
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    });

    peerConnections[remoteSocketId] = pc;

    if (localAudioStream) {
        const audioTracks = localAudioStream.getAudioTracks();
        audioTracks.forEach(track => {
            pc.addTrack(track, localAudioStream);
        });
    }
    
    if (screenStream) {
        const videoTracks = screenStream.getVideoTracks();
        videoTracks.forEach(track => {
            pc.addTrack(track, screenStream);
        });
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                to: remoteSocketId,
                candidate: event.candidate
            });
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state for ${remoteSocketId}: ${pc.iceConnectionState}`);
        
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            console.log(`ICE connection failed for ${remoteSocketId}, attempting restart...`);
            // Could implement ICE restart here if needed
        }
    };
    
    pc.onconnectionstatechange = () => {
        console.log(`Connection state for ${remoteSocketId}: ${pc.connectionState}`);
    };

    pc.ontrack = (event) => {
        console.log('Received remote track from', remoteSocketId);
        
        const remoteParticipants = document.getElementById('remoteParticipants');
        
        let participantDiv = document.getElementById(`participant-${remoteSocketId}`);
        
        if (!participantDiv) {
            participantDiv = document.createElement('div');
            participantDiv.className = 'participant';
            participantDiv.id = `participant-${remoteSocketId}`;
            
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
        
        if (event.track.kind === 'video') {
            createRemoteScreenShareElement(remoteSocketId, event.streams[0]);
        } else if (event.track.kind === 'audio') {
            const audioElement = document.getElementById(`remote-audio-${remoteSocketId}`);
            if (audioElement) {
                audioElement.srcObject = event.streams[0];
                
                // Auto-play with user gesture fallback
                const playPromise = audioElement.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.error('Error playing remote audio:', error);
                        // Add click listener to retry play
                        document.addEventListener('click', () => {
                            audioElement.play().catch(err => console.error('Still cannot play:', err));
                        }, { once: true });
                    });
                }
            }
        }
    };

    if (isInitiator) {
        try {
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await pc.setLocalDescription(offer);
            socket.emit('offer', {
                to: remoteSocketId,
                offer: pc.localDescription
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }
    
    return pc;
}

function createRemoteScreenShareElement(socketId, stream) {
    const remoteParticipants = document.getElementById('remoteParticipants');
    
    const oldElement = document.getElementById(`screen-share-remote-${socketId}`);
    if (oldElement) {
        oldElement.remove();
    }
    
    const screenShareDiv = document.createElement('div');
    screenShareDiv.className = 'participant screen-share remote';
    screenShareDiv.id = `screen-share-remote-${socketId}`;
    
    const videoElement = document.createElement('video');
    videoElement.className = 'screen-video';
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    
    const screenShareLabel = document.createElement('div');
    screenShareLabel.className = 'participant-name';
    screenShareLabel.textContent = `Friend's Screen`;
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'screen-controls';
    
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
    
    videoElement.srcObject = stream;
    
    const playPromise = videoElement.play();
    if (playPromise !== undefined) {
        playPromise.catch(e => {
            console.error('Error playing remote screen share video:', e);
        });
    }
    
    makeResizable(screenShareDiv);
}

function removeRemoteParticipant(socketId) {
    const participantDiv = document.getElementById(`participant-${socketId}`);
    if (participantDiv) {
        participantDiv.remove();
    }
    
    const remoteScreen = document.getElementById(`screen-share-remote-${socketId}`);
    if (remoteScreen) {
        remoteScreen.remove();
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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
   
   makeResizable(callInterface);
}

// ============================================================================
// SETTINGS MANAGEMENT
// ============================================================================

function initializeSettingsModal() {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeBtn = document.getElementById('settingsCloseBtn');
    const cancelBtn = document.getElementById('settingsCancelBtn');
    const saveBtn = document.getElementById('settingsSaveBtn');
    const resetBtn = document.getElementById('settingsResetBtn');
    
    // Открытие модального окна при клике на кнопку настроек
    settingsBtn.addEventListener('click', () => {
        openSettingsModal();
    });
    
    // Закрытие модального окна
    closeBtn.addEventListener('click', closeSettingsModal);
    cancelBtn.addEventListener('click', closeSettingsModal);
    
    // Сохранение настроек
    saveBtn.addEventListener('click', saveSettings);
    
    // Сброс настроек
    resetBtn.addEventListener('click', resetSettings);
    
    // Закрытие по клику вне модального окна
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeSettingsModal();
        }
    });
    
    // Инициализация элементов управления
    initializeSettingsControls();
    
    // Загрузка сохраненных настроек
    loadSettings();
}

function openSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    settingsModal.classList.remove('hidden');
    settingsModalOpen = true;
    
    // Загрузка доступных устройств
    loadAudioDevices();
    
    // Обновление значений в UI
    updateSettingsUI();
}

function closeSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    settingsModal.classList.add('hidden');
    settingsModalOpen = false;
    
    // Остановка теста микрофона при закрытии
    stopMicrophoneTest();
    
    // Восстановление исходных настроек из localStorage
    loadSettings();
}

function initializeSettingsControls() {
    // Слайдеры громкости
    const inputVolume = document.getElementById('inputVolume');
    const outputVolume = document.getElementById('outputVolume');
    const voiceThreshold = document.getElementById('voiceThreshold');
    const voiceSensitivity = document.getElementById('voiceSensitivity');
    
    // Обновление значений в реальном времени
    if (inputVolume) {
        inputVolume.addEventListener('input', () => {
            const value = document.getElementById('inputVolumeValue');
            if (value) value.textContent = `${inputVolume.value}%`;
        });
    }
    
    if (outputVolume) {
        outputVolume.addEventListener('input', () => {
            const value = document.getElementById('outputVolumeValue');
            if (value) value.textContent = `${outputVolume.value}%`;
            applyOutputVolume();
        });
    }
    
    if (voiceThreshold) {
        voiceThreshold.addEventListener('input', () => {
            const value = document.getElementById('voiceThresholdValue');
            if (value) value.textContent = `${voiceThreshold.value} dB`;
        });
    }
    
    if (voiceSensitivity) {
        voiceSensitivity.addEventListener('input', () => {
            const value = parseInt(voiceSensitivity.value);
            let label = 'Низкая';
            if (value > 7) label = 'Высокая';
            else if (value > 4) label = 'Средняя';
            const display = document.getElementById('voiceSensitivityValue');
            if (display) display.textContent = label;
        });
    }
    
    // Тест микрофона
    const testMicBtn = document.getElementById('testMicrophoneBtn');
    if (testMicBtn) {
        testMicBtn.addEventListener('click', startMicrophoneTest);
    }
    
    // Тест звука
    const testOutputBtn = document.getElementById('testOutputBtn');
    if (testOutputBtn) {
        testOutputBtn.addEventListener('click', () => {
            // Создаем простой тестовый звук на лету
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.type = 'sine';
            oscillator.frequency.value = 440;
            gainNode.gain.value = 0.1;
            
            const duration = 0.5;
            
            oscillator.start();
            oscillator.stop(audioContext.currentTime + duration);
            
            const status = document.getElementById('audioTestStatus');
            if (status) {
                status.textContent = 'Воспроизведение тестового звука...';
                status.classList.add('playing');
                
                setTimeout(() => {
                    status.textContent = 'Тест завершен';
                    status.classList.remove('playing');
                }, duration * 1000 + 100);
            }
            
            // Очистка
            setTimeout(() => {
                oscillator.disconnect();
                gainNode.disconnect();
            }, (duration + 0.1) * 1000);
        });
    }
}

function loadSettings() {
    // Загрузка настроек из localStorage
    const savedNoiseSuppression = localStorage.getItem('noiseSuppressionEnabled');
    const savedEchoCancellation = localStorage.getItem('echoCancellationEnabled');
    const savedAutoGainControl = localStorage.getItem('autoGainControlEnabled');
    const savedVoiceMode = localStorage.getItem('voiceMode');
    const savedVoiceThreshold = localStorage.getItem('voiceThreshold');
    const savedVoiceSensitivity = localStorage.getItem('voiceSensitivity');
    const savedInputVolume = localStorage.getItem('inputVolume');
    const savedOutputVolume = localStorage.getItem('outputVolume');
    const savedAudioInput = localStorage.getItem('selectedAudioInput');
    const savedAudioOutput = localStorage.getItem('selectedAudioOutput');
    
    // Обновление глобальных переменных
    if (savedNoiseSuppression !== null) {
        noiseSuppressionEnabled = savedNoiseSuppression === 'true';
    }
    
    if (savedEchoCancellation !== null) {
        audioConstraints.echoCancellation = savedEchoCancellation === 'true';
    }
    
    if (savedAutoGainControl !== null) {
        audioConstraints.autoGainControl = savedAutoGainControl === 'true';
    }
    
    if (savedAudioInput) {
        selectedAudioInput = savedAudioInput;
    }
    
    if (savedAudioOutput) {
        selectedAudioOutput = savedAudioOutput;
    }
    
    // Применение настроек к элементам UI если они существуют
    const noiseSuppressionToggle = document.getElementById('noiseSuppressionToggle');
    const echoCancellationToggle = document.getElementById('echoCancellationToggle');
    const autoGainControlToggle = document.getElementById('autoGainControlToggle');
    
    if (noiseSuppressionToggle && savedNoiseSuppression !== null) {
        noiseSuppressionToggle.checked = noiseSuppressionEnabled;
    }
    
    if (echoCancellationToggle && savedEchoCancellation !== null) {
        echoCancellationToggle.checked = audioConstraints.echoCancellation;
    }
    
    if (autoGainControlToggle && savedAutoGainControl !== null) {
        autoGainControlToggle.checked = audioConstraints.autoGainControl;
    }
    
    if (savedVoiceMode) {
        const voiceModeRadio = document.querySelector(`input[name="voiceMode"][value="${savedVoiceMode}"]`);
        if (voiceModeRadio) {
            voiceModeRadio.checked = true;
        }
    }
    
    if (savedVoiceThreshold) {
        const voiceThresholdElem = document.getElementById('voiceThreshold');
        const voiceThresholdValue = document.getElementById('voiceThresholdValue');
        if (voiceThresholdElem && voiceThresholdValue) {
            voiceThresholdElem.value = savedVoiceThreshold;
            voiceThresholdValue.textContent = `${savedVoiceThreshold} dB`;
        }
    }
    
    if (savedVoiceSensitivity) {
        const voiceSensitivityElem = document.getElementById('voiceSensitivity');
        const voiceSensitivityValue = document.getElementById('voiceSensitivityValue');
        if (voiceSensitivityElem && voiceSensitivityValue) {
            voiceSensitivityElem.value = savedVoiceSensitivity;
            const value = parseInt(savedVoiceSensitivity);
            let label = 'Низкая';
            if (value > 7) label = 'Высокая';
            else if (value > 4) label = 'Средняя';
            voiceSensitivityValue.textContent = label;
        }
    }
    
    if (savedInputVolume) {
        const inputVolumeElem = document.getElementById('inputVolume');
        const inputVolumeValue = document.getElementById('inputVolumeValue');
        if (inputVolumeElem && inputVolumeValue) {
            inputVolumeElem.value = savedInputVolume;
            inputVolumeValue.textContent = `${savedInputVolume}%`;
        }
    }
    
    if (savedOutputVolume) {
        const outputVolumeElem = document.getElementById('outputVolume');
        const outputVolumeValue = document.getElementById('outputVolumeValue');
        if (outputVolumeElem && outputVolumeValue) {
            outputVolumeElem.value = savedOutputVolume;
            outputVolumeValue.textContent = `${savedOutputVolume}%`;
        }
    }
    
    // Применение устройства вывода
    if (savedAudioOutput) {
        applyAudioOutput(savedAudioOutput);
    }
}

async function loadAudioDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.warn('Media Devices API not supported');
        return;
    }
    
    try {
        // Сначала запросим разрешение на доступ к микрофону для получения меток устройств
        if (!localAudioStream) {
            await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        audioDevices.input = devices.filter(device => device.kind === 'audioinput');
        audioDevices.output = devices.filter(device => device.kind === 'audiooutput');
        
        console.log('Найдены устройства ввода:', audioDevices.input);
        console.log('Найдены устройства вывода:', audioDevices.output);
        
        updateDeviceSelectors();
    } catch (error) {
        console.error('Error loading audio devices:', error);
        // Пробуем без разрешения на микрофон
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            audioDevices.input = devices.filter(device => device.kind === 'audioinput');
            audioDevices.output = devices.filter(device => device.kind === 'audiooutput');
            updateDeviceSelectors();
        } catch (e) {
            console.error('Failed to enumerate devices:', e);
        }
    }
}

function updateDeviceSelectors() {
    const inputSelect = document.getElementById('audioInputSelect');
    const outputSelect = document.getElementById('audioOutputSelect');
    
    if (!inputSelect || !outputSelect) return;
    
    // Очистка списков
    inputSelect.innerHTML = '<option value="">Выберите микрофон...</option>';
    outputSelect.innerHTML = '<option value="">Выберите динамики...</option>';
    
    // Добавление устройств ввода
    audioDevices.input.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        const label = device.label || `Микрофон ${index + 1}`;
        option.textContent = label;
        option.title = device.deviceId;
        inputSelect.appendChild(option);
    });
    
    // Добавление устройств вывода
    audioDevices.output.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        const label = device.label || `Динамики ${index + 1}`;
        option.textContent = label;
        option.title = device.deviceId;
        outputSelect.appendChild(option);
    });
    
    // Установка сохраненных значений
    const savedInput = localStorage.getItem('selectedAudioInput');
    const savedOutput = localStorage.getItem('selectedAudioOutput');
    
    if (savedInput && inputSelect.querySelector(`[value="${savedInput}"]`)) {
        inputSelect.value = savedInput;
        selectedAudioInput = savedInput;
    }
    
    if (savedOutput && outputSelect.querySelector(`[value="${savedOutput}"]`)) {
        outputSelect.value = savedOutput;
        selectedAudioOutput = savedOutput;
    }
    
    // Если нет сохраненного значения, выбираем первое устройство
    if (!savedInput && audioDevices.input.length > 0) {
        inputSelect.value = audioDevices.input[0].deviceId;
    }
    
    if (!savedOutput && audioDevices.output.length > 0) {
        outputSelect.value = audioDevices.output[0].deviceId;
    }
}

function applyAudioOutput(deviceId) {
    if (!deviceId) return;
    
    console.log('Применяю устройство вывода:', deviceId);
    
    // Для наушников/динамиков в WebRTC нужно использовать setSinkId
    // Это применяется к аудио элементам
    document.querySelectorAll('.audio-element').forEach(audio => {
        if (audio.setSinkId) {
            audio.setSinkId(deviceId)
                .then(() => {
                    console.log('Устройство вывода применено к аудио элементу');
                })
                .catch(error => {
                    console.error('Ошибка применения устройства вывода:', error);
                });
        }
    });
    
    // Для тестового звука
    const testSound = document.getElementById('testSound');
    if (testSound && testSound.setSinkId) {
        testSound.setSinkId(deviceId)
            .catch(error => {
                console.error('Ошибка применения устройства вывода к тестовому звуку:', error);
            });
    }
}

function saveSettings() {
    // Получение значений из формы
    const noiseSuppression = document.getElementById('noiseSuppressionToggle').checked;
    const echoCancellation = document.getElementById('echoCancellationToggle').checked;
    const autoGainControl = document.getElementById('autoGainControlToggle').checked;
    const voiceMode = document.querySelector('input[name="voiceMode"]:checked')?.value || 'auto';
    const voiceThreshold = document.getElementById('voiceThreshold').value;
    const voiceSensitivity = document.getElementById('voiceSensitivity').value;
    const inputVolume = document.getElementById('inputVolume').value;
    const outputVolume = document.getElementById('outputVolume').value;
    const audioInput = document.getElementById('audioInputSelect').value;
    const audioOutput = document.getElementById('audioOutputSelect').value;
    
    // Валидация
    if (!audioInput && audioDevices.input.length > 0) {
        alert('Пожалуйста, выберите микрофон');
        return;
    }
    
    // Сохранение настроек в localStorage
    localStorage.setItem('noiseSuppressionEnabled', noiseSuppression);
    localStorage.setItem('echoCancellationEnabled', echoCancellation);
    localStorage.setItem('autoGainControlEnabled', autoGainControl);
    localStorage.setItem('voiceMode', voiceMode);
    localStorage.setItem('voiceThreshold', voiceThreshold);
    localStorage.setItem('voiceSensitivity', voiceSensitivity);
    localStorage.setItem('inputVolume', inputVolume);
    localStorage.setItem('outputVolume', outputVolume);
    
    if (audioInput) {
        localStorage.setItem('selectedAudioInput', audioInput);
        selectedAudioInput = audioInput;
    }
    
    if (audioOutput) {
        localStorage.setItem('selectedAudioOutput', audioOutput);
        selectedAudioOutput = audioOutput;
        // Немедленно применяем устройство вывода
        applyAudioOutput(audioOutput);
    }
    
    // Обновление глобальных переменных
    noiseSuppressionEnabled = noiseSuppression;
    audioConstraints.echoCancellation = echoCancellation;
    audioConstraints.autoGainControl = autoGainControl;
    
    // Перезапуск аудио с новыми настройками если мы в звонке
    if (inCall && localAudioStream) {
        restartAudioWithNewSettings();
    }
    
    // Применение громкости
    applyOutputVolume();
    applyInputVolume(parseInt(inputVolume) / 100);
    
    // Показать уведомление
    showNotification('Настройки', 'Настройки сохранены успешно');
    
    // Закрыть модальное окно
    closeSettingsModal();
}

function resetSettings() {
    if (confirm('Вы уверены, что хотите сбросить все настройки к значениям по умолчанию?')) {
        // Сброс значений по умолчанию
        document.getElementById('noiseSuppressionToggle').checked = true;
        document.getElementById('echoCancellationToggle').checked = true;
        document.getElementById('autoGainControlToggle').checked = true;
        document.getElementById('voiceActivityAuto').checked = true;
        document.getElementById('voiceThreshold').value = -30;
        document.getElementById('voiceThresholdValue').textContent = '-30 dB';
        document.getElementById('voiceSensitivity').value = 5;
        document.getElementById('voiceSensitivityValue').textContent = 'Средняя';
        document.getElementById('inputVolume').value = 100;
        document.getElementById('inputVolumeValue').textContent = '100%';
        document.getElementById('outputVolume').value = 100;
        document.getElementById('outputVolumeValue').textContent = '100%';
        
        // Сброс выбора устройств
        const inputSelect = document.getElementById('audioInputSelect');
        const outputSelect = document.getElementById('audioOutputSelect');
        
        if (inputSelect.options.length > 0) {
            inputSelect.selectedIndex = 0;
        }
        
        if (outputSelect.options.length > 0) {
            outputSelect.selectedIndex = 0;
        }
        
        showNotification('Настройки', 'Настройки сброшены');
    }
}

function applyOutputVolume() {
    const volumeSlider = document.getElementById('outputVolume');
    if (!volumeSlider) return;
    
    const volume = parseInt(volumeSlider.value) / 100;
    
    console.log('Установка громкости вывода:', volume);
    
    // Применение громкости ко всем аудио элементам
    document.querySelectorAll('.audio-element').forEach(audio => {
        audio.volume = volume;
    });
    
    // Применение громкости к тестовому звуку
    const testSound = document.getElementById('testSound');
    if (testSound) {
        testSound.volume = volume;
    }
}

function updateSettingsUI() {
    // Обновление значений в UI на основе сохраненных настроек
    loadSettings();
}

function restartAudioWithNewSettings() {
    if (!localAudioStream || !inCall) return;
    
    const oldStream = localAudioStream;
    const wasMuted = isMuted;
    
    try {
        // Остановка старых треков
        oldStream.getTracks().forEach(track => {
            try {
                track.stop();
            } catch (e) {
                // Игнорировать ошибки остановки
            }
        });
        
        // Получение нового потока с обновленными настройками
        ensureLocalAudio(noiseSuppressionEnabled).then(newStream => {
            // Обновление всех peer connections с новым аудио треком
            const newAudioTrack = newStream.getAudioTracks()[0];
            if (newAudioTrack) {
                Object.values(peerConnections).forEach(pc => {
                    try {
                        const senders = pc.getSenders();
                        senders.forEach(sender => {
                            if (sender.track && sender.track.kind === 'audio') {
                                sender.replaceTrack(newAudioTrack);
                            }
                        });
                    } catch (error) {
                        console.warn('Ошибка обновления peer connection:', error);
                    }
                });
            }
            
            // Восстановление состояния mute
            if (wasMuted && newStream) {
                newStream.getAudioTracks().forEach(track => {
                    track.enabled = false;
                });
            }
            
            console.log('Аудио перезапущено с новыми настройками');
        }).catch(error => {
            console.error('Ошибка перезапуска аудио:', error);
        });
        
    } catch (error) {
        console.error('Ошибка перезапуска аудио:', error);
    }
}

// ============================================================================
// MICROPHONE TEST
// ============================================================================

async function startMicrophoneTest() {
    const status = document.getElementById('audioTestStatus');
    if (!status) return;
    
    try {
        // Остановка предыдущего теста если он был
        stopMicrophoneTest();
        
        // Получение настроек устройства ввода
        const deviceId = document.getElementById('audioInputSelect').value;
        
        if (!deviceId && audioDevices.input.length > 0) {
            // Используем первое устройство если ничего не выбрано
            deviceId = audioDevices.input[0].deviceId;
        }
        
        if (!deviceId) {
            status.textContent = 'Микрофон не найден';
            return;
        }
        
        // Получение потока с выбранным устройством
        const constraints = {
            audio: {
                deviceId: { exact: deviceId },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        };
        
        testMicrophoneStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Создание AudioContext для анализа
        testAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        testAnalyser = testAudioContext.createAnalyser();
        testAnalyser.fftSize = 256;
        
        const source = testAudioContext.createMediaStreamSource(testMicrophoneStream);
        source.connect(testAnalyser);
        
        // Простой индикатор уровня
        status.textContent = 'Говорите в микрофон... Уровень: 0%';
        status.classList.add('speaking');
        
        // Функция обновления уровня
        function updateLevel() {
            if (!testAnalyser) return;
            
            const dataArray = new Uint8Array(testAnalyser.frequencyBinCount);
            testAnalyser.getByteFrequencyData(dataArray);
            
            // Расчет среднего уровня
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            const level = Math.floor((average / 256) * 100);
            
            // Обновление текста
            status.textContent = `Говорите в микрофон... Уровень: ${level}%`;
            
            // Продолжаем анимацию если тест активен
            if (testAnalyser) {
                requestAnimationFrame(updateLevel);
            }
        }
        
        updateLevel();
        
    } catch (error) {
        console.error('Ошибка теста микрофона:', error);
        status.textContent = `Ошибка: ${error.message}`;
        status.classList.remove('speaking');
    }
}

function createLevelVisualizer() {
    const status = document.getElementById('audioTestStatus');
    
    // Создаем контейнер для визуализатора
    let visualizer = status.querySelector('.level-visualizer');
    if (!visualizer) {
        visualizer = document.createElement('div');
        visualizer.className = 'level-visualizer';
        visualizer.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 2px;
            margin-left: 10px;
            vertical-align: middle;
        `;
        status.appendChild(visualizer);
    }
    
    // Очищаем и создаем новые бары
    visualizer.innerHTML = '';
    for (let i = 0; i < 10; i++) {
        const bar = document.createElement('div');
        bar.className = 'level-bar';
        bar.style.cssText = `
            width: 3px;
            height: 10px;
            background-color: #43b581;
            border-radius: 1px;
            opacity: 0.3;
            transition: all 0.1s;
        `;
        visualizer.appendChild(bar);
    }
    
    // Функция обновления визуализатора
    function updateVisualizer() {
        if (!testAnalyser || !visualizer.parentNode) {
            return;
        }
        
        const dataArray = new Uint8Array(testAnalyser.frequencyBinCount);
        testAnalyser.getByteFrequencyData(dataArray);
        
        // Расчет среднего уровня
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const level = Math.floor((average / 256) * 100);
        
        // Обновление баров
        const bars = visualizer.querySelectorAll('.level-bar');
        const activeBars = Math.floor((level / 100) * bars.length);
        
        bars.forEach((bar, index) => {
            if (index < activeBars) {
                const height = 10 + (index * 2); // Выше для более правых баров
                bar.style.height = `${height}px`;
                bar.style.opacity = '1';
                bar.style.backgroundColor = index > 7 ? '#ed4245' : 
                                           index > 4 ? '#faa81a' : 
                                           '#43b581';
            } else {
                bar.style.height = '10px';
                bar.style.opacity = '0.3';
                bar.style.backgroundColor = '#43b581';
            }
        });
        
        // Продолжаем анимацию
        requestAnimationFrame(updateVisualizer);
    }
    
    updateVisualizer();
}

function stopMicrophoneTest() {
    const status = document.getElementById('audioTestStatus');
    
    if (testMicrophoneStream) {
        testMicrophoneStream.getTracks().forEach(track => track.stop());
        testMicrophoneStream = null;
    }
    
    if (testAudioContext && testAudioContext.state !== 'closed') {
        testAudioContext.close();
        testAudioContext = null;
        testAnalyser = null;
    }
    
    status.textContent = '';
    status.classList.remove('speaking');
}

function makeResizable(element) {
    if (element.hasAttribute('data-resizable')) return;
    
    element.setAttribute('data-resizable', 'true');
    
    element.style.resize = 'both';
    element.style.overflow = 'auto';
    element.style.minWidth = '200px';
    element.style.minHeight = '150px';
    element.style.maxWidth = '90vw';
    element.style.maxHeight = '90vh';
    
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
        `;
        dmItem.addEventListener('click', () => {
            startDM(friend.id, friend.username);
        });
        dmList.appendChild(dmItem);
    });
}