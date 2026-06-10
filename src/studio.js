const { ipcRenderer } = require('electron');
const fs = require('fs');      
const path = require('path');  

async function getWebRTCDeviceId(friendlyName, deviceKind) {
    if (!friendlyName) return undefined;
    try {
        // Trigger a silent request to force Chrome to unlock device labels
        await navigator.mediaDevices.getUserMedia({ [deviceKind === 'audioinput' ? 'audio' : 'video']: true }).catch(()=>console.log("Silent permission request ignored"));
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const matchingDevices = devices.filter(d => d.kind === deviceKind);
        
        // Fuzzy match the Windows name against the Chrome label
        for (let d of matchingDevices) {
            if (d.label.includes(friendlyName) || friendlyName.includes(d.label)) {
                console.log(`✅ Translated '${friendlyName}' to WebRTC ID: ${d.deviceId.substring(0,8)}...`);
                return d.deviceId;
            }
        }
    } catch (err) { console.error("Device translation failed:", err); }
    
    console.warn(`⚠️ Could not find exact WebRTC ID for ${friendlyName}. Falling back to default.`);
    return undefined; // If undefined, getUserMedia will just grab the default device safely
}

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
const mediaVideo = document.getElementById('media-video-player');

// Web Audio API Visualizer Setup
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx, analyser, source;
let appAudioRecorder = null;
let internalMixerNode = null;
let digitalMicPreamp = null;
let micAnalyser = null;
let bgmPreamp = null;
let globalMicTrack = null;
let streamAnalyser = null;
let visualizerDataArray = null;
let currentVisualizerColor = '#ff5500'; // Default fallback

// --- NEW LINE-IN GRAPH STATE ---
let currentLineInStream = null;
let currentLineInSourceNode = null;
let currentLineInId = null;
let currentStudioConfig = {};

mediaAudio.crossOrigin = "anonymous";
mediaAudio.addEventListener('play', () => {
    if (!audioCtx) {
        audioCtx = new AudioContext();
        internalMixerNode = audioCtx.createMediaStreamDestination();
        if (!streamAnalyser) {
            streamAnalyser = audioCtx.createAnalyser();
            streamAnalyser.fftSize = 256; 
            const visualizerTap = audioCtx.createMediaStreamSource(internalMixerNode.stream);
            visualizerTap.connect(streamAnalyser);
            visualizerDataArray = new Uint8Array(streamAnalyser.frequencyBinCount);
            
            // Expose globally for React Visualizer
            window.streamAnalyser = streamAnalyser;
            window.visualizerDataArray = visualizerDataArray;
        }
        startAudioPipeEncoder();
    }
    if (!analyser) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source = audioCtx.createMediaElementSource(mediaAudio);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        if (!bgmPreamp) {
            bgmPreamp = audioCtx.createGain();
            bgmPreamp.gain.value = 1.2; // Default is "just a hair" louder than standard 1.0
            bgmPreamp.connect(internalMixerNode);
        }
        analyser.connect(bgmPreamp);
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
});

// 2D Visualizer logic removed. Handled by React 3D component.

let currentCountdownPath = "";
let currentHostPath = "";
let currentMediaPath = "";

// NEW: Store the current playlist state to enable next/prev skipping
let activePlaylist = {
    folderPath: "",
    files: [],
    currentIndex: 0
};

