const { ipcRenderer } = require('electron');

// --- AUTO-FILL FOR DEMO ---
document.addEventListener('DOMContentLoaded', () => {
    // Inputs are cleared out for production packaging
    if(document.getElementById('countdown-bg-path')) document.getElementById('countdown-bg-path').value = '';
    if(document.getElementById('countdown-audio-path')) { 
        document.getElementById('countdown-audio-path').value = ''; 
        document.getElementById('countdown-audio-type').value = 'folder'; 
    }
    if(document.getElementById('host-audio-path')) { 
        document.getElementById('host-audio-path').value = '';
        document.getElementById('host-audio-type').value = 'folder'; 
    }
    if(document.getElementById('media-bg-path')) document.getElementById('media-bg-path').value = '';
    if(document.getElementById('media-audio-path')) document.getElementById('media-audio-path').value = '';
});

// ==========================================
// 0. WINDOW CONTROLS
// ==========================================
document.getElementById('min-btn')?.addEventListener('click', () => ipcRenderer.send('window-control', 'minimize'));
document.getElementById('close-btn')?.addEventListener('click', () => ipcRenderer.send('window-control', 'close'));

// ==========================================
// 1. HARDWARE & NETWORK DIAGNOSTICS
// ==========================================
const btnCheckPc = document.getElementById('check-pc-btn');
const statusDiv = document.getElementById('hardware-status');

btnCheckPc.addEventListener('click', async () => {
    statusDiv.innerHTML = '<span style="color: #ff5500;">Checking memory and CPU...</span>';
    const specs = await ipcRenderer.invoke('get-hardware-info');
    let message = `Detected: <strong>${specs.totalRAM}GB RAM</strong> | <strong>${specs.cpuCores} Cores</strong><br>`;
    
    if (specs.totalRAM < 7.5) {
        message += `<span style="color: #ff5555;">Warning: System memory is low. Close other apps before going live.</span>`;
    } else {
        message += `<span style="color: #55ff55;">✅ Your computer is ready to broadcast!</span>`;
    }
    statusDiv.innerHTML = message;
});

const btnCheckNet = document.getElementById('check-net-btn');
const netStatusDiv = document.getElementById('network-status');

btnCheckNet.addEventListener('click', async () => {
    netStatusDiv.innerHTML = '<span style="color: #ff5500;">Uploading 1MB test packet...</span>';
    
    // Cross the bridge to run your actual backend speed test
    const kbps = await ipcRenderer.invoke('run-speed-test');
    
    if (kbps > 3500) {
        netStatusDiv.innerHTML = `<span style="color: #55ff55;">✅ Excellent! (${Math.round(kbps)} kbps) - 720p HD Ready.</span>`;
    } else if (kbps > 1500) {
        netStatusDiv.innerHTML = `<span style="color: #ffff55;">⚠️ Congested (${Math.round(kbps)} kbps). Auto-adjusting buffer...</span>`;
    } else if (kbps > 0) {
        netStatusDiv.innerHTML = `<span style="color: #ffaa00;">⚠️ Slow (${Math.round(kbps)} kbps). Safe-mode activated.</span>`;
    } else {
        netStatusDiv.innerHTML = `<span style="color: #ff5555;">❌ Network test failed. Check your connection.</span>`;
    }
});

// --- Device Scanner (Runs in background for Step 2) ---
const cameraSelect = document.getElementById('camera-select');
const micSelect = document.getElementById('mic-select');
const rescanBtn = document.getElementById('rescan-btn');

async function getConnectedDevices() {
    try {
        // Save current selections to preserve them during re-binding
        const currentCamera = cameraSelect.value;
        const currentMic = micSelect.value;

        // Force browser to unlock device labels if they are hidden (silent request)
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => console.log("Silent permission request ignored"));

        // Force a fresh enumeration from the native browser API
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // Extract raw arrays
        const cameraList = devices.filter(d => d.kind === 'videoinput');
        const micList = devices.filter(d => d.kind === 'audioinput');

        // Clear out the old state entirely
        cameraSelect.innerHTML = '';
        micSelect.innerHTML = '';

        // 3. Populate the Camera Dropdown
        if (cameraList.length === 0) {
            cameraSelect.appendChild(new Option("No Cameras Found", ""));
        } else {
            cameraList.forEach((camera, index) => {
                const camOption = document.createElement('option');
                const label = camera.label || `Camera ${index + 1}`;
                camOption.textContent = label;
                camOption.value = label;
                cameraSelect.appendChild(camOption);
            });
            // Re-bind previous state if still available
            if (currentCamera && Array.from(cameraSelect.options).some(opt => opt.value === currentCamera)) {
                cameraSelect.value = currentCamera;
            }
        }

        // 4. Populate the Microphone Dropdown
        if (micList.length === 0) {
            micSelect.appendChild(new Option("No Mics Found", ""));
        } else {
            micList.forEach((mic, index) => {
                const micOption = document.createElement('option');
                const label = mic.label || `Mic ${index + 1}`;
                micOption.textContent = label;
                micOption.value = label;
                micSelect.appendChild(micOption);
            });
            // Re-bind previous state if still available
            if (currentMic && Array.from(micSelect.options).some(opt => opt.value === currentMic)) {
                micSelect.value = currentMic;
            }
        }
    } catch (error) {
        console.error('Error fetching devices:', error);
    }
}

