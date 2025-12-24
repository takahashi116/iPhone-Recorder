/**
 * iPhone Recorder - Main Application Logic
 * Features: Audio Recording, Wake Lock, Google Drive Integration
 */

// ============================================
// Configuration & State
// ============================================

// ⚠️ デプロイ前にここにあなたのGoogle Cloud認証情報を入力してください
const GOOGLE_CLIENT_ID = '478200222114-ronuhiecjrc0lp9t1b6nnqod7cji46o3.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'AIzaSyB6YPsmEy62ltuh1aqZX6Z5Hjx0P9mt0Lw';

const RECORDINGS_STORAGE_KEY = 'iphone-recorder-recordings';
const FOLDER_STORAGE_KEY = 'iphone-recorder-folder';
const TOKEN_STORAGE_KEY = 'iphone-recorder-token';

let state = {
    isRecording: false,
    isPaused: false,
    mediaRecorder: null,
    audioChunks: [],
    audioStream: null,
    wakeLock: null,
    timerInterval: null,
    startTime: null,
    elapsedTime: 0,
    analyser: null,
    animationId: null,

    // Google Auth
    tokenClient: null,
    accessToken: null,
    selectedFolderId: null,
    selectedFolderName: null,

    // Pending upload (when token expired during recording)
    pendingRecording: null,
};

// ============================================
// DOM Elements
// ============================================

const elements = {
    recordBtn: document.getElementById('recordBtn'),
    timer: document.getElementById('timer'),
    statusIndicator: document.getElementById('statusIndicator'),
    warningBanner: document.getElementById('warningBanner'),
    visualizer: document.getElementById('visualizer'),

    // Google Drive
    googleAuthBtn: document.getElementById('googleAuthBtn'),
    authStatus: document.getElementById('authStatus'),
    folderSelector: document.getElementById('folderSelector'),
    selectedFolder: document.getElementById('selectedFolder'),
    selectFolderBtn: document.getElementById('selectFolderBtn'),
    autoUploadToggle: document.getElementById('autoUploadToggle'),
    autoUploadCheck: document.getElementById('autoUploadCheck'),

    // Recordings
    recordingsSection: document.getElementById('recordingsSection'),
    recordingsList: document.getElementById('recordingsList'),
};

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    checkBrowserCompatibility();
    loadSavedFolder();
    loadSavedToken();
    loadRecordings();
    setupEventListeners();
    checkMicrophonePermission();
    initVisualizer();
    initGoogleApi();
});

function checkBrowserCompatibility() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isChrome = /CriOS/.test(ua); // Chrome on iOS

    if (isIOS && isChrome) {
        const warning = document.getElementById('browserWarning');
        if (warning) {
            warning.style.display = 'flex';
        }
        console.warn('iOS Chrome detected - microphone may not work properly. Safari is recommended.');
    }
}

function setupEventListeners() {
    elements.recordBtn.addEventListener('click', toggleRecording);
    elements.googleAuthBtn.addEventListener('click', handleGoogleAuth);
    elements.selectFolderBtn.addEventListener('click', openFolderPicker);
}

// ============================================
// Saved Folder Management
// ============================================

function loadSavedFolder() {
    const saved = localStorage.getItem(FOLDER_STORAGE_KEY);
    if (saved) {
        try {
            const folder = JSON.parse(saved);
            state.selectedFolderId = folder.id;
            state.selectedFolderName = folder.name;
            updateFolderDisplay(folder.name);
        } catch (e) {
            console.error('Failed to load saved folder:', e);
        }
    }
}

function saveFolderToStorage(id, name) {
    localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify({ id, name }));
}

// ============================================
// Microphone & Recording
// ============================================

async function checkMicrophonePermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        elements.recordBtn.disabled = false;
        updateStatus('待機中', false);
    } catch (err) {
        console.error('Microphone permission denied:', err);
        updateStatus('マイクへのアクセスを許可してください', false);
        showToast('マイクへのアクセスを許可してください', 'error');
    }
}

async function toggleRecording() {
    if (state.isRecording) {
        await stopRecording();
    } else {
        await startRecording();
    }
}