// Helper: Scans a folder and loads a specific index, or defaults to the first valid media file
function loadMediaFromSource(audioPath, audioObj, playIndex = 0) {
    try {
        const stat = fs.statSync(audioPath);
        let fileToPlay = audioPath;

        if (stat.isDirectory()) {
            const files = fs.readdirSync(audioPath).filter(f => {
                const ext = f.toLowerCase();
                return ext.endsWith('.mp3') || ext.endsWith('.wav') || ext.endsWith('.m4a') || 
                       ext.endsWith('.mp4') || ext.endsWith('.webm') || ext.endsWith('.mkv') || ext.endsWith('.mov');
            });
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
                return null; // No media found
            }
        }
        
        if (audioObj === mediaAudio) {
            const ext = fileToPlay.toLowerCase();
            const isVideo = ext.endsWith('.mp4') || ext.endsWith('.webm') || ext.endsWith('.mkv') || ext.endsWith('.mov');
            
            if (isVideo) {
                mediaVideo.src = `file:///${fileToPlay.replace(/\\/g, '/')}`;
                mediaVideo.load();
                if (document.getElementById('media-metadata-container')) document.getElementById('media-metadata-container').style.display = 'none';
                let canvasEl = document.getElementById('react-visualizer-root');
                if (canvasEl) canvasEl.style.display = 'none';
                mediaVideo.style.display = 'block';
                mediaAudio.pause();
                if (playIndex !== 0) mediaVideo.play();
            } else {
                mediaAudio.src = `file:///${fileToPlay.replace(/\\/g, '/')}`;
                mediaAudio.load();
                if (document.getElementById('media-metadata-container')) document.getElementById('media-metadata-container').style.display = 'flex';
                let canvasEl = document.getElementById('react-visualizer-root');
                if (canvasEl) canvasEl.style.display = 'block';
                mediaVideo.style.display = 'none';
                mediaVideo.pause();
                if (playIndex !== 0) mediaAudio.play();
            }
        } else {
            audioObj.src = `file:///${fileToPlay.replace(/\\/g, '/')}`;
            audioObj.load();
            if (playIndex !== 0) audioObj.play();
        }

        return fileToPlay; 
    } catch (err) {
        console.error("Error reading media source:", err);
        return null;
    }
}

// ==========================================
// ZERO-DEPENDENCY IPC AUDIO ROUTING
// ==========================================

async function startLineInRouting(deviceId) {
    if (!deviceId) return;
    try {
        const realId = await getWebRTCDeviceId(deviceId, 'audioinput');
        const constraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        if (realId) constraints.deviceId = { exact: realId };
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
        
        // Cleanup existing line-in stream if any
        if (currentLineInStream) {
            currentLineInStream.getTracks().forEach(t => t.stop());
        }
        if (currentLineInSourceNode) {
            currentLineInSourceNode.disconnect();
        }
        
        if (!audioCtx) {
            audioCtx = new AudioContext();
            internalMixerNode = audioCtx.createMediaStreamDestination();
            if (!streamAnalyser) {
                streamAnalyser = audioCtx.createAnalyser();
                streamAnalyser.fftSize = 256; 
                const visualizerTap = audioCtx.createMediaStreamSource(internalMixerNode.stream);
                visualizerTap.connect(streamAnalyser);
                visualizerDataArray = new Uint8Array(streamAnalyser.frequencyBinCount);
                window.streamAnalyser = streamAnalyser;
                window.visualizerDataArray = visualizerDataArray;
            }
            startAudioPipeEncoder();
        }
        
        if (!analyser) {
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.connect(audioCtx.destination);
            if (!bgmPreamp) {
                bgmPreamp = audioCtx.createGain();
                bgmPreamp.gain.value = 1.2;
                bgmPreamp.connect(internalMixerNode);
            }
            analyser.connect(bgmPreamp);
        }
        
        if (audioCtx.state === 'suspended') audioCtx.resume();

        currentLineInStream = stream;
        currentLineInSourceNode = audioCtx.createMediaStreamSource(stream);
        
        // Connect directly into the broadcast engine and visualizer
        currentLineInSourceNode.connect(analyser);
        
        console.log("🔌 Line-In Hardware Audio successfully routed to Stream Mixer and Visualizer!");
    } catch(err) {
        console.error("Line-In routing failed:", err);
    }
}

