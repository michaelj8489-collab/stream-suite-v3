const { app, BrowserWindow, ipcMain, dialog, desktopCapturer } = require('electron');
const path = require('path');
const os = require('os');



// Anti-loop protection: Ensures only one instance of the app runs at a time
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    let mainWindow;

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
            frame: false, // Borderless window as requested in the Blueprint
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false // Simplifies IPC communication for the initial build
            }
        });

        mainWindow.loadFile('src/index.html');
    }

   // --- Window Management ---
    ipcMain.on('launch-main-stage', (event, config) => {
        console.log("Hardware Selected:", config);
        
        // FIX: Hide the setup window instead of closing it so we can bring it back!
        if (mainWindow) mainWindow.hide();

        const canvasWindow = new BrowserWindow({
            width: 1280,
            height: 720,
            frame: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                sandbox: false
            }
        });
        canvasWindow.loadFile('src/canvas.html');

        const remoteWindow = new BrowserWindow({
            width: 400,
            height: 700,
            frame: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                sandbox: false
            }
        });
        remoteWindow.loadFile('src/remote.html');
    });

    // --- Native File Explorers ---
    // Opens a dialog to pick a specific file (Video/Image)
    ipcMain.handle('dialog:openFile', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: 'Media Files', extensions: ['mp4', 'mkv', 'webm', 'png', 'jpg', 'jpeg', 'gif'] }
            ]
        });
        if (!canceled) {
            return filePaths[0];
        }
    });

    // Opens a dialog to pick an entire folder (for the music tracks)
    ipcMain.handle('dialog:openDirectory', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory']
        });
        if (!canceled) {
            return filePaths[0];
        }
    });

    // NEW: Listener to bring the config window back to the front
    ipcMain.on('show-config-window', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // --- Screen Share Source Fetcher ---
    ipcMain.handle('get-screen-sources', async () => {
        // Fetches both entire monitors ('screen') and individual app windows ('window')
        const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
        
        // Map the data into a clean array to send back to the frontend
        return sources.map(source => ({
            id: source.id,
            name: source.name
        }));
    });

    app.whenReady().then(() => {
        // Expose the hardware check to the frontend renderer
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