async function startRecording() {
    try {
        // Request microphone access
        state.audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            }
        });

        // Setup MediaRecorder with iOS-compatible format
        const mimeType = getSupportedMimeType();
        state.mediaRecorder = new MediaRecorder(state.audioStream, { mimeType });
        state.audioChunks = [];

        state.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                state.audioChunks.push(event.data);
            }
        };

        state.mediaRecorder.onstop = handleRecordingComplete;

        // Start recording
        state.mediaRecorder.start(1000); // Collect data every second
        state.isRecording = true;
        state.startTime = Date.now();

        // Request wake lock
        await requestWakeLock();

        // Start timer
        startTimer();

        // Start visualizer
        setupAudioAnalyser();

        // Update UI
        updateRecordingUI(true);
        updateStatus('録音中...', true);

    } catch (err) {
        console.error('Failed to start recording:', err);
        showToast('録音の開始に失敗しました: ' + err.message, 'error');
    }
}

async function stopRecording() {
    if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;

    state.mediaRecorder.stop();
    state.isRecording = false;

    // Stop all tracks
    if (state.audioStream) {
        state.audioStream.getTracks().forEach(track => track.stop());
    }

    // Release wake lock
    releaseWakeLock();

    // Stop timer
    stopTimer();

    // Stop visualizer
    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
    }

    // Update UI
    updateRecordingUI(false);
    updateStatus('処理中...', false);
}

function getSupportedMimeType() {
    const types = [
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
    ];

    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            console.log('Using mime type:', type);
            return type;
        }
    }

    return 'audio/webm'; // Fallback
}

async function handleRecordingComplete() {
    const mimeType = state.mediaRecorder.mimeType || 'audio/webm';
    const blob = new Blob(state.audioChunks, { type: mimeType });

    const recording = {
        id: Date.now().toString(),
        name: `録音_${formatDateForFilename(new Date())}`,
        date: new Date().toISOString(),
        duration: state.elapsedTime,
        size: blob.size,
        mimeType: mimeType,
        blob: blob, // Keep in memory temporarily
    };

    // Save to local storage (metadata only)
    saveRecordingMetadata(recording);

    // Display recording
    displayRecording(recording);

    // Check if token is still valid
    const isTokenValid = checkTokenValidity();

    // Auto upload if enabled AND token is valid
    if (elements.autoUploadCheck.checked && state.accessToken && state.selectedFolderId && isTokenValid) {
        await uploadToDrive(recording);
    } else if (elements.autoUploadCheck.checked && (!isTokenValid || !state.accessToken)) {
        // Token expired - save recording for later upload
        state.pendingRecording = recording;
        showTokenExpiredUI();
        // Still download as backup
        downloadRecording(recording);
        showToast('認証切れ：再ログイン後にアップロードできます', 'warning');
    } else {
        // Create download link
        downloadRecording(recording);
    }

    updateStatus('完了', false);
    showToast('録音が完了しました ✅');

    // Reset timer display
    state.elapsedTime = 0;
}

function checkTokenValidity() {
    const cachedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!cachedToken) return false;

    try {
        const tokenData = JSON.parse(cachedToken);
        return tokenData.expires_at && Date.now() < tokenData.expires_at;
    } catch (e) {
        return false;
    }
}

function showTokenExpiredUI() {
    // Reset auth UI to show login button again
    elements.authStatus.classList.remove('connected');
    elements.authStatus.querySelector('.auth-icon').textContent = '⚠️';
    elements.authStatus.querySelector('.auth-text').textContent = '認証切れ - 再ログインが必要';
    elements.googleAuthBtn.style.display = 'block';
    elements.googleAuthBtn.innerHTML = `
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" class="google-icon">
        <span>再ログインしてアップロード</span>
    `;

    // Clear expired token
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    state.accessToken = null;
}

// ============================================
// Wake Lock (Prevent Screen Sleep)
// ============================================

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            state.wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock activated');

            state.wakeLock.addEventListener('release', () => {
                console.log('Wake Lock released');
            });
        } catch (err) {
            console.error('Wake Lock failed:', err);
            // Fallback: show warning
            showToast('画面スリープ防止機能が利用できません。画面を開いたままにしてください。', 'warning');
        }
    } else {
        console.warn('Wake Lock API not supported');
        showToast('画面スリープ防止機能がお使いのブラウザでサポートされていません', 'warning');
    }
}

function releaseWakeLock() {
    if (state.wakeLock) {
        state.wakeLock.release();
        state.wakeLock = null;
    }
}

