// src/remote.js
const { ipcRenderer } = require('electron');

const openConfigBtn = document.getElementById('open-config-btn');

// Tell main.js to unhide the setup window
openConfigBtn.addEventListener('click', () => {
    ipcRenderer.send('show-config-window');
});