rescanBtn.addEventListener('click', () => {
    cameraSelect.innerHTML = '<option value="">Scanning...</option>';
    micSelect.innerHTML = '<option value="">Scanning...</option>';
    getConnectedDevices();
});

// Initial scan
getConnectedDevices();

// Native Hot-Plug Listener (acts like useEffect)
navigator.mediaDevices.addEventListener('devicechange', getConnectedDevices);

// ==========================================
// 2. WIZARD NAVIGATION ENGINE
// ==========================================
let currentStep = 1;
const totalSteps = 7;
const btnNext = document.getElementById('btn-next');
const btnBack = document.getElementById('btn-back');
const btnDeploy = document.getElementById('btn-deploy');
const progressText = document.getElementById('wizard-progress');

const stepTitles = [
    "Welcome to Stream Suite",
    "Hardware & Inputs",
    "Pre-Show Countdown",
    "Live Host Settings",
    "Media Player Mode",
    "Screen Share Settings",
    "Stream Output Destinations"
];

function updateWizard() {
    document.querySelectorAll('.wizard-step').forEach(step => step.classList.remove('active-step'));
    document.getElementById(`step-${currentStep}`).classList.add('active-step');
    
    progressText.innerText = `Step ${currentStep} of ${totalSteps}: ${stepTitles[currentStep - 1]}`;

    btnBack.style.visibility = (currentStep === 1) ? 'hidden' : 'visible';
    
    if (currentStep === totalSteps) {
        btnNext.style.display = 'none';
        btnDeploy.style.display = 'block';
    } else {
        btnNext.style.display = 'block';
        btnDeploy.style.display = 'none';
    }
}

btnNext.addEventListener('click', () => {
    if (currentStep === 2) {
        if (cameraSelect.value === '' || micSelect.value === '') {
            alert("⚠️ Please select both a Primary Camera and a Primary Microphone from the dropdowns before continuing.");
            return;
        }
    }
    if (currentStep < totalSteps) {
        currentStep++;
        updateWizard();
    }
});

btnBack.addEventListener('click', () => {
    if (currentStep > 1) {
        currentStep--;
        updateWizard();
    }
});

// ==========================================
// 3. FILE BROWSER LOGIC & SCREEN REFRESH
// ==========================================
function setupFileBrowser(btnId, inputId, isDirectory = false) {
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.addEventListener('click', async () => {
            const path = await ipcRenderer.invoke(isDirectory ? 'dialog:openDirectory' : 'dialog:openFile');
            if (path) document.getElementById(inputId).value = path;
        });
    }
}

setupFileBrowser('countdown-bg-btn', 'countdown-bg-path');
setupFileBrowser('countdown-audio-btn', 'countdown-audio-path', true);
setupFileBrowser('host-audio-btn', 'host-audio-path', true);
setupFileBrowser('media-bg-btn', 'media-bg-path');
setupFileBrowser('media-audio-btn', 'media-audio-path', true);

// State variable to hold scanned inputs
let scannedAudioInputDevices = [];

['countdown', 'host', 'media'].forEach(scene => {
    const typeSelect = document.getElementById(`${scene}-audio-type`);
    const folderGroup = document.getElementById(`${scene}-folder-group`);
    const lineinGroup = document.getElementById(`${scene}-linein-group`);
    const lineinSelect = document.getElementById(`${scene}-linein-device`);

    if (typeSelect && folderGroup) {
        typeSelect.addEventListener('change', async (e) => {
            const isFolder = e.target.value === 'folder';
            const isLineIn = e.target.value === 'line-in';
            
            // Toggle visibility
            folderGroup.style.display = isFolder ? 'block' : 'none';
            if (lineinGroup) {
                lineinGroup.style.display = isLineIn ? 'block' : 'none';
            }

            if (!isFolder) document.getElementById(`${scene}-audio-path`).value = '';

            // Scan and render when Line-In is selected
            if (isLineIn && lineinSelect) {
                lineinSelect.innerHTML = '<option value="">Scanning...</option>';
                
                try {
                    const devices = await navigator.mediaDevices.enumerateDevices();
                    scannedAudioInputDevices = devices.filter(d => d.kind === 'audioinput');
                    
                    const currentValue = lineinSelect.value;
                    lineinSelect.innerHTML = '<option value="">-- Select Line-In Device --</option>';
                    
                    scannedAudioInputDevices.forEach((device, index) => {
                        const option = document.createElement('option');
                        const label = device.label || `Audio Input ${index + 1}`;
                        option.textContent = label;
                        option.value = label;
                        lineinSelect.appendChild(option);
                    });
                    
                    if (currentValue && Array.from(lineinSelect.options).some(opt => opt.value === currentValue)) {
                        lineinSelect.value = currentValue;
                    }
                } catch (err) {
                    console.error("Error scanning line-in devices:", err);
                    lineinSelect.innerHTML = '<option value="">Error scanning devices</option>';
                }
            }
        });
    }
});

