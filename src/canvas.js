const { ipcRenderer } = require('electron');
const fs = require('fs');      
const path = require('path');  

// ==========================================
// MASTER AUDIO ENGINES
// ==========================================
const countdownAudio = new Audio();
countdownAudio.loop = true;

const hostAudio = new Audio();
hostAudio.loop = true;
// Initial volume set via blueprint constraint; controlled by slider later
hostAudio.volume = 0.01; 

const mediaAudio = new Audio();

let currentCountdownPath = "";
let currentHostPath = "";
let currentMediaPath = "";

// NEW: Store the current playlist state to enable next/prev skipping
let activePlaylist = {
    folderPath: "",
    files: [],
    currentIndex: 0
};

// Helper: Scans a folder and loads a specific index, or defaults to the first valid audio file
function loadAudioFromSource(audioPath, audioObj, playIndex = 0) {
    try {
        const stat = fs.statSync(audioPath);
        let fileToPlay = audioPath;

        if (stat.isDirectory()) {
            const files = fs.readdirSync(audioPath).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
            if (files.length > 0) {
                // Wrap around logic for next/prev
                let safeIndex = playIndex % files.length;
                if (safeIndex < 0) safeIndex = files.length - 1;

                fileToPlay = path.join(audioPath, files[safeIndex]);
                
                // Update the global tracker
                activePlaylist.folderPath = audioPath;
                activePlaylist.files = files;
                activePlaylist.currentIndex = safeIndex;
            } else {
                return null; // No audio found
            }
        }
        
        audioObj.src = `file://${fileToPlay.replace(/\\/g, '/')}`;
        audioObj.load();
        
        // Auto-play the new track if it was a skip command
        if (playIndex !== 0) audioObj.play();

        return fileToPlay; 
    } catch (err) {
        console.error("Error reading audio source:", err);
        return null;
    }
}

// ==========================================
// INITIALIZATION
// ==========================================
async function initializeCanvas() {
    const config = await ipcRenderer.invoke('get-master-config');
    console.log("Canvas fully loaded with settings:", config);

    document.getElementById('host-name-display').innerText = config.hostName || "Host Name";
    document.getElementById('show-name-display').innerText = config.showName || "Live Broadcast";

    applyCountdownSettings(config);
    applyHostSettings(config);
    applyMediaSettings(config);
    applyScreenShareSettings(config);
    applyBannerSettings(config);

    if (config.cameraId) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: config.cameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            document.getElementById('host-camera').srcObject = stream;
        } catch (error) {
            console.error("Failed to start camera:", error);
        }
    }
}

initializeCanvas();

// ==========================================
// REAL-TIME UPDATE LISTENER
// ==========================================
ipcRenderer.on('update-canvas-ui', async (event, data) => {
    // 1. Correct Text Overrides
    if (data.hostName) document.getElementById('host-name-display').innerText = data.hostName;
    if (data.showName) document.getElementById('show-name-display').innerText = data.showName;
    
    // 2. Manual Metadata Overrides (from the Remote)
    if (data.mediaInitSong) document.getElementById('media-song-title').innerText = data.mediaInitSong;
    if (data.mediaInitArtist) document.getElementById('media-artist-name').innerText = data.mediaInitArtist;
    
    // 3. Live Camera Hot-Swapping
    if (data.cameraId) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: data.cameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            document.getElementById('host-camera').srcObject = stream;
        } catch (error) { console.error("Camera swap failed:", error); }
    }

    // 4. Rebuild ALL Scenes 
    applyCountdownSettings(data);
    applyHostSettings(data); 
    applyMediaSettings(data); 
    applyScreenShareSettings(data);
    applyBannerSettings(data);
});

// ==========================================
// SCENE BUILDERS
// ==========================================

