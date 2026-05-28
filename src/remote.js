const { ipcRenderer } = require('electron');

// ==========================================
// 1. INITIALIZATION & SETUP
// ==========================================
async function initializeRemote() {
    // Fetch the master configuration from the backend
    const config = await ipcRenderer.invoke('get-master-config');
    
    // Populate Camera Switcher
    const cameraSelect = document.getElementById('remote-camera-select');
    navigator.mediaDevices.enumerateDevices().then(devices => {
        const cameras = devices.filter(device => device.kind === 'videoinput');
        cameraSelect.innerHTML = '<option value="">-- Select Camera --</option>';
        cameras.forEach(cam => {
            const option = document.createElement('option');
            option.value = cam.deviceId;
            option.innerText = cam.label || `Camera ${cameraSelect.length}`;
            cameraSelect.appendChild(option);
        });
    });
}

initializeRemote();

// ==========================================
// 2. WINDOW CONTROLS (NEW)
// ==========================================
// Binds the new custom HTML buttons to the Electron window manager
document.getElementById('win-min')?.addEventListener('click', () => ipcRenderer.send('window-control', 'minimize'));
document.getElementById('win-max')?.addEventListener('click', () => ipcRenderer.send('window-control', 'maximize'));
document.getElementById('win-close')?.addEventListener('click', () => ipcRenderer.send('window-control', 'close'));

// ==========================================
// 3. MASTER WINDOW CONTROLS
// ==========================================
document.getElementById('open-config-btn').addEventListener('click', () => {
    ipcRenderer.send('show-config-window');
});

// ==========================================
// 4. SCENE SWITCHERS & SMART AUDIO LOGIC
// ==========================================
function switchScene(sceneId) {
    // 1. Visual Button State (Orange vs Grey)
    const buttons = ['countdown', 'host', 'media', 'screenshare'];
    buttons.forEach(id => {
        document.getElementById(`btn-scene-${id}`).className = (id === sceneId) 
            ? "primary-btn remote-btn" 
            : "secondary-btn remote-btn";
    });

    // 2. Tell the Canvas to visually change the scene
    ipcRenderer.send('switch-scene', sceneId);

    // 3. The Smart Auto-State Engine
    if (sceneId === 'countdown') setMicState(false);
    else if (sceneId === 'host') { setMicState(true); ipcRenderer.send('media-command', 'pause'); }
    else if (sceneId === 'media') setMicState(false);
    else if (sceneId === 'screenshare') { setMicState(true); ipcRenderer.send('media-command', 'pause'); }
}

document.getElementById('btn-scene-countdown').addEventListener('click', () => switchScene('countdown'));
document.getElementById('btn-scene-host').addEventListener('click', () => switchScene('host'));
document.getElementById('btn-scene-media').addEventListener('click', () => switchScene('media'));
document.getElementById('btn-scene-screenshare').addEventListener('click', () => switchScene('screenshare'));

// ==========================================
// 5. HARDWARE & AUDIO HUB
// ==========================================
// Camera Switcher
document.getElementById('remote-camera-switch').addEventListener('click', () => {
    const newCamId = document.getElementById('remote-camera-select').value;
    if (newCamId) ipcRenderer.send('send-live-update', { cameraId: newCamId });
});

// --- Centralized Mic Engine ---
let micIsOn = true;
const micBtn = document.getElementById('remote-mic-toggle');

function setMicState(forceState) {
    micIsOn = forceState;
    if (micIsOn) {
        micBtn.innerText = "🎙️ Mic: ON";
        micBtn.style.backgroundColor = "#00aa00";
    } else {
        micBtn.innerText = "🎙️ Mic: MUTED";
        micBtn.style.backgroundColor = "#cc0000";
    }
    // Send the command to the backend FFmpeg engine
    ipcRenderer.send('audio-command', { type: 'mic-toggle', state: micIsOn });
}