async function startMicRouting(micDeviceId) {
    if (!micDeviceId) return;
    try {
        const realMicId = await getWebRTCDeviceId(micDeviceId, 'audioinput');
        const audioConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        if (realMicId) audioConstraints.deviceId = { exact: realMicId };

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        
        if (!audioCtx) {
            audioCtx = new AudioContext();
            internalMixerNode = audioCtx.createMediaStreamDestination();
            if (!streamAnalyser) {
                streamAnalyser = audioCtx.createAnalyser();
                streamAnalyser.fftSize = 256; 
                const visualizerTap = audioCtx.createMediaStreamSource(internalMixerNode.stream);
                visualizerTap.connect(streamAnalyser);
                visualizerDataArray = new Uint8Array(streamAnalyser.frequencyBinCount);
                
                // Expose globally for React Visualizer
                window.streamAnalyser = streamAnalyser;
                window.visualizerDataArray = visualizerDataArray;
            }
            startAudioPipeEncoder();
        }

        // Route Mic into the internal mixer
        if (!digitalMicPreamp) {
            digitalMicPreamp = audioCtx.createGain();
            // Boost the raw clean signal by 250%
            digitalMicPreamp.gain.value = 2.5; 
            
            // Connect the pre-amp output to the main broadcast mixer
            digitalMicPreamp.connect(internalMixerNode);

            if (!micAnalyser && audioCtx) {
                micAnalyser = audioCtx.createAnalyser();
                micAnalyser.fftSize = 64;
                digitalMicPreamp.connect(micAnalyser);
                drawMicMeter();
            }
        }

        // Connect the physical mic source to the pre-amp INSTEAD of directly to the mixer
        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(digitalMicPreamp);
        globalMicTrack = micStream.getAudioTracks()[0];
        
        console.log("🎛️ Digital Mic Pre-Amp engaged at 250% volume!");
    } catch (err) { console.error("Mic routing failed:", err); }
}

function drawMicMeter() {
    requestAnimationFrame(drawMicMeter);
    if (!micAnalyser) return;
    let data = new Uint8Array(micAnalyser.frequencyBinCount);
    micAnalyser.getByteFrequencyData(data);
    let avg = data.reduce((a, b) => a + b, 0) / data.length;
    let canvas = document.getElementById('mic-meter');
    if (!canvas) return;
    let ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = avg > 180 ? '#ff0000' : (avg > 120 ? '#ffff00' : '#00ff00');
    ctx.fillRect(0, 0, (avg / 255) * canvas.width, canvas.height);
}

function startAudioPipeEncoder() {
    if (appAudioRecorder) return;
    appAudioRecorder = new MediaRecorder(internalMixerNode.stream, { mimeType: 'audio/webm;codecs=opus' });
    appAudioRecorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
            const buffer = await e.data.arrayBuffer();
            ipcRenderer.send('audio-stream-chunk', buffer);
        }
    };
    console.log("🚀 Zero-Dependency Audio Pipe Init! Waiting for backend sync...");
}

ipcRenderer.on('start-internal-recording', () => {
    // Ensure the recorder is built
    console.log("🚨 TRIPWIRE: BACKEND YELLED 'START'! ATTEMPTING TO RECORD...");
    
    if (!appAudioRecorder && internalMixerNode) {
        appAudioRecorder = new MediaRecorder(internalMixerNode.stream, { mimeType: 'audio/webm;codecs=opus' });
        appAudioRecorder.ondataavailable = async (e) => {
            if (e.data.size > 0) {
                const buffer = await e.data.arrayBuffer();
                ipcRenderer.send('audio-stream-chunk', buffer);
            }
        };
    }

    
    // Start the recorder, generating a fresh WebM header for FFmpeg!
    if (appAudioRecorder && appAudioRecorder.state === 'inactive') {
        appAudioRecorder.start(100);
        console.log("⏺️ Audio Pipe Recording Started (Header synchronized!)");
    }
});

ipcRenderer.on('stop-internal-recording', () => {
    if (appAudioRecorder && appAudioRecorder.state !== 'inactive') {
        appAudioRecorder.stop();
        console.log("⏹️ Audio Pipe Recording Stopped.");
    }
});
// ==========================================
// INITIALIZATION (Canvas)
// ==========================================
async function initializeCanvas() {
    const config = await ipcRenderer.invoke('get-master-config');
    currentStudioConfig = config;
    console.log("Canvas fully loaded with settings:", config);

    document.getElementById('host-name-display').innerText = config.hostName || "Host Name";
    document.getElementById('show-name-display').innerText = config.showName || "Live Broadcast";

    // Route the mic based on config
    await startMicRouting(config.micId);

    applyCountdownSettings(config);
    applyHostSettings(config);
    applyMediaSettings(config);
    applyScreenShareSettings(config);
    applyBannerSettings(config);

    if (config.cameraId) {
        try {
            const realCameraId = await getWebRTCDeviceId(config.cameraId, 'videoinput');
            const videoConstraints = realCameraId ? { deviceId: { exact: realCameraId }, width: { ideal: 960 }, height: { ideal: 540 } } : { width: { ideal: 960 }, height: { ideal: 540 } };

            const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
            document.getElementById('host-camera').srcObject = stream;
        } catch (error) {
            console.error("Failed to start camera:", error);
        }
    }
    
    // Trigger the initial scene state
    setTimeout(() => {
        ipcRenderer.emit('change-active-scene', null, 'host');
    }, 500);
}