const screenSourceSelect = document.getElementById('screen-source');
async function populateScreenSources() {
    screenSourceSelect.innerHTML = '<option value="">Loading sources...</option>';
    try {
        const sources = await ipcRenderer.invoke('get-desktop-sources');
        screenSourceSelect.innerHTML = ''; 
        sources.forEach(source => {
            const option = document.createElement('option');
            option.value = source.id;
            option.text = source.id.startsWith('screen') ? `🖥️ Monitor: ${source.name}` : `🪟 Window: ${source.name}`;
            screenSourceSelect.appendChild(option);
        });
    } catch (error) { screenSourceSelect.innerHTML = '<option value="">Error loading sources</option>'; }
}
document.getElementById('refresh-screens-btn').addEventListener('click', populateScreenSources);
populateScreenSources();

// ==========================================
// 4. PROFILE MANAGER ENGINE (NEW)
// ==========================================
const profileSelect = document.getElementById('profile-select');
const profileNameInput = document.getElementById('profile-name-input');
const btnSaveProfile = document.getElementById('btn-save-profile');
const btnDeleteProfile = document.getElementById('btn-delete-profile');

// Load saved profiles from LocalStorage on startup
function loadProfilesDropdown() {
    const profiles = JSON.parse(localStorage.getItem('streamSuiteProfiles')) || {};
    profileSelect.innerHTML = '<option value="">-- Load Saved Profile --</option>';
    Object.keys(profiles).forEach(name => {
        profileSelect.appendChild(new Option(name, name));
    });
}

btnSaveProfile.addEventListener('click', () => {
    let name = profileNameInput.value.trim();
    if (!name) { alert("Please enter a name for this profile."); return; }
    
    // Gather current inputs from Step 7
    const currentData = {
        rtmpUrl: document.getElementById('rtmp-url').value,
        rtmpKey: document.getElementById('rtmp-key').value,
        rtmpUrl2: document.getElementById('rtmp-url-2').value,
        rtmpKey2: document.getElementById('rtmp-key-2').value,
        icecastUrl: document.getElementById('icecast-url').value,
        icecastMount: document.getElementById('icecast-mount').value,
        icecastPass: document.getElementById('icecast-pass').value,
        restreamChatUrl: document.getElementById('restream-chat').value,
        embersChatUrl: document.getElementById('embers-chat').value
    };

    const profiles = JSON.parse(localStorage.getItem('streamSuiteProfiles')) || {};
    profiles[name] = currentData;
    localStorage.setItem('streamSuiteProfiles', JSON.stringify(profiles));
    
    loadProfilesDropdown();
    profileSelect.value = name;
    alert(`Profile '${name}' saved successfully!`);
});

profileSelect.addEventListener('change', (e) => {
    const selectedName = e.target.value;
    if (!selectedName) return;

    const profiles = JSON.parse(localStorage.getItem('streamSuiteProfiles')) || {};
    const data = profiles[selectedName];
    if (data) {
        document.getElementById('rtmp-url').value = data.rtmpUrl || '';
        document.getElementById('rtmp-key').value = data.rtmpKey || '';
        document.getElementById('rtmp-url-2').value = data.rtmpUrl2 || '';
        document.getElementById('rtmp-key-2').value = data.rtmpKey2 || '';
        document.getElementById('icecast-url').value = data.icecastUrl || '';
        document.getElementById('icecast-mount').value = data.icecastMount || '';
        document.getElementById('icecast-pass').value = data.icecastPass || '';
        document.getElementById('restream-chat').value = data.restreamChatUrl || '';
        document.getElementById('embers-chat').value = data.embersChatUrl || '';
        profileNameInput.value = selectedName;
    }
});