// --- Scene 1: Countdown ---
let countdownInterval;
function applyCountdownSettings(config) {
    if (config.countdownText) document.getElementById('countdown-header-text').innerText = config.countdownText;

    const contentDiv = document.getElementById('countdown-content');
    if (config.countdownFont) contentDiv.style.fontFamily = `"${config.countdownFont}", sans-serif`;
    if (config.countdownColor) contentDiv.style.color = config.countdownColor;

    if (config.countdownPos === 'top-center') {
        contentDiv.style.justifyContent = 'flex-start';
        contentDiv.style.paddingTop = '80px';
    } else if (config.countdownPos === 'bottom-center') {
        contentDiv.style.justifyContent = 'flex-end';
        contentDiv.style.paddingBottom = '80px';
    } else {
        contentDiv.style.justifyContent = 'center'; 
        contentDiv.style.padding = '0';
    }

    const bgContainer = document.getElementById('countdown-bg-container');
    if (config.countdownBg) {
        const fileExt = config.countdownBg.split('.').pop().toLowerCase();
        const fileUrl = `file://${config.countdownBg.replace(/\\/g, '/')}`; 
        if (['mp4', 'webm', 'mkv'].includes(fileExt)) {
            bgContainer.innerHTML = `<video src="${fileUrl}" autoplay loop muted style="width: 100%; height: 100%; object-fit: cover;"></video>`;
        } else {
            bgContainer.innerHTML = `<img src="${fileUrl}" style="width: 100%; height: 100%; object-fit: cover;">`;
        }
    }

    if (config.countdownAudioPath && config.countdownAudioPath !== currentCountdownPath) {
        currentCountdownPath = config.countdownAudioPath;
        loadAudioFromSource(currentCountdownPath, countdownAudio);
    }
}

function startTimer(durationInSeconds) {
    clearInterval(countdownInterval);
    let timer = durationInSeconds;
    const display = document.getElementById('countdown-timer');

    countdownInterval = setInterval(() => {
        let minutes = parseInt(timer / 60, 10);
        let seconds = parseInt(timer % 60, 10);
        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;
        display.innerText = minutes + ":" + seconds;

        if (--timer < 0) {
            clearInterval(countdownInterval);
            display.innerText = "00:00";
        }
    }, 1000);
}

// --- Scene 2: Live Host ---
function applyHostSettings(config) {
    const lowerThird = document.getElementById('host-lower-third');
    const frame = document.getElementById('host-frame'); 
    
    if (config.hostTheme) {
        lowerThird.classList.remove('theme-cyberpunk', 'theme-neon', 'theme-retro-arcade');
        frame.classList.remove('theme-cyberpunk', 'theme-neon', 'theme-retro-arcade');
        lowerThird.classList.add(`theme-${config.hostTheme}`);
        frame.classList.add(`theme-${config.hostTheme}`);
    }

    if (config.hostAudioPath && config.hostAudioPath !== currentHostPath) {
        currentHostPath = config.hostAudioPath;
        loadAudioFromSource(currentHostPath, hostAudio);
    }
}

// --- Scene 3: Media Player ---
function applyMediaSettings(config) {
    const songDisplay = document.getElementById('media-song-title');
    const artistDisplay = document.getElementById('media-artist-name');
    
    if (config.mediaFont) {
        songDisplay.style.fontFamily = `"${config.mediaFont}", sans-serif`;
        artistDisplay.style.fontFamily = `"${config.mediaFont}", sans-serif`;
    }
    if (config.mediaTextColor) songDisplay.style.color = config.mediaTextColor;

    const visContainer = document.getElementById('media-visualizer');
    if (visContainer && visContainer.children.length === 0) {
        for (let i = 0; i < 10; i++) {
            const bar = document.createElement('div');
            bar.className = 'eq-bar';
            visContainer.appendChild(bar);
        }
    }

    if (config.mediaBarColor) {
        document.querySelectorAll('.eq-bar').forEach(bar => {
            bar.style.backgroundColor = config.mediaBarColor;
            bar.style.boxShadow = `0 0 15px ${config.mediaBarColor}`; 
        });
    }

    const bgContainer = document.getElementById('media-bg-container');
    if (config.mediaBg) {
        const fileExt = config.mediaBg.split('.').pop().toLowerCase();
        const fileUrl = `file://${config.mediaBg.replace(/\\/g, '/')}`;
        if (['mp4', 'webm', 'mkv'].includes(fileExt)) {
            bgContainer.innerHTML = `<video src="${fileUrl}" autoplay loop muted style="width: 100%; height: 100%; object-fit: cover;"></video>`;
        } else {
            bgContainer.innerHTML = `<img src="${fileUrl}" style="width: 100%; height: 100%; object-fit: cover;">`;
        }
    }

    // REFACTORED: Load Scene 3 Audio using helper
    if (config.mediaAudioPath && config.mediaAudioPath !== currentMediaPath) {
        currentMediaPath = config.mediaAudioPath;
        const loadedFile = loadAudioFromSource(currentMediaPath, mediaAudio);

        if (loadedFile) {
            updateMediaMetadataDisplay(loadedFile);
        }
    } else if (!config.mediaAudioPath) {
        if (config.mediaInitSong) songDisplay.innerText = config.mediaInitSong;
        if (config.mediaInitArtist) artistDisplay.innerText = config.mediaInitArtist;
    }
}