initializeCanvas();

// ==========================================
// REAL-TIME UPDATE LISTENER
// ==========================================
ipcRenderer.on('update-canvas-ui', async (event, data) => {
    currentStudioConfig = { ...currentStudioConfig, ...data };
    
    // 1. Correct Text Overrides
    if (data.hostName) document.getElementById('host-name-display').innerText = data.hostName;
    if (data.showName) document.getElementById('show-name-display').innerText = data.showName;
    
    // 2. Manual Metadata Overrides (from the Remote)
    if (data.mediaInitSong) document.getElementById('media-song-title').innerText = data.mediaInitSong;
    if (data.mediaInitArtist) document.getElementById('media-artist-name').innerText = data.mediaInitArtist;
    
    // 3. Live Camera Hot-Swapping
    if (data.cameraId) {
        try {
            const realCameraId = await getWebRTCDeviceId(data.cameraId, 'videoinput');
            const videoConstraints = realCameraId ? { deviceId: { exact: realCameraId }, width: { ideal: 960 }, height: { ideal: 540 } } : { width: { ideal: 960 }, height: { ideal: 540 } };

            const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
            document.getElementById('host-camera').srcObject = stream;
        } catch (error) { console.error("Camera swap failed:", error); }
    }

    // 3.5 Live Mic Hot-Swapping into Internal Mixer
    if (data.micId) {
        await startMicRouting(data.micId);
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
        const fileUrl = `file:///${config.countdownBg.replace(/\\/g, '/')}`; 
        if (['mp4', 'webm', 'mkv'].includes(fileExt)) {
            bgContainer.innerHTML = `<video src="${fileUrl}" autoplay loop muted style="width: 100%; height: 100%; object-fit: cover;"></video>`;
        } else {
            bgContainer.innerHTML = `<img src="${fileUrl}" style="width: 100%; height: 100%; object-fit: cover;">`;
        }
    }

    if (config.countdownAudioType === 'line-in') {
        if (config.countdownLineInId && config.countdownLineInId !== currentLineInId) {
            currentLineInId = config.countdownLineInId;
            startLineInRouting(currentLineInId);
        }
    } else if (config.countdownAudioPath && config.countdownAudioPath !== currentCountdownPath) {
        currentCountdownPath = config.countdownAudioPath;
        loadMediaFromSource(currentCountdownPath, countdownAudio);
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

    if (config.hostAudioType === 'line-in') {
        if (config.hostLineInId && config.hostLineInId !== currentLineInId) {
            currentLineInId = config.hostLineInId;
            startLineInRouting(currentLineInId);
        }
    } else if (config.hostAudioPath && config.hostAudioPath !== currentHostPath) {
        currentHostPath = config.hostAudioPath;
        loadMediaFromSource(currentHostPath, hostAudio);
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
    if (config.mediaTextColor) {
        songDisplay.style.color = config.mediaTextColor;
        artistDisplay.style.color = config.mediaTextColor;
    }

    if (config.mediaBarColor) {
        currentVisualizerColor = config.mediaBarColor;
    }

    const bgContainer = document.getElementById('media-bg-container');
    if (config.mediaBg) {
        const fileExt = config.mediaBg.split('.').pop().toLowerCase();
        const fileUrl = `file:///${config.mediaBg.replace(/\\/g, '/')}`;
        if (['mp4', 'webm', 'mkv'].includes(fileExt)) {
            bgContainer.innerHTML = `<video src="${fileUrl}" autoplay loop muted style="width: 100%; height: 100%; object-fit: cover;"></video>`;
        } else {
            bgContainer.innerHTML = `<img src="${fileUrl}" style="width: 100%; height: 100%; object-fit: cover;">`;
        }
    }

    // REFACTORED: Load Scene 3 Audio using helper
    if (config.mediaAudioType === 'line-in') {
        if (config.mediaLineInId && config.mediaLineInId !== currentLineInId) {
            currentLineInId = config.mediaLineInId;
            startLineInRouting(currentLineInId);
        }
        if (config.mediaInitSong) songDisplay.innerText = config.mediaInitSong;
        if (config.mediaInitArtist) artistDisplay.innerText = config.mediaInitArtist;
    } else if (config.mediaAudioPath && config.mediaAudioPath !== currentMediaPath) {
        currentMediaPath = config.mediaAudioPath;
        const loadedFile = loadMediaFromSource(currentMediaPath, mediaAudio);

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
    
    fileName = fileName.replace(/^\d+[\s\-_]+/, '');
    let parts = fileName.split(/_|-/);
    
    if (parts.length >= 2) {
        songDisplay.innerText = parts[0].trim();
        artistDisplay.innerText = parts.slice(1).join(' ').trim(); 
    } else {
        songDisplay.innerText = fileName.trim();
        artistDisplay.innerText = "Live Broadcast";
    }
}

// --- Scene 4: Screen Share ---
async function applyScreenShareSettings(config) {
    const screenShareVideoEl = document.getElementById('screenshare-video');
    if (!config.screenSource) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: config.screenSource,
                    minWidth: 1280,
                    maxWidth: 1920,
                    minHeight: 720,
                    maxHeight: 1080
                }
            }
        });
        
        // Apply the stream to the screen share video element
        if (screenShareVideoEl) {
            screenShareVideoEl.srcObject = stream;
        }
        
        console.log("🖥️ Screen Share successfully captured!");
    } catch (err) {
        console.warn(`⚠️ Non-Fatal: Screen share capture timed out or failed for ID '${config.screenSource}'. The source may have been closed.`, err);
        // Do NOT re-throw the error. Let the function return gracefully so the rest of the canvas loads.
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
        const fileUrl = `file:///${config.bannerImgPath.replace(/\\/g, '/')}`;
        logoImg.src = fileUrl;
        logoWrapper.style.display = 'flex';
    } else {
        logoWrapper.style.display = 'none';
    }
}

