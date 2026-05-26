const { ipcRenderer } = require('electron');

async function runDiagnostics() {
    const statusDiv = document.getElementById('hardware-status');
    
    // Call the backend function we set up in main.js
    const specs = await ipcRenderer.invoke('get-hardware-info');
    
    let message = `System Detected: <strong>${specs.totalRAM}GB RAM</strong> | <strong>${specs.cpuCores} Cores</strong><br><br>`;
    
    // The 8GB Constraint Logic
    if (specs.totalRAM < 7.5) {
        message += `<span style="color: #ff5555;">Warning: System memory is low. Please close background apps before going live to prevent frame drops.</span>`;
    } else {
        message += `<span style="color: #55ff55;">Hardware Check Passed. Ready for Broadcast.</span>`;
    }
    
    statusDiv.innerHTML = message;
}

runDiagnostics();

// --- Hardware Device Scanner ---
const cameraSelect = document.getElementById('camera-select');
const micSelect = document.getElementById('mic-select');
const rescanBtn = document.getElementById('rescan-btn');

async function getConnectedDevices() {
    try {
        // Clear current options
        cameraSelect.innerHTML = '';
        micSelect.innerHTML = '';

        // Request permission to read device labels (Electron needs this to see the real names)
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        
        // Fetch all devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const cameras = devices.filter(device => device.kind === 'videoinput');
        const mics = devices.filter(device => device.kind === 'audioinput');

        // Populate Cameras
        if (cameras.length === 0) {
            cameraSelect.innerHTML = '<option value="">No Camera Detected</option>';
        } else {
            cameras.forEach(camera => {
                const option = document.createElement('option');
                option.value = camera.deviceId;
                option.text = camera.label || `Camera ${cameraSelect.length + 1}`;
                cameraSelect.appendChild(option);
            });
        }

        // Populate Microphones
        if (mics.length === 0) {
            micSelect.innerHTML = '<option value="">No Microphone Detected</option>';
        } else {
            mics.forEach(mic => {
                // Filter out the "Default" and "Communications" duplicates Windows sometimes creates
                if (mic.deviceId !== 'default' && mic.deviceId !== 'communications') {
                    const option = document.createElement('option');
                    option.value = mic.deviceId;
                    option.text = mic.label || `Microphone ${micSelect.length + 1}`;
                    micSelect.appendChild(option);
                }
            });
        }
    } catch (error) {
        console.error('Error fetching devices:', error);
        cameraSelect.innerHTML = '<option value="">Error detecting cameras</option>';
        micSelect.innerHTML = '<option value="">Error detecting microphones</option>';
    }
}

// Hook up the Rescan Button
rescanBtn.addEventListener('click', () => {
    cameraSelect.innerHTML = '<option value="">Scanning...</option>';
    micSelect.innerHTML = '<option value="">Scanning...</option>';
    getConnectedDevices();
});

// Run scanner on startup
getConnectedDevices();

// --- Launch Stage Logic ---
const launchBtn = document.getElementById('launch-stage-btn');

// Check if both dropdowns have a valid selection
function checkInputs() {
    if (cameraSelect.value !== '' && micSelect.value !== '') {
        launchBtn.disabled = false;
    } else {
        launchBtn.disabled = true;
    }
}

// Listen for changes on the dropdowns
cameraSelect.addEventListener('change', checkInputs);
micSelect.addEventListener('change', checkInputs);

// When Launch is clicked, send the MASTER config to the backend
launchBtn.addEventListener('click', () => {
    // Fallback: If they haven't hit save yet, just grab the current hardware
    if (Object.keys(globalStreamConfig).length === 0) {
        globalStreamConfig.cameraId = cameraSelect.value;
        globalStreamConfig.micId = micSelect.value;
    }
    
    ipcRenderer.send('launch-main-stage', globalStreamConfig);
});

// --- Tab Navigation Logic ---
const navItems = document.querySelectorAll('.nav-links li');
const tabContents = document.querySelectorAll('.tab-content');

