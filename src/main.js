const { app, BrowserWindow, ipcMain, dialog, desktopCapturer } = require('electron');
const path = require('path');
const os = require('os');

// --- THE AMD GRAPHICS CRASH FIX ---
// This forces software rendering so your graphics chip doesn't panic and freeze the visual scenes.
app.disableHardwareAcceleration();

// --- FFmpeg Engine Imports ---
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
// Link fluent-ffmpeg to your portable binary path
ffmpeg.setFfmpegPath(ffmpegPath);

// Global pointer to hold the active live stream process
let liveBroadcastProcess = null;

// Anti-loop protection: Ensures only one instance of the app runs at a time
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    let mainWindow;
    let canvasWindow; 
    let remoteWindow;
    let chatWindow;
    let masterStreamConfig = {};

    // Component A: Hardware Guard Check
    function checkHardware() {
        const totalRAM = os.totalmem() / (1024 * 1024 * 1024); // Convert bytes to GB
        const cpuCores = os.cpus().length;
        return { totalRAM: totalRAM.toFixed(2), cpuCores };
    }

    function createWindow() {
        mainWindow = new BrowserWindow({
            width: 1280,
            height: 720,
            frame: false, // Borderless window
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false 
            }
        });

        // FIXED: Bulletproof path routing
        mainWindow.loadFile(path.join(__dirname, 'index.html'));
    }

    // --- Window Management ---
    ipcMain.on('launch-main-stage', (event, config) => {
        console.log("Hardware Selected:", config);
        masterStreamConfig = config;
        
        if (mainWindow) mainWindow.hide();

        canvasWindow = new BrowserWindow({
            width: 1280,
            height: 720,
            frame: false,
            title: "Broadcast Canvas", // Critical: Used by FFmpeg to lock onto this window
            webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
        });
        // FIXED: Bulletproof path routing
        canvasWindow.loadFile(path.join(__dirname, 'canvas.html'));

        remoteWindow = new BrowserWindow({
            width: 400,
            height: 700,
            frame: false,
            webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
        });
        // FIXED: Bulletproof path routing
        remoteWindow.loadFile(path.join(__dirname, 'remote.html'));

        chatWindow = new BrowserWindow({
            width: 400,
            height: 700,
            x: 100, // Offsets it slightly so it doesn't open perfectly on top of the remote
            y: 100,
            frame: false,
            webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
        });
        // FIXED: Bulletproof path routing
        chatWindow.loadFile(path.join(__dirname, 'chat.html'));
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
            // If the user closes the main config window or the remote window, kill the entire app process
            if (win === mainWindow || win === remoteWindow) {
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
        if (canvasWindow) {
            canvasWindow.webContents.send('update-canvas-ui', newData);
        }
    });

    // Scene Switcher Relay
    ipcMain.on('switch-scene', (event, sceneId) => {
        if (canvasWindow) {
            canvasWindow.webContents.send('change-active-scene', sceneId);
        }
    });

    // --- Command Relays ---
    ipcMain.on('audio-command', (event, command) => {
        if (canvasWindow) canvasWindow.webContents.send('audio-command', command);
    });

    ipcMain.on('media-command', (event, command) => {
        if (canvasWindow) canvasWindow.webContents.send('media-command', command);
    });

    ipcMain.on('toggle-banner', (event, bannerData) => {
        if (canvasWindow) canvasWindow.webContents.send('toggle-banner', bannerData);
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
    // THE FINAL BOSS: THE SIMULTANEOUS BROADCAST ENGINE (FFMPEG)
    // =========================================================================
    ipcMain.on('start-broadcast', (event) => {
        if (liveBroadcastProcess) return; // Already streaming!

        console.log("🔴 Spawning Blueprint Broadcast Engine...");

        const timestamp = Date.now();
        const videoArchiveName = `archive_video_${timestamp}.mp4`;
        const audioArchiveName = `archive_audio_${timestamp}.mp3`;

        const videoArchivePath = path.join(os.homedir(), 'Desktop', videoArchiveName);
        const audioArchivePath = path.join(os.homedir(), 'Desktop', audioArchiveName);

        const rtmpDestination = `${masterStreamConfig.rtmpUrl}/${masterStreamConfig.rtmpKey}`;
        const icecastDestination = `icecast://source:${masterStreamConfig.icecastPass}@${masterStreamConfig.icecastUrl}:${masterStreamConfig.icecastPort || 80}${masterStreamConfig.icecastMount}`;

        liveBroadcastProcess = ffmpeg()
            .input('title=Broadcast Canvas')
            .inputFormat('gdigrab')
            .inputOptions('-framerate 30')
            .input('audio="Line (USB AUDIO CODEC) (08bb:29c0)"')
            .inputFormat('dshow')
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-preset ultrafast', 
                '-tune zerolatency', 
                '-s 1280x720', 
                '-b:v 2500k', 
                '-b:a 128k', 
                '-pix_fmt yuv420p'
            ])
            .output(rtmpDestination)
            .outputFormat('flv')
            .output(videoArchivePath)
            .outputFormat('mp4')
            .output(icecastDestination)
            .outputFormat('mp3')
            .noVideo() 
            .output(audioArchivePath)
            .outputFormat('mp3')
            .noVideo()

            .on('start', (commandLine) => {
                console.log('🚀 FFmpeg tunnels successfully opened!');
            })
            .on('error', (err) => {
                console.error('❌ FFmpeg Broadcast Engine error:', err.message);
                liveBroadcastProcess = null;
            })
            .on('end', () => {
                console.log('⏹ Tunnels safely closed. Streams closed.');
                liveBroadcastProcess = null;
            });

        liveBroadcastProcess.run();
    });

    ipcMain.on('stop-broadcast', (event) => {
        if (!liveBroadcastProcess) return;

        console.log("⏹ Stopping broadcast and saving local files to your Desktop...");
        liveBroadcastProcess.kill('SIGINT'); 
        liveBroadcastProcess = null;
    });

    // --- Core Lifecycle Hooks ---
    app.whenReady().then(() => {
        ipcMain.handle('get-hardware-info', () => checkHardware());
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}