// Re-acquire wake lock when page becomes visible
document.addEventListener('visibilitychange', async () => {
    if (state.isRecording && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// ============================================
// Timer
// ============================================

function startTimer() {
    state.timerInterval = setInterval(() => {
        state.elapsedTime = Math.floor((Date.now() - state.startTime) / 1000);
        elements.timer.textContent = formatTime(state.elapsedTime);
    }, 1000);
}

function stopTimer() {
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function pad(num) {
    return num.toString().padStart(2, '0');
}

// ============================================
// Audio Visualizer
// ============================================

function initVisualizer() {
    const canvas = elements.visualizer;
    const ctx = canvas.getContext('2d');

    // Set canvas size
    const resize = () => {
        canvas.width = canvas.offsetWidth * window.devicePixelRatio;
        canvas.height = canvas.offsetHeight * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resize();
    window.addEventListener('resize', resize);

    // Draw initial state
    drawIdleVisualizer(ctx, canvas);
}

function setupAudioAnalyser() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    state.analyser = audioContext.createAnalyser();
    state.analyser.fftSize = 256;

    const source = audioContext.createMediaStreamSource(state.audioStream);
    source.connect(state.analyser);

    drawVisualizer();
}

function drawVisualizer() {
    const canvas = elements.visualizer;
    const ctx = canvas.getContext('2d');
    const bufferLength = state.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        if (!state.isRecording) {
            drawIdleVisualizer(ctx, canvas);
            return;
        }

        state.animationId = requestAnimationFrame(draw);
        state.analyser.getByteFrequencyData(dataArray);

        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;

        ctx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * height;

            const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
            gradient.addColorStop(0, '#6366f1');
            gradient.addColorStop(0.5, '#8b5cf6');
            gradient.addColorStop(1, '#a855f7');

            ctx.fillStyle = gradient;
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }

    draw();
}

function drawIdleVisualizer(ctx, canvas) {
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';

    const barCount = 50;
    const barWidth = width / barCount - 2;

    for (let i = 0; i < barCount; i++) {
        const barHeight = Math.random() * 10 + 5;
        ctx.fillRect(i * (barWidth + 2), (height - barHeight) / 2, barWidth, barHeight);
    }
}

// ============================================
// Google API Integration
// ============================================

function initGoogleApi() {
    // Check if credentials are configured
    if (GOOGLE_CLIENT_ID === 'YOUR_CLIENT_ID.apps.googleusercontent.com' ||
        GOOGLE_API_KEY === 'YOUR_API_KEY') {
        console.warn('Google API credentials not configured');
        elements.googleAuthBtn.textContent = '⚠️ API未設定';
        elements.googleAuthBtn.disabled = true;
        return;
    }

    console.log('Initializing Google API...');
    console.log('Client ID:', GOOGLE_CLIENT_ID.substring(0, 20) + '...');
    console.log('API Key:', GOOGLE_API_KEY.substring(0, 10) + '...');

    // Check if gapi is loaded
    if (typeof gapi === 'undefined') {
        console.error('gapi is not loaded yet. Retrying in 1 second...');
        setTimeout(initGoogleApi, 1000);
        return;
    }

    // Load the Google API client
    gapi.load('client:picker', async () => {
        try {
            console.log('gapi.client loading...');
            await gapi.client.init({
                apiKey: GOOGLE_API_KEY,
                discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
            });
            console.log('gapi.client initialized');

            // Check if google.accounts is loaded
            if (typeof google === 'undefined' || typeof google.accounts === 'undefined') {
                console.error('Google Identity Services not loaded yet. Retrying in 1 second...');
                setTimeout(initGoogleApi, 1000);
                return;
            }

            // Initialize token client
            state.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/drive.file',
                callback: handleTokenResponse,
            });

            elements.recordBtn.disabled = false;
            console.log('Google API initialized successfully ✅');

        } catch (err) {
            console.error('Failed to initialize Google API:', err);
            console.error('Error details:', JSON.stringify(err, null, 2));
            showToast('Google API初期化エラー: ' + (err.message || err.error?.message || 'Unknown error'), 'error');
        }
    });
}

function handleGoogleAuth() {
    if (!state.tokenClient) {
        showToast('Google APIが初期化されていません', 'warning');
        return;
    }

    // Check if we have a cached token first
    const cachedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (cachedToken) {
        try {
            const tokenData = JSON.parse(cachedToken);
            // Check if token is still valid (within 50 minutes, tokens last 60 min)
            if (tokenData.expires_at && Date.now() < tokenData.expires_at) {
                console.log('Using cached token');
                state.accessToken = tokenData.access_token;
                updateAuthUI();
                return;
            } else {
                console.log('Cached token expired, requesting new one');
                localStorage.removeItem(TOKEN_STORAGE_KEY);
            }
        } catch (e) {
            console.error('Error parsing cached token:', e);
            localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
    }

    // Request access token - use 'select_account' instead of 'consent' for smoother UX
    state.tokenClient.requestAccessToken({ prompt: '' });
}

function handleTokenResponse(response) {
    if (response.error) {
        console.error('Token error:', response);
        // If error, try again with consent prompt
        if (state.tokenClient) {
            console.log('Retrying with consent prompt...');
            state.tokenClient.requestAccessToken({ prompt: 'consent' });
        }
        return;
    }

    state.accessToken = response.access_token;

    // Save token to localStorage with expiry (tokens last 60 minutes, save for 50)
    const tokenData = {
        access_token: response.access_token,
        expires_at: Date.now() + (50 * 60 * 1000) // 50 minutes from now
    };
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenData));
    console.log('Token saved to localStorage');

    updateAuthUI();
    showToast('Googleアカウントに接続しました ✅');
}