navItems.forEach(item => {
    item.addEventListener('click', () => {
        // 1. Remove active class from all nav items and tabs
        navItems.forEach(nav => nav.classList.remove('active'));
        tabContents.forEach(tab => tab.classList.remove('active-tab'));

        // 2. Add active class to the clicked nav item
        item.classList.add('active');

        // 3. Find the matching tab content and show it
        const targetId = item.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active-tab');
    });
});

// --- Scene 1: Countdown Controls ---
const countdownBgBtn = document.getElementById('countdown-bg-btn');
const countdownBgPath = document.getElementById('countdown-bg-path');
const countdownAudioType = document.getElementById('countdown-audio-type');
const countdownFolderGroup = document.getElementById('countdown-folder-group');
const countdownAudioBtn = document.getElementById('countdown-audio-btn');
const countdownAudioPath = document.getElementById('countdown-audio-path');

// 1. Browse for Background Media
countdownBgBtn.addEventListener('click', async () => {
    const filePath = await ipcRenderer.invoke('dialog:openFile');
    if (filePath) {
        countdownBgPath.value = filePath;
    }
});

// 2. Toggle Audio Input UI (Folder vs Line-In)
countdownAudioType.addEventListener('change', (e) => {
    if (e.target.value === 'folder') {
        countdownFolderGroup.style.display = 'block';
    } else {
        countdownFolderGroup.style.display = 'none';
        countdownAudioPath.value = ''; // Clear path if line-in is chosen
    }
});

// 3. Browse for Audio Folder
countdownAudioBtn.addEventListener('click', async () => {
    const folderPath = await ipcRenderer.invoke('dialog:openDirectory');
    if (folderPath) {
        countdownAudioPath.value = folderPath;
    }
});

// --- Scene 2: Live Host Controls ---
const hostAudioType = document.getElementById('host-audio-type');
const hostFolderGroup = document.getElementById('host-folder-group');
const hostAudioBtn = document.getElementById('host-audio-btn');
const hostAudioPath = document.getElementById('host-audio-path');

// 1. Toggle Audio Input UI (Folder vs Line-In)
hostAudioType.addEventListener('change', (e) => {
    if (e.target.value === 'folder') {
        hostFolderGroup.style.display = 'block';
    } else {
        hostFolderGroup.style.display = 'none';
        hostAudioPath.value = ''; // Clear path if line-in is chosen
    }
});

// 2. Browse for Audio Folder
hostAudioBtn.addEventListener('click', async () => {
    const folderPath = await ipcRenderer.invoke('dialog:openDirectory');
    if (folderPath) {
        hostAudioPath.value = folderPath;
    }
});

// --- Scene 3: Media Player Controls ---
const mediaBgBtn = document.getElementById('media-bg-btn');
const mediaBgPath = document.getElementById('media-bg-path');
const mediaAudioType = document.getElementById('media-audio-type');
const mediaFolderGroup = document.getElementById('media-folder-group');
const mediaAudioBtn = document.getElementById('media-audio-btn');
const mediaAudioPath = document.getElementById('media-audio-path');
const mediaManualGroup = document.getElementById('media-manual-group');

// 1. Browse for Background Media
mediaBgBtn.addEventListener('click', async () => {
    const filePath = await ipcRenderer.invoke('dialog:openFile');
    if (filePath) {
        mediaBgPath.value = filePath;
    }
});

// 2. Toggle Audio Input UI (Automated Folder vs Line-In)
mediaAudioType.addEventListener('change', (e) => {
    if (e.target.value === 'folder') {
        mediaFolderGroup.style.display = 'block';
        // Optional: you can hide manual entry when in folder mode, 
        // but keeping it visible allows for the "Initial Track Override" you requested in the blueprint!
    } else {
        mediaFolderGroup.style.display = 'none';
        mediaAudioPath.value = ''; // Clear path if line-in is chosen
    }
});