// ==========================================
// SCENE SWITCHER & AUTO-STATE LOGIC
// ==========================================

function routeBackgroundAudio(theAudioElement) {
    if (audioCtx && internalMixerNode && theAudioElement) {
        if (!theAudioElement.dataset.routed) {
            theAudioElement.crossOrigin = "anonymous";
            const source = audioCtx.createMediaElementSource(theAudioElement);
            if (!bgmPreamp) {
                bgmPreamp = audioCtx.createGain();
                bgmPreamp.gain.value = 1.2; // Default is "just a hair" louder than standard 1.0
                bgmPreamp.connect(internalMixerNode);
            }
            source.connect(bgmPreamp); // Send to stream
            source.connect(audioCtx.destination); // Send to local speakers
            theAudioElement.dataset.routed = "true";
            console.log("🔌 Background Audio successfully routed to Stream Mixer!");
        }
    }
}

ipcRenderer.on('change-active-scene', (event, sceneId) => {
    document.querySelectorAll('.broadcast-scene').forEach(scene => scene.classList.remove('scene-active'));
    
    const targetScene = document.getElementById(`scene-${sceneId}`);
    if (targetScene) targetScene.classList.add('scene-active');

    countdownAudio.pause();
    hostAudio.pause();
    mediaAudio.pause();
    if (mediaVideo) mediaVideo.pause();

    if (globalMicTrack) {
        if (sceneId.includes('countdown') || sceneId.includes('media')) {
            globalMicTrack.enabled = false;
            console.log("🔇 Mic digitally MUTED for scene:", sceneId);
        } else {
            globalMicTrack.enabled = true;
            console.log("🎙️ Mic LIVE for scene:", sceneId);
        }
    }

    if (sceneId === 'countdown') {
        startTimer(600); // 10 minutes (600 seconds)
        if (countdownAudio.src) {
            routeBackgroundAudio(countdownAudio);
            countdownAudio.play().catch(e => console.log(e));
        }
    } 
    else if (sceneId === 'host') {
        if (hostAudio.src) {
            routeBackgroundAudio(hostAudio);
            hostAudio.play().catch(e => console.log(e));
        }
    } 
    else if (sceneId === 'media') {
        if (mediaVideo && mediaVideo.style.display === 'block') {
            if (mediaVideo.src) mediaVideo.play().catch(e => console.log(e));
        } else {
            if (mediaAudio.src) mediaAudio.play().catch(e => console.log(e));
        }
    }

    // Toggle Line-In Muting
    if (currentLineInStream) {
        const audioTrack = currentLineInStream.getAudioTracks()[0];
        if (audioTrack) {
            if (sceneId === 'countdown' && currentStudioConfig.countdownAudioType === 'line-in') {
                audioTrack.enabled = true;
            } else if (sceneId === 'host' && currentStudioConfig.hostAudioType === 'line-in') {
                audioTrack.enabled = true;
            } else if (sceneId === 'media' && currentStudioConfig.mediaAudioType === 'line-in') {
                audioTrack.enabled = true;
            } else {
                audioTrack.enabled = false;
            }
        }
    }
});