// NEW: Helper to break down filename into display text
function updateMediaMetadataDisplay(filePath) {
    const songDisplay = document.getElementById('media-song-title');
    const artistDisplay = document.getElementById('media-artist-name');
    
    let fileNameWithExt = filePath.split('\\').pop().split('/').pop();
    let fileName = fileNameWithExt.substring(0, fileNameWithExt.lastIndexOf('.')) || fileNameWithExt;
    let parts = fileName.split('_');
    
    if (parts.length >= 3) {
        songDisplay.innerText = parts[1];
        artistDisplay.innerText = parts.slice(2).join('_'); 
    } else {
        songDisplay.innerText = fileName;
        artistDisplay.innerText = "Live Broadcast";
    }
}

// --- Scene 4: Screen Share ---
async function applyScreenShareSettings(config) {
    const videoElement = document.getElementById('screenshare-video');
    if (config.screenSource) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false, 
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: config.screenSource,
                        minWidth: 1280, maxWidth: 1280, minHeight: 720, maxHeight: 720
                    }
                }
            });
            videoElement.srcObject = stream;
        } catch (error) {
            console.error("Failed to capture screen:", error);
        }
    }
}

// --- Global Banner Aesthetics ---
function applyBannerSettings(config) {
    const container = document.getElementById('global-banner-container');
    const textElement = document.getElementById('global-banner-text');
    const logoWrapper = document.getElementById('banner-logo-wrapper');
    const logoImg = document.getElementById('banner-logo-img');

    if (config.bannerBgColor && config.bannerOpacity) {
        let hex = config.bannerBgColor.replace('#', '');
        let r = parseInt(hex.substring(0, 2), 16);
        let g = parseInt(hex.substring(2, 4), 16);
        let b = parseInt(hex.substring(4, 6), 16);
        container.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${config.bannerOpacity})`;
    }

    if (config.bannerFont) {
        textElement.style.fontFamily = `"${config.bannerFont}", sans-serif`;
    }

    if (config.bannerStyle === 'rounded') {
        container.style.borderRadius = '30px 30px 0 0';
        container.style.width = '96%';
        container.style.left = '2%'; 
    } else if (config.bannerStyle === 'angled') {
        container.style.clipPath = 'polygon(2% 0, 100% 0, 100% 100%, 0% 100%)';
        container.style.borderRadius = '0';
        container.style.width = '100%';
        container.style.left = '0';
    } else {
        container.style.borderRadius = '0';
        container.style.clipPath = 'none';
        container.style.width = '100%';
        container.style.left = '0';
    }

    if (config.bannerImgPath) {
        const fileUrl = `file://${config.bannerImgPath.replace(/\\/g, '/')}`;
        logoImg.src = fileUrl;
        logoWrapper.style.display = 'flex';
    } else {
        logoWrapper.style.display = 'none';
    }
}