// 3. Browse for Audio Folder
mediaAudioBtn.addEventListener('click', async () => {
    const folderPath = await ipcRenderer.invoke('dialog:openDirectory');
    if (folderPath) {
        mediaAudioPath.value = folderPath;
    }
});
// --- Scene 4: Screen Share Controls ---
const screenSourceSelect = document.getElementById('screen-source');
const refreshScreensBtn = document.getElementById('refresh-screens-btn');

async function populateScreenSources() {
    screenSourceSelect.innerHTML = '<option value="">Loading sources...</option>';
    
    try {
        const sources = await ipcRenderer.invoke('get-screen-sources');
        screenSourceSelect.innerHTML = ''; // Clear loading text
        
        sources.forEach(source => {
            const option = document.createElement('option');
            option.value = source.id;
            // Add a little prefix to easily tell screens from windows
            option.text = source.id.startsWith('screen') ? `🖥️ Monitor: ${source.name}` : `🪟 Window: ${source.name}`;
            screenSourceSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error fetching screen sources:', error);
        screenSourceSelect.innerHTML = '<option value="">Error loading sources</option>';
    }
}

// Populate when the refresh button is clicked
refreshScreensBtn.addEventListener('click', populateScreenSources);

// Also populate them once on initial startup
populateScreenSources();

// --- Global State & Saving ---
const saveAllBtn = document.getElementById('save-all-btn');
let globalStreamConfig = {};

saveAllBtn.addEventListener('click', () => {
    // Collect every setting from across all tabs
    globalStreamConfig = {
        // Hardware
        cameraId: document.getElementById('camera-select').value,
        micId: document.getElementById('mic-select').value,
        vdoLink: document.getElementById('vdo-link').value,
        
        // Scene 1: Countdown
        countdownBg: document.getElementById('countdown-bg-path').value,
        countdownPos: document.getElementById('countdown-position').value,
        countdownText: document.getElementById('countdown-text').value,
        countdownFont: document.getElementById('countdown-font').value,
        countdownColor: document.getElementById('countdown-color').value,
        countdownAudioType: document.getElementById('countdown-audio-type').value,
        countdownAudioPath: document.getElementById('countdown-audio-path').value,

        // Scene 2: Live Host
        hostName: document.getElementById('host-name-input').value,
        showName: document.getElementById('show-name-input').value,
        hostTheme: document.getElementById('host-theme').value,
        hostAudioType: document.getElementById('host-audio-type').value,
        hostAudioPath: document.getElementById('host-audio-path').value,
        hostInitSong: document.getElementById('host-initial-song').value,
        hostInitArtist: document.getElementById('host-initial-artist').value,

        // Scene 3: Media Player
        mediaBg: document.getElementById('media-bg-path').value,
        mediaFont: document.getElementById('media-font').value,
        mediaTextColor: document.getElementById('media-text-color').value,
        mediaBarColor: document.getElementById('media-bar-color').value,
        mediaAudioType: document.getElementById('media-audio-type').value,
        mediaAudioPath: document.getElementById('media-audio-path').value,
        mediaInitSong: document.getElementById('media-initial-song').value,
        mediaInitArtist: document.getElementById('media-initial-artist').value,

        // Scene 4: Screen Share
        screenSource: document.getElementById('screen-source').value,

        // Output Profiles
        rtmpUrl: document.getElementById('rtmp-url').value,
        rtmpKey: document.getElementById('rtmp-key').value,
        icecastUrl: document.getElementById('icecast-url').value,
        icecastPort: document.getElementById('icecast-port').value,
        icecastMount: document.getElementById('icecast-mount').value,
        icecastPass: document.getElementById('icecast-pass').value
    };

    // Give visual feedback that it saved
    const originalText = saveAllBtn.innerHTML;
    saveAllBtn.innerHTML = "✅ Settings Saved!";
    saveAllBtn.style.backgroundColor = "#28a745";
    
    setTimeout(() => {
        saveAllBtn.innerHTML = originalText;
        saveAllBtn.style.backgroundColor = ""; // Resets to CSS default
    }, 2000);

    console.log("Master Configuration Saved:", globalStreamConfig);
});