// ==========================================
// REMOTE PLAYBACK LISTENER (FIXED)
// ==========================================
ipcRenderer.on('media-command', (event, command) => {
    let activePlayer = null;
    let activePath = "";
    
    if (document.getElementById('scene-countdown').classList.contains('scene-active')) {
        activePlayer = countdownAudio;
        activePath = currentCountdownPath;
    }
    if (document.getElementById('scene-host').classList.contains('scene-active')) {
        activePlayer = hostAudio;
        activePath = currentHostPath;
    }
    if (document.getElementById('scene-media').classList.contains('scene-active')) {
        activePlayer = (mediaVideo && mediaVideo.style.display === 'block') ? mediaVideo : mediaAudio;
        activePath = currentMediaPath;
    }

    if (!activePlayer && !currentLineInStream) return;

    if (command === 'playpause') {
        if (currentLineInStream && currentStudioConfig[`${document.querySelector('.scene-active').id.replace('scene-','') }AudioType`] === 'line-in') {
            const track = currentLineInStream.getAudioTracks()[0];
            if (track) track.enabled = !track.enabled;
        } else if (activePlayer) {
            if (activePlayer.paused) activePlayer.play();
            else activePlayer.pause();
        }
    } else if (command === 'pause') {
        if (currentLineInStream && currentStudioConfig[`${document.querySelector('.scene-active').id.replace('scene-','') }AudioType`] === 'line-in') {
            const track = currentLineInStream.getAudioTracks()[0];
            if (track) track.enabled = false;
        } else if (activePlayer) {
            activePlayer.pause();
        }
    } else if (command === 'next') {
        if (!activePlayer) return;
        const targetObj = (activePlayer === mediaVideo || activePlayer === mediaAudio) ? mediaAudio : activePlayer;
        const nextFile = loadMediaFromSource(activePath, targetObj, activePlaylist.currentIndex + 1);
        if (nextFile && targetObj === mediaAudio) updateMediaMetadataDisplay(nextFile);
    } else if (command === 'prev') {
        const targetObj = (activePlayer === mediaVideo || activePlayer === mediaAudio) ? mediaAudio : activePlayer;
        const prevFile = loadMediaFromSource(activePath, targetObj, activePlaylist.currentIndex - 1);
        if (prevFile && targetObj === mediaAudio) updateMediaMetadataDisplay(prevFile);
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
        if (mediaVideo) mediaVideo.volume = masterVol;
        
        // Ensure host background track respects the max volume cap
        let scaledHostVol = masterVol * 0.30;
        if (scaledHostVol > 1.0) scaledHostVol = 1.0;
        hostAudio.volume = scaledHostVol; 
        
        if (bgmPreamp) {
            bgmPreamp.gain.value = masterVol * 2.0; 
        }
    } else if (command.type === 'mic-volume') {
        if (digitalMicPreamp) {
            let micVol = parseFloat(command.value) / 100;
            digitalMicPreamp.gain.value = micVol * 3.0;
        }
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
            logoImg.src = `file:///${bannerData.img.replace(/\\/g, '/')}`;
            logoWrapper.style.display = 'flex';
        }
        bannerContainer.classList.add('banner-visible');
    } else {
        bannerContainer.classList.remove('banner-visible');
    }
});