btnDeleteProfile.addEventListener('click', () => {
    const selectedName = profileSelect.value;
    if (!selectedName) { alert("Select a profile to delete."); return; }
    if (!confirm(`Are you sure you want to delete the profile '${selectedName}'?`)) return;

    const profiles = JSON.parse(localStorage.getItem('streamSuiteProfiles')) || {};
    delete profiles[selectedName];
    localStorage.setItem('streamSuiteProfiles', JSON.stringify(profiles));
    
    // Clear inputs
    document.getElementById('rtmp-url').value = '';
    document.getElementById('rtmp-key').value = '';
    document.getElementById('rtmp-url-2').value = '';
    document.getElementById('rtmp-key-2').value = '';
    document.getElementById('icecast-url').value = '';
    document.getElementById('icecast-mount').value = '';
    document.getElementById('icecast-pass').value = '';
    document.getElementById('restream-chat').value = '';
    document.getElementById('embers-chat').value = '';
    profileNameInput.value = '';
    
    loadProfilesDropdown();
});

// Initialize dropdown on load
loadProfilesDropdown();

// ==========================================
// 5. THE MASTER DEPLOYMENT ENGINE
// ==========================================
btnDeploy.addEventListener('click', () => {
    const micSelectElement = document.getElementById('mic-select');
    const selectedMicName = micSelectElement.options[micSelectElement.selectedIndex]?.text || 'Default';

    // Parse the Icecast port from the URL if provided (e.g. http://server.com:8000)
    const rawIcecastUrl = document.getElementById('icecast-url')?.value || '';
    let parsedIcecastUrl = rawIcecastUrl;
    let parsedIcecastPort = '80'; // Default
    
    if (rawIcecastUrl.includes(':') && !rawIcecastUrl.startsWith('http')) {
        const parts = rawIcecastUrl.split(':');
        parsedIcecastUrl = parts[0];
        parsedIcecastPort = parts[1].replace(/\D/g, ''); // Extract just the numbers
    } else if (rawIcecastUrl.startsWith('http')) {
        try {
            const urlObj = new URL(rawIcecastUrl);
            parsedIcecastUrl = urlObj.hostname;
            parsedIcecastPort = urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80');
        } catch(e) { console.error("Invalid URL format"); }
    }

    const globalStreamConfig = {
        cameraId: document.getElementById('camera-select')?.value || '',
        micId: micSelectElement?.value || '',
        micName: selectedMicName,
        micLabel: selectedMicName,
        vdoLink: document.getElementById('vdo-link')?.value || '',
        countdownBg: document.getElementById('countdown-bg-path')?.value || '',
        countdownPos: document.getElementById('countdown-position')?.value || '',
        countdownText: document.getElementById('countdown-text')?.value || '',
        countdownFont: document.getElementById('countdown-font')?.value || '',
        countdownColor: document.getElementById('countdown-color')?.value || '',
        countdownAudioType: document.getElementById('countdown-audio-type')?.value || '',
        countdownAudioPath: document.getElementById('countdown-audio-path')?.value || '',
        countdownLineInId: document.getElementById('countdown-linein-device')?.value || '',
        hostName: document.getElementById('host-name-input')?.value || '',
        showName: document.getElementById('show-name-input')?.value || '',
        hostTheme: document.getElementById('host-theme')?.value || '',
        hostAudioType: document.getElementById('host-audio-type')?.value || '',
        hostAudioPath: document.getElementById('host-audio-path')?.value || '',
        hostLineInId: document.getElementById('host-linein-device')?.value || '',
        hostInitSong: document.getElementById('host-initial-song')?.value || '',
        hostInitArtist: document.getElementById('host-initial-artist')?.value || '',
        mediaBg: document.getElementById('media-bg-path')?.value || '',
        mediaFont: document.getElementById('media-font')?.value || '',
        mediaTextColor: document.getElementById('media-text-color')?.value || '',
        mediaBarColor: document.getElementById('media-bar-color')?.value || '',
        mediaAudioType: document.getElementById('media-audio-type')?.value || '',
        mediaAudioPath: document.getElementById('media-audio-path')?.value || '',
        mediaLineInId: document.getElementById('media-linein-device')?.value || '',
        mediaInitSong: document.getElementById('media-initial-song')?.value || '',
        mediaInitArtist: document.getElementById('media-initial-artist')?.value || '',
        screenSource: document.getElementById('screen-source')?.value || '',
        rtmpUrl: document.getElementById('rtmp-url')?.value || '',
        rtmpKey: document.getElementById('rtmp-key')?.value || '',
        rtmpUrl2: document.getElementById('rtmp-url-2')?.value || '',
        rtmpKey2: document.getElementById('rtmp-key-2')?.value || '',
        icecastUrl: parsedIcecastUrl,
        icecastPort: parsedIcecastPort,
        icecastMount: document.getElementById('icecast-mount')?.value || '',
        icecastPass: document.getElementById('icecast-pass')?.value || '',
        restreamChatUrl: document.getElementById('restream-chat')?.value || '',
        embersChatUrl: document.getElementById('embers-chat')?.value || ''
    };

    ipcRenderer.send('launch-main-stage', globalStreamConfig);
});