// ==========================================
// SCENE SWITCHER & AUTO-STATE LOGIC
// ==========================================
ipcRenderer.on('change-active-scene', (event, sceneId) => {
    document.querySelectorAll('.scene').forEach(scene => scene.classList.remove('active'));
    
    const targetScene = document.getElementById(`scene-${sceneId}`);
    if (targetScene) targetScene.classList.add('active');

    countdownAudio.pause();
    hostAudio.pause();
    mediaAudio.pause();

    const overlayWrapper = document.getElementById('media-overlay-wrapper');
    if (overlayWrapper) {
        overlayWrapper.classList.remove('overlay-fade-in');
        overlayWrapper.classList.add('overlay-fade-out');
    }

    if (sceneId === 'countdown') {
        startTimer(600); // 10 minutes (600 seconds)
        if (countdownAudio.src) countdownAudio.play().catch(e => console.log(e));
    } 
    else if (sceneId === 'host') {
        if (hostAudio.src) hostAudio.play().catch(e => console.log(e));
    } 
    else if (sceneId === 'media') {
        if (mediaAudio.src) mediaAudio.play().catch(e => console.log(e));
        if (overlayWrapper) {
            overlayWrapper.classList.remove('overlay-fade-out');
            overlayWrapper.classList.add('overlay-fade-in');
        }
    }
});

// ==========================================
// REMOTE PLAYBACK LISTENER (FIXED)
// ==========================================
ipcRenderer.on('media-command', (event, command) => {
    let activePlayer = null;
    let activePath = "";
    
    if (document.getElementById('scene-countdown').classList.contains('active')) {
        activePlayer = countdownAudio;
        activePath = currentCountdownPath;
    }
    if (document.getElementById('scene-host').classList.contains('active')) {
        activePlayer = hostAudio;
        activePath = currentHostPath;
    }
    if (document.getElementById('scene-media').classList.contains('active')) {
        activePlayer = mediaAudio;
        activePath = currentMediaPath;
    }

    if (!activePlayer) return;

    if (command === 'playpause') {
        if (activePlayer.paused) activePlayer.play();
        else activePlayer.pause();
    } else if (command === 'pause') {
        activePlayer.pause();
    } else if (command === 'next') {
        const nextFile = loadAudioFromSource(activePath, activePlayer, activePlaylist.currentIndex + 1);
        if (nextFile && activePlayer === mediaAudio) updateMediaMetadataDisplay(nextFile);
    } else if (command === 'prev') {
        const prevFile = loadAudioFromSource(activePath, activePlayer, activePlaylist.currentIndex - 1);
        if (prevFile && activePlayer === mediaAudio) updateMediaMetadataDisplay(prevFile);
    }
});

// ==========================================
// MASTER VOLUME LISTENER (FIXED)
// ==========================================
ipcRenderer.on('audio-command', (event, command) => {
    if (command.type === 'music-volume') {
        let masterVol = parseFloat(command.value) / 100; 
        
        countdownAudio.volume = masterVol;
        mediaAudio.volume = masterVol;
        
        // Ensure host background track respects the max volume cap
        let scaledHostVol = masterVol * 0.30;
        if (scaledHostVol > 1.0) scaledHostVol = 1.0;
        hostAudio.volume = scaledHostVol; 
    }
});

// ==========================================
// THE UNIVERSAL SLIDING BANNER
// ==========================================
let bannerIsVisible = false;

ipcRenderer.on('toggle-banner', (event, bannerData) => {
    const bannerContainer = document.getElementById('global-banner-container');
    const textElement = document.getElementById('global-banner-text');
    const logoWrapper = document.getElementById('banner-logo-wrapper');
    const logoImg = document.getElementById('banner-logo-img');

    bannerIsVisible = !bannerIsVisible;

    if (bannerIsVisible) {
        if (bannerData.text.trim() !== "") textElement.innerText = bannerData.text;
        
        if (bannerData.img) {
            logoImg.src = `file://${bannerData.img.replace(/\\/g, '/')}`;
            logoWrapper.style.display = 'flex';
        }
        bannerContainer.classList.add('banner-visible');
    } else {
        bannerContainer.classList.remove('banner-visible');
    }
});

// Auto-play the next track when current one ends
mediaAudio.addEventListener('ended', () => {
    const nextFile = loadAudioFromSource(currentMediaPath, mediaAudio, activePlaylist.currentIndex + 1);
    if (nextFile) updateMediaMetadataDisplay(nextFile);
});
countdownAudio.addEventListener('ended', () => loadAudioFromSource(currentCountdownPath, countdownAudio, activePlaylist.currentIndex + 1));
hostAudio.addEventListener('ended', () => loadAudioFromSource(currentHostPath, hostAudio, activePlaylist.currentIndex + 1));