const { app, BrowserWindow, ipcMain, dialog, desktopCapturer } = require('electron');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');

// Change line 8 to look exactly like this:
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-direct-composition');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// --- FFmpeg Engine Imports ---
const ffmpeg = require('fluent-ffmpeg');
let ffmpegPath = require('ffmpeg-static');

// Route around the ASAR archive in production
if (app.isPackaged) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

// Link fluent-ffmpeg to your portable binary path
ffmpeg.setFfmpegPath(ffmpegPath);

// Global pointer to hold the active live stream process
let liveBroadcastProcess = null;
let internalAudioStream = null;

ipcMain.on('audio-stream-chunk', (event, chunkBuffer) => {
    if (internalAudioStream) {
        internalAudioStream.write(Buffer.from(chunkBuffer));
    }
});

// Anti-loop protection: Ensures only one instance of the app runs at a time
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    let mainWindow;
    let studioWindow;
    let masterStreamConfig = {};

    // Component A: Hardware Guard Check
    function checkHardware() {
        const totalRAM = os.totalmem() / (1024 * 1024 * 1024); // Convert bytes to GB
        const cpuCores = os.cpus().length;
        return { totalRAM: totalRAM.toFixed(2), cpuCores };
    }

    // 👉 INSERT NEW FUNCTION HERE
 function scanForAudioDevices() {
        return new Promise((resolve) => {
            let terminalOutput = "";
           const scanner = spawn(ffmpegPath, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);

            scanner.stderr.on('data', (data) => {
                terminalOutput += data.toString();
            });

          scanner.on('close', () => {
                const rawVideoList = [];
                const rawAudioList = [];
                let pendingName = ""; 

                // Break the giant text block into individual lines
                const lines = terminalOutput.split('\n');

                lines.forEach(line => {
                    // 1. Grab the friendly name when we see it
                    const nameMatch = line.match(/\]\s+"([^"]+)"/);
                    if (nameMatch && !line.includes("Alternative name")) {
                        pendingName = nameMatch[1];
                    }

                    // 2. Look at the unchangeable OS hardware ID to definitively sort it
                    if (line.includes("Alternative name") && pendingName !== "") {
                        if (line.includes("@device_cm_")) {
                            // 'cm' always means Audio Capture Device
                            rawAudioList.push(pendingName); 
                        } else {
                            // 'pnp' or 'sw' means Video Capture Device
                            rawVideoList.push(pendingName); 
                        }
                        pendingName = ""; // Reset for the next device on the list
                    }
                });

                masterStreamConfig.availableCameras = rawVideoList;
                masterStreamConfig.availableAudioDevices = rawAudioList;

                console.log("Cameras Loaded:", masterStreamConfig.availableCameras);
                console.log("Mics Loaded:", masterStreamConfig.availableAudioDevices);

                resolve(); 
            });
        });
    }

    function createWindow() {
        mainWindow = new BrowserWindow({
            width: 1280,
            height: 720,
            frame: false, // Borderless window
            icon: path.join(__dirname, '..', 'stream-suite-logo.png'),
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false 
            }
        });

        // FIXED: Bulletproof path routing
        mainWindow.loadFile(path.join(__dirname, 'index.html')).catch(err => console.error("Main Window Load Error:", err));
    }

    // --- Window Management ---
    ipcMain.on('launch-main-stage', (event, config) => {
        console.log("Hardware Selected:", config);
        masterStreamConfig = config;
        
        if (mainWindow) mainWindow.hide();

        studioWindow = new BrowserWindow({
            width: 1360,
            height: 940,
            resizable: true,
            frame: false,
            title: "Broadcast Canvas", // Critical: Used by FFmpeg to lock onto this window
            icon: path.join(__dirname, '..', 'stream-suite-logo.png'),
            webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
        });
        // FIXED: Bulletproof path routing
        studioWindow.loadFile(path.join(__dirname, 'studio.html')).catch(err => console.error("Studio Load Error:", err));

        studioWindow.webContents.openDevTools({ mode: 'detach' });
    });

   

    // --- NEW: Global Custom Window Controls ---
    // This allows your disappearing min/max/close buttons to actually command the windows
    ipcMain.on('window-control', (event, command) => {
        const webContents = event.sender;
        const win = BrowserWindow.fromWebContents(webContents);
        if (!win) return;

        if (command === 'minimize') {
            win.minimize();
        } else if (command === 'maximize') {
            if (win.isMaximized()) {
                win.unmaximize();
            } else {
                win.maximize();
            }
        } else if (command === 'close') {
            // If the user closes the main config window or the studio window, kill the entire app process
            if (win === mainWindow || win === studioWindow) {
                app.quit();
            } else {
                win.close();
            }
        }
    });

    // The Canvas and Remote ask for this when they first open
    ipcMain.handle('get-master-config', () => {
        return masterStreamConfig;
    });

    // Real-Time Data Relay
    ipcMain.on('send-live-update', (event, newData) => {
        masterStreamConfig = { ...masterStreamConfig, ...newData };
        if (studioWindow) {
            studioWindow.webContents.send('update-canvas-ui', newData);
        }
    });

    // Scene Switcher Relay
    ipcMain.on('switch-scene', (event, sceneId) => {
        if (studioWindow) {
            studioWindow.webContents.send('change-active-scene', sceneId);
        }
    });

    // --- Command Relays ---
    ipcMain.on('audio-command', (event, command) => {
        if (studioWindow) studioWindow.webContents.send('audio-command', command);
    });

    ipcMain.on('media-command', (event, command) => {
        if (studioWindow) studioWindow.webContents.send('media-command', command);
    });

    ipcMain.on('toggle-banner', (event, bannerData) => {
        if (studioWindow) studioWindow.webContents.send('toggle-banner', bannerData);
    });

    // --- Native File Explorers ---
    ipcMain.handle('dialog:openFile', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: 'Media Files', extensions: ['mp4', 'mkv', 'webm', 'png', 'jpg', 'jpeg', 'gif'] }
            ]
        });
        if (!canceled) return filePaths[0];
    });

    ipcMain.handle('dialog:openDirectory', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory']
        });
        if (!canceled) return filePaths[0];
    });

    ipcMain.on('show-config-window', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // SCENE 4: SCREEN SHARE SCANNER
    ipcMain.handle('get-desktop-sources', async () => {
        try {
            const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], fetchWindowIcons: false });
            return sources.map(source => ({
                id: source.id,
                name: source.name
            }));
        } catch (error) {
            console.error("Failed to get desktop sources:", error);
            return [];
        }
    });

    // =========================================================================
    // PRE-FLIGHT NETWORK GUARD
    // =========================================================================
    function checkUploadSpeed() {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const payloadSize = 1024 * 1024; // 1 MB
            const payload = Buffer.alloc(payloadSize); // Mock data

            const options = {
                hostname: 'httpbin.org',
                port: 443,
                path: '/post',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': payload.length
                }
            };

            const req = https.request(options, (res) => {
                res.on('data', () => {});
                res.on('end', () => {
                    const durationSeconds = (Date.now() - startTime) / 1000;
                    const bits = payloadSize * 8;
                    const kbps = (bits / durationSeconds) / 1000;
                    resolve(kbps);
                });
            });

            req.on('error', (e) => {
                console.error("Upload speed test failed:", e);
                resolve(0);
            });

            req.write(payload);
            req.end();
        });
    }

    // =========================================================================
    // THE FINAL BOSS: THE SIMULTANEOUS BROADCAST ENGINE (FFMPEG)
    // =========================================================================
    ipcMain.on('start-broadcast', async (event) => {
        if (liveBroadcastProcess) return; // Already streaming!

        console.log("🔴 Spawning Blueprint Broadcast Engine...");

        const timestamp = Date.now();
        const videoArchiveName = `archive_video_${timestamp}.mp4`;
        const audioArchiveName = `archive_audio_${timestamp}.mp3`;

        const desktopPath = app.getPath('desktop');
        const videoArchivePath = path.join(desktopPath, videoArchiveName);
        const audioArchivePath = path.join(desktopPath, audioArchiveName);

        const rtmpDestination1 = `${masterStreamConfig.rtmpUrl}/${masterStreamConfig.rtmpKey}`;

        console.log("🌐 Running Pre-Flight Network Upload Speed Check...");
        const uploadKbps = await checkUploadSpeed();
        console.log(`📡 Detected Upload Speed: ${Math.round(uploadKbps)} kbps`);

        let videoBitrate = '2500k';
        if (uploadKbps > 0) {
            if (uploadKbps < 1500) {
                videoBitrate = '800k';
                console.log("⚠️ Slow connection detected! Auto-optimizing video bitrate to 800kbps (Safe Mode).");
            } else if (uploadKbps < 3500) {
                videoBitrate = '1500k';
                console.log("⚠️ Congested connection detected! Auto-optimizing video bitrate to 1500kbps.");
            } else {
                console.log("✅ Network connection is strong! Using high-quality 2500kbps video bitrate.");
            }
        }
        const bufsize = parseInt(videoBitrate) * 2 + 'k';

        let hasRtmp2 = false;
        let videoOutputCount = 2; // rtmp1 + mp4
        if (masterStreamConfig.rtmpUrl2 && masterStreamConfig.rtmpKey2) {
            hasRtmp2 = true;
            videoOutputCount++;
        }

        let hasIcecast = false;
        let icecastDestination = '';
        if (masterStreamConfig.icecastUrl) {
            hasIcecast = true;
            icecastDestination = `icecast://source:${masterStreamConfig.icecastPass}@${masterStreamConfig.icecastUrl}:${masterStreamConfig.icecastPort || 80}${masterStreamConfig.icecastMount}`;
        }

        let videoSplits = `[0:v]setpts=PTS-STARTPTS,crop=1280:640:0:40,format=yuv420p,split=${videoOutputCount}[v_rtmp1]`;
        if (hasRtmp2) videoSplits += `[v_rtmp2]`;
        videoSplits += `[v_mp4]`;

        const complexFilterStr = videoSplits;

        internalAudioStream = new PassThrough();
        if (studioWindow) studioWindow.webContents.send('start-internal-recording');

        liveBroadcastProcess = ffmpeg()
            .input('title=Broadcast Canvas')
            .inputFormat('gdigrab')
            .inputOptions([
                '-framerate 30',
                '-thread_queue_size 4096',
                '-rtbufsize 512M'
            ])
            
            // INPUT 1: The Node.js Internal Audio Pipe (Zero Dependencies)
            .input(internalAudioStream)
            .inputFormat('webm')
            .inputOptions([
                '-thread_queue_size 4096',
                '-rtbufsize 512M'
            ])

            .complexFilter(complexFilterStr)
            
            // Output: RTMP 1 (Always)
            .output(rtmpDestination1)
            .outputFormat('flv')
            .outputOptions([
                '-map [v_rtmp1]',
                '-map 1:a',
                '-vcodec libx264',
                '-acodec aac',
                '-preset ultrafast', 
                '-tune zerolatency', 
                `-b:v ${videoBitrate}`, 
                `-maxrate ${videoBitrate}`,
                `-bufsize ${bufsize}`,
                '-b:a 128k'
            ]);

        // Output: RTMP 2 (Optional)
        if (hasRtmp2) {
            const rtmpDestination2 = `${masterStreamConfig.rtmpUrl2}/${masterStreamConfig.rtmpKey2}`;
            liveBroadcastProcess = liveBroadcastProcess
                .output(rtmpDestination2)
                .outputFormat('flv')
                .outputOptions([
                    '-map [v_rtmp2]',
                    '-map 1:a',
                    '-vcodec libx264',
                    '-acodec aac',
                    '-preset ultrafast', 
                    '-tune zerolatency', 
                    `-b:v ${videoBitrate}`, 
                    `-maxrate ${videoBitrate}`,
                    `-bufsize ${bufsize}`,
                    '-b:a 128k'
                ]);
        }

        liveBroadcastProcess = liveBroadcastProcess
            // Output: MP4 Archive (Always)
            .output(videoArchivePath)
            .outputFormat('mp4')
            .outputOptions([
                '-map [v_mp4]',
                '-map 1:a',
                '-af', 'asetpts=PTS-STARTPTS', // <-- SYNC THE AUDIO CLOCK
                '-vcodec libx264',
                '-acodec aac',
                '-preset ultrafast', 
                '-tune zerolatency', 
                `-b:v ${videoBitrate}`, 
                `-maxrate ${videoBitrate}`,
                `-bufsize ${bufsize}`,
                '-b:a 128k',
                '-movflags +frag_keyframe+empty_moov+default_base_moof'
            ]);
            
        // Output: Icecast MP3 (Optional)
        if (hasIcecast) {
            liveBroadcastProcess = liveBroadcastProcess
                .output(icecastDestination)
                .outputFormat('mp3')
                .outputOptions([
                    '-map 1:a',
                    '-acodec libmp3lame',
                    '-b:a 128k',
                    '-content_type audio/mpeg'
                ]);
        }

        liveBroadcastProcess = liveBroadcastProcess
            // Output: Audio MP3 Archive (Always)
            .output(audioArchivePath)
            .outputFormat('mp3')
            .outputOptions([
                '-map 1:a',
                '-acodec libmp3lame',
                '-b:a 128k'
            ])
            .on('stderr', (stderrLine) => {
                console.log('🔎 FFMPEG INTERNAL:', stderrLine);
            })
            .on('start', (commandLine) => {
                console.log('🚀 FFmpeg tunnels successfully opened!');
            })
            .on('error', (err) => {
                const msg = err.message ? err.message.toLowerCase() : '';
                if (msg.includes('sigint') || msg.includes('sigkill') || msg.includes('killed') || msg.includes('exit code 255')) {
                    console.log('⏹ Broadcast engine shut down gracefully (fallback).');
                } else {
                    console.error('❌ FFmpeg Broadcast Engine error:', err.message);
                }
                liveBroadcastProcess = null;
            })
            .on('end', () => {
                console.log('⏹ Broadcast engine shut down gracefully.');
                liveBroadcastProcess = null;
            });

        liveBroadcastProcess.run();
    });

    ipcMain.on('stop-broadcast', (event) => {
        if (!liveBroadcastProcess) return;

        console.log("⏹ Stopping broadcast and saving local files to your Desktop...");
        
        let procRef = liveBroadcastProcess;
        
        // Graceful Quit Command
        if (procRef.ffmpegProc && procRef.ffmpegProc.stdin && procRef.ffmpegProc.stdin.writable) {
            procRef.ffmpegProc.stdin.write('q\n');
            procRef.ffmpegProc.stdin.end();
        } else {
            procRef.kill('SIGINT');
        }

        // Fallback Safety
        setTimeout(() => {
            if (liveBroadcastProcess === procRef) {
                console.log("⚠️ FFmpeg graceful exit timed out. Forcing termination.");
                procRef.kill('SIGKILL');
            }
        }, 3000);

        if (internalAudioStream) { 
            internalAudioStream.end(); 
            internalAudioStream = null; 
        }

        if (studioWindow) studioWindow.webContents.send('stop-internal-recording');
    });

    // --- Core Lifecycle Hooks ---
    app.whenReady().then(async () => {
        const { session } = require('electron');
        session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
            if (permission === 'media') return true;
            return false;
        });

        ipcMain.handle('get-hardware-info', () => checkHardware());
        
        // ⏱️ JavaScript pauses here until the scan completely finishes
        await scanForAudioDevices();
        
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    }).catch(err => console.error("App Ready Error:", err));

    ipcMain.handle('run-speed-test', async () => await checkUploadSpeed());

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}

process.on('uncaughtException', (err) => {
    console.error('💥 FATAL NODE CRASH:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 FATAL PROMISE REJECTION:', reason);
});