// Auto-play the next track when current one ends
mediaAudio.addEventListener('ended', () => {
    const nextFile = loadMediaFromSource(currentMediaPath, mediaAudio, activePlaylist.currentIndex + 1);
    if (nextFile) updateMediaMetadataDisplay(nextFile);
});
if (mediaVideo) {
    mediaVideo.addEventListener('ended', () => {
        const nextFile = loadMediaFromSource(currentMediaPath, mediaAudio, activePlaylist.currentIndex + 1);
        if (nextFile) updateMediaMetadataDisplay(nextFile);
    });
}
countdownAudio.addEventListener('ended', () => loadMediaFromSource(currentCountdownPath, countdownAudio, activePlaylist.currentIndex + 1));
hostAudio.addEventListener('ended', () => loadMediaFromSource(currentHostPath, hostAudio, activePlaylist.currentIndex + 1));

// ==========================================
// REMOTE.JS LOGIC
// ==========================================

// 1. INITIALIZATION & SETUP
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

// 2. WINDOW CONTROLS (NEW)
// Binds the new custom HTML buttons to the Electron window manager
document.getElementById('win-min')?.addEventListener('click', () => ipcRenderer.send('window-control', 'minimize'));
document.getElementById('win-max')?.addEventListener('click', () => ipcRenderer.send('window-control', 'maximize'));
document.getElementById('win-close')?.addEventListener('click', () => ipcRenderer.send('window-control', 'close'));

// 3. MASTER WINDOW CONTROLS
document.getElementById('open-config-btn').addEventListener('click', () => {
    ipcRenderer.send('show-config-window');
});

// 4. SCENE SWITCHERS & SMART AUDIO LOGIC
function switchScene(sceneId) {
    // 1. Visual Button State (Orange vs Grey)
    const buttons = ['countdown', 'host', 'media', 'screenshare'];
    buttons.forEach(id => {
        document.getElementById(`btn-scene-${id}`).className = (id === sceneId) 
            ? "primary-btn remote-btn" 
            : "secondary-btn remote-btn";
    });

    // 2. Tell the Canvas to visually change the scene
    ipcRenderer.emit('change-active-scene', null, sceneId);

    // 3. The Smart Auto-State Engine
    if (sceneId === 'countdown') setMicState(false);
    else if (sceneId === 'host') { setMicState(true); ipcRenderer.send('media-command', 'pause'); }
    else if (sceneId === 'media') setMicState(false);
    else if (sceneId === 'screenshare') { setMicState(true); ipcRenderer.send('media-command', 'pause'); }
}



// 5. HARDWARE & AUDIO HUB
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
// Monitor Toggle State removed in favor of canvas meter

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

// 6. METADATA & BANNER PUSHERS
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

// 7. GLOBAL HOTKEYS
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

// 8. MASTER GO LIVE ENGINE
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

// ==========================================
// CHAT LOADER
// ==========================================
async function loadChats() {
    const config = await ipcRenderer.invoke('get-master-config');
    if (config.restreamChatUrl) document.getElementById('iframe-restream').src = config.restreamChatUrl;
    if (config.embersChatUrl) document.getElementById('iframe-embers').src = config.embersChatUrl;
}
loadChats();

// ==========================================
// DYNAMIC SPONSOR OVERLAY SYSTEM
// ==========================================
const sponsorOverlay = document.getElementById('sponsor-overlay');
const loadedSponsors = {};

function loadSponsor(slot, event) {
    const file = event.target.files[0];
    if (file) {
        // Create a secure, temporary local URL
        loadedSponsors[slot] = URL.createObjectURL(file);
        const btn = document.getElementById(`btn-show-${slot}`);
        if (btn) {
            btn.disabled = false;
            btn.style.border = '2px solid #00ff00'; // Visually confirm it's loaded
        }
    }
}

function showSponsor(slot) {
    if (!sponsorOverlay || !loadedSponsors[slot]) return;
    
    sponsorOverlay.classList.remove('sponsor-visible');
    sponsorOverlay.classList.add('sponsor-hidden');
    
    setTimeout(() => {
        sponsorOverlay.src = loadedSponsors[slot];
        sponsorOverlay.classList.remove('sponsor-hidden');
        sponsorOverlay.classList.add('sponsor-visible');
    }, 500);
}