// Allow manual override by clicking the button
micBtn.addEventListener('click', () => {
    setMicState(!micIsOn); 
});

// --- Audio Knobs & Media Controls ---
// Monitor Toggle State
let monitorIsOn = false;
const monBtn = document.getElementById('remote-mic-monitor');
monBtn.addEventListener('click', () => {
    monitorIsOn = !monitorIsOn;
    monBtn.innerText = monitorIsOn ? "🎧 Monitor: ON" : "🎧 Monitor: OFF";
    monBtn.className = monitorIsOn ? "primary-btn remote-btn" : "secondary-btn remote-btn";
    ipcRenderer.send('audio-command', { type: 'monitor-toggle', state: monitorIsOn });
});

// Volume Sliders
document.getElementById('remote-mic-vol').addEventListener('input', (e) => {
    ipcRenderer.send('audio-command', { type: 'mic-volume', value: e.target.value });
});
document.getElementById('remote-music-vol').addEventListener('input', (e) => {
    ipcRenderer.send('audio-command', { type: 'music-volume', value: e.target.value });
});

// Media Playback
document.getElementById('media-btn-prev').addEventListener('click', () => ipcRenderer.send('media-command', 'prev'));
document.getElementById('media-btn-play').addEventListener('click', () => ipcRenderer.send('media-command', 'playpause'));
document.getElementById('media-btn-next').addEventListener('click', () => ipcRenderer.send('media-command', 'next'));

// ==========================================
// 6. METADATA & BANNER PUSHERS
// ==========================================
document.getElementById('remote-push-metadata').addEventListener('click', () => {
    const song = document.getElementById('remote-song-input').value;
    const artist = document.getElementById('remote-artist-input').value;
    // Pushes the text directly to the Canvas UI
    ipcRenderer.send('send-live-update', { mediaInitSong: song, mediaInitArtist: artist });
});

// Banner Image Picker
document.getElementById('remote-banner-img-btn').addEventListener('click', async () => {
    const filePath = await ipcRenderer.invoke('dialog:openFile');
    if (filePath) document.getElementById('remote-banner-img-path').value = filePath;
});

// Banner Toggle
document.getElementById('remote-banner-toggle').addEventListener('click', () => {
    const bannerText = document.getElementById('remote-banner-input').value;
    const bannerImg = document.getElementById('remote-banner-img-path').value;
    // Send BOTH the text and the image path to the Canvas
    ipcRenderer.send('toggle-banner', { text: bannerText, img: bannerImg });
});

// ==========================================
// 7. GLOBAL HOTKEYS
// ==========================================
window.addEventListener('keydown', (e) => {
    // Don't trigger hotkeys if the user is typing in a text box!
    if (document.activeElement.tagName === 'INPUT') return;

    switch(e.key) {
        case '1': switchScene('countdown'); break;
        case '2': switchScene('host'); break;
        case '3': switchScene('media'); break;
        case '4': switchScene('screenshare'); break;
        case ' ': 
            e.preventDefault(); // Stop spacebar from scrolling the page
            ipcRenderer.send('media-command', 'playpause'); 
            break;
        case 'ArrowLeft': ipcRenderer.send('media-command', 'prev'); break;
        case 'ArrowRight': ipcRenderer.send('media-command', 'next'); break;
    }
});

// ==========================================
// 8. MASTER GO LIVE ENGINE
// ==========================================
let isLive = false;
const goLiveBtn = document.getElementById('go-live-btn');

goLiveBtn.addEventListener('click', () => {
    isLive = !isLive;
    if (isLive) {
        goLiveBtn.classList.add('live');
        goLiveBtn.innerText = "⏹ STOP STREAMING";
        ipcRenderer.send('start-broadcast');
    } else {
        goLiveBtn.classList.remove('live');
        goLiveBtn.innerText = "🔴 GO LIVE";
        ipcRenderer.send('stop-broadcast');
    }
});