function updateAuthUI() {
    elements.authStatus.classList.add('connected');
    elements.authStatus.querySelector('.auth-icon').textContent = '✅';
    elements.authStatus.querySelector('.auth-text').textContent = '接続済み';
    elements.googleAuthBtn.style.display = 'none';
    elements.folderSelector.style.display = 'block';
    elements.autoUploadToggle.style.display = 'block';

    // Check if there's a pending recording to upload
    if (state.pendingRecording) {
        uploadPendingRecording();
    }
}

async function uploadPendingRecording() {
    if (!state.pendingRecording) return;

    const recording = state.pendingRecording;
    showToast('待機中の録音をアップロード中...', 'success');

    try {
        await uploadToDrive(recording);
        state.pendingRecording = null; // Clear after successful upload
    } catch (err) {
        console.error('Failed to upload pending recording:', err);
        showToast('アップロードに失敗しました', 'error');
    }
}

function loadSavedToken() {
    const cachedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (cachedToken) {
        try {
            const tokenData = JSON.parse(cachedToken);
            if (tokenData.expires_at && Date.now() < tokenData.expires_at) {
                console.log('Restored token from cache');
                state.accessToken = tokenData.access_token;
                updateAuthUI();
            } else {
                console.log('Cached token expired');
                localStorage.removeItem(TOKEN_STORAGE_KEY);
            }
        } catch (e) {
            console.error('Error loading cached token:', e);
            localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
    }
}

function openFolderPicker() {
    if (!state.accessToken) {
        showToast('まずGoogleアカウントにログインしてください', 'warning');
        return;
    }

    const picker = new google.picker.PickerBuilder()
        .addView(new google.picker.DocsView()
            .setIncludeFolders(true)
            .setSelectFolderEnabled(true)
            .setMimeTypes('application/vnd.google-apps.folder'))
        .setOAuthToken(state.accessToken)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setCallback(handleFolderSelection)
        .setTitle('保存先フォルダを選択')
        .build();

    picker.setVisible(true);
}

function handleFolderSelection(data) {
    if (data.action === google.picker.Action.PICKED) {
        const folder = data.docs[0];
        state.selectedFolderId = folder.id;
        state.selectedFolderName = folder.name;

        updateFolderDisplay(folder.name);
        saveFolderToStorage(folder.id, folder.name);

        showToast(`フォルダ「${folder.name}」を選択しました ✅`);
    }
}

function updateFolderDisplay(folderName) {
    elements.selectedFolder.querySelector('.folder-name').textContent = folderName;
}

async function uploadToDrive(recording) {
    if (!state.accessToken || !state.selectedFolderId) {
        showToast('Google Driveの設定を完了してください', 'warning');
        return;
    }

    updateStatus('アップロード中...', false);

    try {
        const extension = recording.mimeType.includes('mp4') ? 'mp4' :
            recording.mimeType.includes('webm') ? 'webm' : 'ogg';
        const fileName = `${recording.name}.${extension}`;

        const metadata = {
            name: fileName,
            mimeType: recording.mimeType,
            parents: [state.selectedFolderId],
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', recording.blob);

        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${state.accessToken}`,
            },
            body: form,
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
        }

        const result = await response.json();
        console.log('Upload successful:', result);
        showToast(`Google Driveにアップロードしました ☁️`);

    } catch (err) {
        console.error('Upload error:', err);
        showToast('アップロードに失敗しました。ローカルにダウンロードします。', 'error');
        downloadRecording(recording);
    }
}

// ============================================
// Recording Management
// ============================================

function saveRecordingMetadata(recording) {
    const recordings = JSON.parse(localStorage.getItem(RECORDINGS_STORAGE_KEY) || '[]');
    recordings.unshift({
        id: recording.id,
        name: recording.name,
        date: recording.date,
        duration: recording.duration,
        size: recording.size,
        mimeType: recording.mimeType,
    });

    // Keep only last 20 recordings
    if (recordings.length > 20) {
        recordings.pop();
    }

    localStorage.setItem(RECORDINGS_STORAGE_KEY, JSON.stringify(recordings));
}

function loadRecordings() {
    const recordings = JSON.parse(localStorage.getItem(RECORDINGS_STORAGE_KEY) || '[]');

    if (recordings.length > 0) {
        elements.recordingsSection.style.display = 'block';
        recordings.forEach(rec => displayRecording(rec, false));
    }
}

function displayRecording(recording, hasBlob = true) {
    elements.recordingsSection.style.display = 'block';

    const item = document.createElement('div');
    item.className = 'recording-item';
    item.innerHTML = `
        <div class="recording-info">
            <div class="recording-name">🎵 ${recording.name}</div>
            <div class="recording-meta">
                ${formatTime(recording.duration)} | ${formatFileSize(recording.size)}
            </div>
        </div>
        <div class="recording-actions">
            ${hasBlob ? `<button onclick="downloadRecordingById('${recording.id}')">💾</button>` : ''}
        </div>
    `;

    // Store blob reference if available
    if (hasBlob && recording.blob) {
        window[`recording_${recording.id}`] = recording.blob;
    }

    elements.recordingsList.prepend(item);
}

function downloadRecording(recording) {
    const extension = recording.mimeType.includes('mp4') ? 'mp4' :
        recording.mimeType.includes('webm') ? 'webm' : 'ogg';
    const fileName = `${recording.name}.${extension}`;

    const url = URL.createObjectURL(recording.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

window.downloadRecordingById = function (id) {
    const blob = window[`recording_${id}`];
    if (!blob) {
        showToast('録音データが見つかりません', 'error');
        return;
    }

    const recordings = JSON.parse(localStorage.getItem(RECORDINGS_STORAGE_KEY) || '[]');
    const recording = recordings.find(r => r.id === id);

    if (recording) {
        downloadRecording({ ...recording, blob });
    }
};

// ============================================
// UI Helpers
// ============================================

function updateRecordingUI(isRecording) {
    elements.recordBtn.classList.toggle('recording', isRecording);
    elements.recordBtn.querySelector('.btn-icon').textContent = isRecording ? '⏹️' : '🎤';
    elements.recordBtn.querySelector('.btn-text').textContent = isRecording ? '録音停止' : '録音開始';
    elements.warningBanner.classList.toggle('visible', isRecording);
    elements.statusIndicator.classList.toggle('recording', isRecording);
}

function updateStatus(text, isRecording) {
    elements.statusIndicator.querySelector('.status-text').textContent = text;
    elements.statusIndicator.classList.toggle('recording', isRecording);
}

function showToast(message, type = 'success') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 24px;
        background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#22c55e'};
        color: white;
        border-radius: 12px;
        font-size: 0.9rem;
        z-index: 9999;
        animation: slideUp 0.3s ease;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideDown 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp {
        from { transform: translate(-50%, 100%); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
    }
    @keyframes slideDown {
        from { transform: translate(-50%, 0); opacity: 1; }
        to { transform: translate(-50%, 100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// ============================================
// Utility Functions
// ============================================

function formatDateForFilename(date) {
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const h = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${y}${m}${d}_${h}${min}`;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