function hideSponsor() {
    if (sponsorOverlay) {
        sponsorOverlay.classList.remove('sponsor-visible');
        sponsorOverlay.classList.add('sponsor-hidden');
    }
}

function moveSponsor(positionClass) {
    if (!sponsorOverlay) return;
    
    // Strip old position classes
    sponsorOverlay.classList.remove('pos-top-left', 'pos-top-right', 'pos-bottom-left', 'pos-bottom-right');
    // Apply new position class
    sponsorOverlay.classList.add(positionClass);
}

// Make functions available globally for onclick attributes
window.loadSponsor = loadSponsor;
window.showSponsor = showSponsor;
window.hideSponsor = hideSponsor;
window.moveSponsor = moveSponsor;

// ==========================================
// REACT VISUALIZER CONFIG
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const ecoModeToggle = document.getElementById('remote-vis-eco');
    const disableToggle = document.getElementById('remote-vis-disable');
    
    if (ecoModeToggle) {
        ecoModeToggle.addEventListener('change', (e) => {
            window.visualizerEcoMode = e.target.checked;
            window.dispatchEvent(new Event('visualizer-config-changed'));
        });
    }
    
    if (disableToggle) {
        disableToggle.addEventListener('change', (e) => {
            window.visualizerDisabled = e.target.checked;
            window.dispatchEvent(new Event('visualizer-config-changed'));
        });
    }

    // Run Safety Check at Startup
    runVisualizerSafetyCheck();
});

// ==========================================
// GPU AUTO-FAILOVER ENGINE
// ==========================================
function detectGPUCapacity() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return 'unknown';

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
            console.log(`🔎 Detected GPU: ${renderer}`);
            return renderer;
        }
        return 'unknown';
    } catch (e) {
        return 'unknown';
    }
}

function runVisualizerSafetyCheck() {
    const gpuName = detectGPUCapacity();
    const cpuCores = navigator.hardwareConcurrency || 4; // Ryzen 7 will report 16 here
    
    console.log(`🔎 Pre-flight Check: GPU = ${gpuName}, Cores = ${cpuCores}`);

    // Only trigger the hard-kill if the GPU is weak AND they have less than 8 cores. 
    const isKnownWeakGPU = (gpuName.includes('basic render') || gpuName.includes('llvmpipe')) && cpuCores < 8;

    const disableCheckbox = document.getElementById('remote-vis-disable'); 
    const ecoCheckbox = document.getElementById('remote-vis-eco'); 

    if (isKnownWeakGPU || (gpuName === 'unknown' && cpuCores < 4)) {
        // SCENARIO 1: Truly weak machine. Kill the visualizer.
        console.warn("⚠️ Weak hardware detected. Auto-disabling 3D Visualizer.");
        if (disableCheckbox && !disableCheckbox.checked) {
            disableCheckbox.checked = true;
            disableCheckbox.dispatchEvent(new Event('change')); 
        }
    } else if (gpuName.includes('intel') || gpuName.includes('hd graphics') || gpuName.includes('uhd graphics') || (gpuName === 'unknown' && cpuCores >= 4 && cpuCores <= 8)) {
        // SCENARIO 2: Average laptop or masked GPU with decent cores. Put it in Eco Mode.
        console.log("🟡 Integrated or Masked GPU detected. Defaulting to Eco Mode (30 FPS).");
        if (ecoCheckbox && !ecoCheckbox.checked) {
            ecoCheckbox.checked = true;
            ecoCheckbox.dispatchEvent(new Event('change'));
        }
        // Ensure it's not disabled
        if (disableCheckbox && disableCheckbox.checked) {
            disableCheckbox.checked = false;
            disableCheckbox.dispatchEvent(new Event('change'));
        }
    } else {
        // SCENARIO 3: BadassBetty territory. Let it fly.
        console.log("✅ Powerful hardware detected. Visualizer cleared for launch.");
        // Ensure nothing is checking the boxes
        if (disableCheckbox && disableCheckbox.checked) {
            disableCheckbox.checked = false;
            disableCheckbox.dispatchEvent(new Event('change'));
        }
        if (ecoCheckbox && ecoCheckbox.checked) {
            ecoCheckbox.checked = false;
            ecoCheckbox.dispatchEvent(new Event('change'));
        }
    }
}
