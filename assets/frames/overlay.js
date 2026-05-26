/* assets/frames/overlay.js 
   Stream Suite API Controller & Particle Engine
*/

// --- 1. API CONTROLLER ---
const hostNameEl = document.getElementById('host-name');
const showNameEl = document.getElementById('show-name');
const themeStylesheet = document.getElementById('theme-stylesheet');
const rootStyles = document.documentElement.style; 

let currentTheme = 'retro-arcade'; // Default fallback

window.updateStreamOverlay = function(config) {
    if (config.hostName) hostNameEl.innerText = config.hostName;
    if (config.showName) showNameEl.innerText = config.showName;

    if (config.themeColor) {
        rootStyles.setProperty('--theme-color', config.themeColor);
        rootStyles.setProperty('--theme-text-color', config.textColor || config.themeColor); 
    }

    if (config.themeName) {
        currentTheme = config.themeName;
        document.body.className = `theme-${config.themeName}`;
        themeStylesheet.href = `${config.themeName}/${config.themeName}.css`;
        
        // Wipe old particles when theme changes so new ones can spawn
        particlesArray = []; 
    }
};

// --- 2. PARTICLE ENGINE ---
const canvas = document.getElementById('particle-canvas');
const ctx = canvas.getContext('2d');

// Resize canvas to exactly fit the window
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let particlesArray = [];
const numberOfParticles = 40; // Kept low for 8GB RAM performance

class Particle {
    constructor() {
        this.reset();
        this.y = Math.random() * canvas.height; // Random start height for initial load
    }

    reset() {
        this.x = Math.random() * canvas.width;
        this.y = canvas.height + 10; // Spawn just below the screen
        this.size = Math.random() * 4 + 2;
        this.speedY = (Math.random() * 1.5) + 0.5;
        this.opacity = Math.random() * 0.5 + 0.2;
    }

    update() {
        // Cyberpunk lines move faster
        let currentSpeed = currentTheme === 'cyberpunk' ? this.speedY * 3 : this.speedY;
        this.y -= currentSpeed;
        
        // Reset if it floats off the top
        if (this.y < -50) {
            this.reset();
        }
    }

    draw() {
        ctx.globalAlpha = this.opacity;

        if (currentTheme === 'neon') {
            // Neon: Glowing Orbs
            ctx.fillStyle = '#00ffff'; 
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#00ffff';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        } 
        else if (currentTheme === 'cyberpunk') {
            // Cyberpunk: Vertical Data Lines
            ctx.fillStyle = '#ff00ff';
            ctx.shadowBlur = 0; // No shadow to save GPU rendering
            ctx.fillRect(this.x, this.y, 2, this.size * 5); 
        } 
        else if (currentTheme === 'retro-arcade') {
            // Retro Arcade: Chunky 8-bit squares
            ctx.fillStyle = '#ffcc00';
            ctx.shadowBlur = 0;
            // Snaps X and Y to grids to look like true 8-bit pixels floating
            let snappedX = Math.round(this.x / 10) * 10;
            let snappedY = Math.round(this.y / 10) * 10;
            ctx.fillRect(snappedX, snappedY, 10, 10);
        }
        
        ctx.globalAlpha = 1.0; // Reset alpha
    }
}

function initParticles() {
    particlesArray = [];
    for (let i = 0; i < numberOfParticles; i++) {
        particlesArray.push(new Particle());
    }
}

function animateParticles() {
    // Clear the previous frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update();
        particlesArray[i].draw();
    }
    
    // Hardware accelerated loop (buttery smooth, lightweight)
    requestAnimationFrame(animateParticles);
}

// Start the engine
initParticles();
animateParticles();

/* DEV TEST: 
   Uncomment this to simulate Stream Suite swapping themes every 5 seconds!
*/
/*
let testThemes = ['neon', 'cyberpunk', 'retro-arcade'];
let themeIndex = 0;
setInterval(() => {
    window.updateStreamOverlay({
        themeName: testThemes[themeIndex]
    });
    themeIndex = (themeIndex + 1) % testThemes.length;
}, 5000);
*/