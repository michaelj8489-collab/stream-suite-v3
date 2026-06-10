# Master Blueprint: Stream Suite V3

## Step 1: The Core Purpose, Routing, & Constraints
**The Problem:** The current standard for simultaneous audio and video broadcasting requires a convoluted, resource-heavy web of third-party applications (OBS, butt, virtual audio cables). This creates an intimidating barrier to entry for new talent and a clunky, error-prone workflow for veterans.

**The Need:** A unified, lightweight, all-in-one broadcasting environment that completely eliminates the need for multi-app management and complex audio routing.

**The Core Solution:** A "One-Click" broadcasting software. A single trigger button simultaneously manages the following signal flow:
* **The RTMP Feed (Video + Audio):** Captures the live video canvas and mixes it perfectly with the live audio, pushing the synchronized feed to an RTMP destination (like Restream.io).
* **The Icecast/Shoutcast Feed (Audio Only):** Splits the captured audio track and routes a dedicated, audio-only stream to the radio server (Zeno.fm, etc.).
* **Local Video Record:** Captures a local MP4/MKV recording of the synchronized video and audio.
* **Local Audio Record:** Captures a standalone, local audio file (MP3/WAV) for episodic archives.

**The Ultimate Constraints:**
* **Hardware Efficiency:** Aggressively optimized to run smoothly on lower-tier hardware, specifically targeting stable performance on machines with only 8GB of RAM. It must remain lightweight and avoid hogging CPU/Memory resources.
* **UI/UX Simplicity:** Zero learning curve. A complete novice must be able to input their credentials, pick a mic/camera, and go live without confusion.
* **Feature Completeness:** It must natively support everything a modern DJ does—playing audio tracks, microphone toggles, and handling browser sources (like VDO.Ninja for multi-guest formats)—so they never have to open another app.

## Step 2: Tech Stack & Architecture (The 8GB Framework)
**The Core Engine (Electron + Native FFmpeg):**
* The frontend handles the user interface via Electron.
* The backend utilizes a strictly managed background FFmpeg child process.
* **Anti-Loop Protection:** The build architecture will explicitly isolate the FFmpeg executable from the main Electron .exe to prevent the common packaging infinite-spawn loop.

**The Signal Router (Simultaneous Output):**
FFmpeg will be instructed to duplicate and mux the incoming streams as follows:
* **RTMP:** Video + Mic Audio + System Audio (Muxed together).
* **Local Video Record:** Video + Mic Audio + System Audio (Muxed together).
* **Icecast/Shoutcast:** Mic Audio + System Audio ONLY (Split off and encoded as MP3/AAC).
* **Local Audio Record:** Mic Audio + System Audio ONLY.

**The Encoding Engine (The "Quick Compile"):**
* **720p Hard Cap:** All video processing is restricted to a maximum resolution of 720p to strictly limit CPU/GPU overhead.
* **Zero-Math Encoding:** FFmpeg will utilize the ultrafast preset and zerolatency tuning. This trades a minor amount of video quality for massive CPU savings, simply grabbing the frames and pushing them out as quickly as possible.

**Component A: The Pre-Flight Diagnostics (Startup Check)**
* **Location:** Runs automatically on the first page/Quick Start Guide.
* **Hardware Guard:** Verifies available RAM and CPU cores to ensure the 8GB baseline isn't being throttled by background apps.
* **Dynamic Network Guard:** Calculates the exact minimum upload speed required based on the user's 720p RTMP + Icecast audio bitrates. Runs a silent, rapid upload speed test. Compares the two and returns a clear "Good to Go" or a warning that their current connection will cause stream buffering.

**Component B: The Master System Watcher (Global Diagnostics)**
* An event-listener constantly monitoring the health of the application mid-stream.
* Flags missing inputs (e.g., unplugged mic), stalled FFmpeg processes, or dropped server connections, throwing a human-readable error popup so the user can fix it (or report it) instantly.

## Step 3: UI/UX & The Control Architecture
**The Quick Start Screen (Pre-Flight):**
* **System & Network Check:** Runs the 8GB RAM verification and the calculate-and-test WiFi check automatically as the app opens.
* **The Interface Philosophy:** Clean, dark-mode design with large, obvious dropdown menus. No hidden settings menus for core functions.

**Dynamic Hardware Selection:**
* **Camera & Microphone Dropdowns:** Queries Electron's native device enumeration to list every connected webcam, capture card, and USB microphone.
* **The "Rescan" Button:** Placed prominently next to the dropdowns. Clicking this silently re-queries the system for new USB/Bluetooth handshakes and populates the list without an app restart.

**External Audio Support (Line-In):**
* **Aux/External Dropdown:** A dedicated selector for secondary audio inputs (e.g., a phone or MP3 player plugged into the line-in).
* **Routing:** This audio is mixed natively with the main microphone input before being split to the RTMP and Icecast pipelines.

**The VDO.Ninja Integration (Internal Browser Source):**
* **The Input Field:** A text box for pasting specific VDO.Ninja guest links.
* **The Execution & Routing:** Opens a hidden (or dockable) internal browser view. The video is rendered onto the main canvas, and the audio is captured and injected into both the RTMP and Icecast streams.

