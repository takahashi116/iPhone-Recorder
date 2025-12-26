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
    
    // Recording flow
    pendingBlob: null,
    pendingMimeType: null,
    pendingDuration: null,
    pendingDate: null,
    pendingUploadRecording: null,
    folderSelectionMode: false,
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
    selectedFolder: document.getElementById('selectedFolder'),
    selectFolderBtn: document.getElementById('selectFolderBtn'),

    // Recordings
    recordingsSection: document.getElementById('recordingsSection'),
    recordingsList: document.getElementById('recordingsList'),

    // Filename Modal
    filenameModal: document.getElementById('filenameModal'),
    filenameInput: document.getElementById('filenameInput'),
    saveFilenameBtn: document.getElementById('saveFilenameBtn'),
};

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded');
    console.log('filenameModal element:', elements.filenameModal);
    console.log('filenameInput element:', elements.filenameInput);
    console.log('saveFilenameBtn element:', elements.saveFilenameBtn);
    
    checkBrowserCompatibility();
    loadSavedFolder();
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
    elements.selectFolderBtn.addEventListener('click', handleSelectFolder);
    
    // Filename modal events
    elements.saveFilenameBtn.addEventListener('click', saveRecordingWithFilename);
    elements.filenameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveRecordingWithFilename();
        }
    });
}

// Handle folder selection button click (authenticate first if needed)
function handleSelectFolder() {
    state.folderSelectionMode = true;
    if (state.tokenClient) {
        state.tokenClient.requestAccessToken({ prompt: '' });
    } else {
        showToast('Google APIの初期化中です。少々お待ちください。', 'warning');
    }
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
    console.log('handleRecordingComplete called');
    
    const mimeType = state.mediaRecorder.mimeType || 'audio/mp4';
    const blob = new Blob(state.audioChunks, { type: mimeType });

    // Store blob and metadata temporarily for modal
    state.pendingBlob = blob;
    state.pendingMimeType = mimeType;
    state.pendingDuration = state.elapsedTime;
    state.pendingDate = new Date();

    // Show filename input modal (with delay for iOS Safari)
    setTimeout(() => {
        console.log('Showing filename modal');
        showFilenameModal();
    }, 100);
}

// ============================================
// Filename Modal
// ============================================

function showFilenameModal() {
    console.log('showFilenameModal called');
    
    // Set default filename in placeholder
    const defaultName = `録音_${formatDateForFilename(state.pendingDate)}`;
    elements.filenameInput.placeholder = defaultName;
    elements.filenameInput.value = '';
    
    // Show modal using class
    const modal = elements.filenameModal;
    modal.classList.add('visible');
    
    // Scroll to top to ensure modal is visible on iOS
    window.scrollTo(0, 0);
    
    // Focus input with delay for iOS
    setTimeout(() => {
        elements.filenameInput.focus();
    }, 300);
    
    console.log('Modal visible class added');
}

function hideFilenameModal() {
    elements.filenameModal.classList.remove('visible');
    elements.filenameInput.value = '';
}

async function saveRecordingWithFilename() {
    // Get filename from input or use default
    let filename = elements.filenameInput.value.trim();
    if (!filename) {
        filename = `録音_${formatDateForFilename(state.pendingDate)}`;
    }

    const recording = {
        id: Date.now().toString(),
        name: filename,
        date: state.pendingDate.toISOString(),
        duration: state.pendingDuration,
        size: state.pendingBlob.size,
        mimeType: state.pendingMimeType,
        blob: state.pendingBlob,
    };

    // Hide modal
    hideFilenameModal();

    // Save to local storage (metadata only)
    saveRecordingMetadata(recording);

    // Display recording
    displayRecording(recording);

    // Check if folder is selected
    if (!state.selectedFolderId) {
        showToast('フォルダ未設定のためローカルに保存します', 'warning');
        downloadRecording(recording);
        updateStatus('完了', false);
        clearPendingData();
        return;
    }

    // Store recording for upload after authentication
    state.pendingUploadRecording = recording;
    
    // Start Google authentication
    updateStatus('Google認証中...', false);
    initiateAuthForUpload();
}

function initiateAuthForUpload() {
    if (state.tokenClient) {
        // Request new access token (prompt: '' for silent if possible, will show UI if needed)
        state.tokenClient.requestAccessToken({ prompt: '' });
    } else {
        showToast('Google APIの初期化に失敗しました', 'error');
        if (state.pendingUploadRecording) {
            downloadRecording(state.pendingUploadRecording);
            state.pendingUploadRecording = null;
        }
        updateStatus('完了', false);
        clearPendingData();
    }
}

function clearPendingData() {
    state.elapsedTime = 0;
    state.pendingBlob = null;
    state.pendingMimeType = null;
    state.pendingDuration = null;
    state.pendingDate = null;
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
        elements.selectFolderBtn.querySelector('span').textContent = '⚠️ API未設定';
        elements.selectFolderBtn.disabled = true;
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

function handleTokenResponse(response) {
    if (response.error) {
        console.error('Token error:', response);
        
        // If folderSelectionMode, try with consent prompt
        if (state.folderSelectionMode) {
            console.log('Retrying with consent prompt for folder selection...');
            state.tokenClient.requestAccessToken({ prompt: 'consent' });
            return;
        }
        
        // If uploading, handle error
        if (state.pendingUploadRecording) {
            showToast('認証に失敗しました。ローカルに保存します。', 'error');
            downloadRecording(state.pendingUploadRecording);
            state.pendingUploadRecording = null;
            updateStatus('完了', false);
            clearPendingData();
        }
        return;
    }

    state.accessToken = response.access_token;
    console.log('Token received successfully');

    // Check what mode we're in
    if (state.folderSelectionMode) {
        // Folder selection mode - open picker
        state.folderSelectionMode = false;
        openFolderPicker();
    } else if (state.pendingUploadRecording) {
        // Upload mode - proceed with upload
        proceedWithUpload();
    }
}

async function proceedWithUpload() {
    if (!state.pendingUploadRecording) return;
    
    const recording = state.pendingUploadRecording;
    
    try {
        await uploadToDrive(recording);
        showToast('録音が完了しました ✅');
    } catch (err) {
        console.error('Upload failed:', err);
        showToast('アップロードに失敗しました。ローカルに保存します。', 'error');
        downloadRecording(recording);
    }
    
    state.pendingUploadRecording = null;
    updateStatus('完了', false);
    clearPendingData();
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
        
        // If there's a pending upload, proceed
        if (state.pendingUploadRecording) {
            proceedWithUpload();
        }
    } else if (data.action === google.picker.Action.CANCEL) {
        // User cancelled folder selection
        if (state.pendingUploadRecording) {
            showToast('フォルダ選択がキャンセルされました。ローカルに保存します。', 'warning');
            downloadRecording(state.pendingUploadRecording);
            state.pendingUploadRecording = null;
            updateStatus('完了', false);
            clearPendingData();
        }
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
        const extension = getFileExtension(recording.mimeType);
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
    const extension = getFileExtension(recording.mimeType);
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
    // 日本時間（JST = UTC+9）を使用
    const jstOffset = 9 * 60; // JST is UTC+9
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    const jstDate = new Date(utc + (jstOffset * 60000));
    
    const y = jstDate.getFullYear();
    const m = pad(jstDate.getMonth() + 1);
    const d = pad(jstDate.getDate());
    const h = pad(jstDate.getHours());
    const min = pad(jstDate.getMinutes());
    return `${y}${m}${d}_${h}${min}`;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileExtension(mimeType) {
    if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac')) return 'm4a';
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'm4a'; // Default to m4a for iOS
}