**The Broadcast Canvas & Core UI:**
* **Clean Output:** A dedicated, borderless window holding the actual visual scenes. The internal screen recorder locks strictly to this window ID. Even if other windows are dragged over it, viewers only see the clean canvas.
* **Persistent Config:** The main configuration window lives behind the canvas, accessible without pausing or closing active scenes.

**The Pop-Out Remote & Hotkeys:**
* A detached, draggable controller window housing scene switching, audio sliders, and master controls. State is resilient; accidentally closing it does not stop the stream.
* **Hotkeys:** R (Recover Remote), Spacebar (Pause/Play Media), Left Arrow (Previous Track), Right Arrow (Skip Track).

**Intelligent Window Controls & Profiles:**
* **Anti-Frustration UI:** Disappearing Minimize/Maximize/Close buttons have a generous hover-intent zone and a 1.5-second CSS delay so the user doesn't have to hunt for exact pixels.
* **Profile Manager:** Users can save/load profiles (RTMP URL/Key, Icecast URL/Pass/Mount) for true one-click readiness.

**The Master State & Post-Flight:**
* **Master Button:** A single "Go Live" button that morphs into "Stop Streaming" once tunnels are confirmed open.
* **Save Sequence:** Hitting "Stop Streaming" triggers two native OS prompts: one to save the .mp4 video/audio combo, and one to save the .mp3 audio-only file.

## Step 4: Media Handling & Scene Engine
**Scene 1: The Countdown Screen**
* **Visual Canvas & Background:** Media Support: User can select a static image or a looping video via a native pop-out file explorer. Audio Visualizer: Dynamic, frequency-reactive bars strictly anchored to the bottom of the screen (no metadata/text included).
* **Dynamic Text & Typography:** The Timer defaults to 10:00. Position is adjustable to three specific vertical center points. The Header String sits directly above the timer. Styling Engine allows users to select font color and choose exclusively from the 12 pre-loaded .ttf files.
* **The Sliding Banner:** Animation Logic: A message banner that slides into view. Content is typed into an input box on the remote and triggered via a toggle. Collision Detection: Automatically adjusts position to prevent overlap with the timer.
* **Audio Engine & Routing:** Input Sources: Can point to a folder of downloaded tracks or a live line-in media player. Smart Muting: Audio starts automatically when the timer is triggered, and auto-mutes if paused or if the user switches scenes.
* **Controls & The Pop-Out Remote:** Dedicated Hotkeys and Remote Integration for Scene 1 controls.

**Scene 2: The Live Host Screen**
* **Hardware Configuration & Live Switching:** Users select their primary camera and microphone from dropdown menus. "Rescan" button catches newly plugged-in devices. Virtual cameras are fully supported. Remote allows seamless crossfading between camera sources.
* **The Host Nameplate & Frame Assets:** Dynamic frames pull designs directly from specific directories (Cyberpunk, Neon, Retro-Arcade).
* **Audio Control & Smart Mic Logic:** Background music auto-starts at 1% volume. Remote features a master music volume knob, playback controls, mic monitor, and master Mic On/Off toggle. Smart Scene Logic automates mic status based on the active scene.
* **Manual Metadata & Dynamic Overlays:** Config window and remote feature manual input boxes for "Song Title" and "Artist Name" to update lower-third overlays.
* **VDO.Ninja Multi-Guest Integration:** Input fields for VDO.Ninja guest links to broadcast multi-guest environments directly to the live canvas.

**Scene 3: The Media Player Screen**
* **Visual Canvas & Dynamic Overlays:** User can select a static picture or looping video. Dynamic text (Song Title & Artist Name) sits in front of frequency-reactive bars. Overlays fade up/down with tracks.
* **Audio Data Engine (Two Modes):** * *Folder Mode:* Parses local files named `01_songTitle_artistName`. Ignores the prefix and extracts the Song Title and Artist Name to generate the display overlay. 
    * *Line-In Mode:* Manual input boxes for Song Title and Artist Name push data directly to the overlay.
* **Smart Logic & Controls:** Auto-State Memory handles auto-muting and playback resumption. Remote UI displays playback controls and metadata input boxes. Hotkeys supported.

**Scene 4: The Screen Share Screen**
* **Visual Capture & Routing:** Dropdown menu to broadcast an application window or entire desktop.
* **Audio & Smart Logic:** Auto-turns microphone ON when entering the scene. Remote displays full suite of audio tools.

## Step 5: Global Interface & The Configuration Flow
* **The Universal Sliding Banner:** Present on the remote for every scene. Features an input box, "Show/Hide" toggle, and total customization control.
* **The Configuration Window Architecture:** Progressive Saving across tabs. The final screen is dedicated to RTMP and Icecast/Radio server credentials. Profile Manager allows saving grouped setups.
* **The Launch Sequence:** "Launch Remote" button securely closes the config flow and spawns the Pop-Out Remote and Broadcast Canvas. The spawned remote houses the master "Go Live" button, which executes the FFmpeg engine.