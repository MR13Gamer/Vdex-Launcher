# VDeX Launcher

A feature-rich Minecraft launcher built with Electron, featuring built-in chat, voice/video calls, mod management, server hosting integration, and AI-powered crash diagnostics.

---

## Overview

VDeX Launcher is an all-in-one desktop application for playing Minecraft. It goes beyond a traditional launcher by combining game management with social features — chat with friends, make voice and video calls, browse and install mods, host servers through Aternos, and get AI-assisted crash fixes — all without leaving the app.

**Version:** 1.0.0
**Platform:** Windows (x64)
**Built with:** Electron 40, Node.js, Firebase, Modrinth/CurseForge APIs

---

## Features

### Minecraft Game Launcher
- **All Versions:** Play any Minecraft version — releases, snapshots, old beta, and old alpha — fetched live from Mojang's version manifest.
- **Mod Loaders:** Built-in support for **Forge**, **Fabric**, **Quilt**, and **NeoForge**. Loaders are automatically installed when you select one and hit Download or Play.
- **Automatic Java Management:** Detects the correct Java version needed (Java 8, 17, or 21) based on the Minecraft version and mod loader. Downloads and manages bundled Java runtimes (Adoptium/Temurin) so you never have to install Java manually.
- **One-Click Download & Play:** Select a version, pick a loader, and press the button. The launcher handles downloading the game JAR, assets, libraries, natives, and launching the game.
- **FPS Boost Profiles:** Built-in JVM argument presets (Balanced, Max FPS, Low-End) that optimize Minecraft's performance based on your hardware.
- **Per-Version Instances:** Each version+loader combination gets its own instance directory for mods, configs, and saves — so your Forge 1.12.2 mods won't conflict with your Fabric 1.21 setup.
- **Offline/Cracked Mode:** Play without a Mojang/Microsoft account using a custom username.

### AI-Powered Smart Fix (Crash Doctor)
- **Automatic Crash Detection:** When Minecraft crashes, a banner appears with the diagnosed issue.
- **AI Diagnosis:** Sends crash logs to an AI model (Google Gemini 2.0 Flash via OpenRouter) for intelligent root cause analysis.
- **Pattern Matching Fallback:** 17+ built-in diagnostic rules covering Java version errors, out-of-memory, missing natives, corrupt files, loader errors, GPU issues, and more.
- **Auto-Fix & Re-Launch:** The system automatically applies the fix (reinstall Java, adjust RAM, re-download libraries, extract natives, reinstall loader) and re-launches the game.
- **Configurable API Key:** Enter your own OpenRouter API key in Settings to enable AI-powered diagnosis.

### Chat & Messaging
- **Real-Time Chat:** Send and receive messages instantly using Firebase Firestore.
- **Direct Messages:** Chat one-on-one with friends from your friends list.
- **Group Chats:** Create group conversations with multiple friends.
- **Rich Messages:** Support for emoji-only large rendering, file/image sharing, message replies, reactions, editing, and deletion.
- **Typing Indicators:** See when your friend is typing in real-time.
- **Message History:** Full scrollable message history with timestamps.

### Voice & Video Calls
- **Voice Calls:** Peer-to-peer voice calls using WebRTC, with Firebase Realtime Database for signaling.
- **Video Calls:** Full video call support with camera streaming.
- **Screen Sharing:** Share your screen during calls.
- **Group Calls:** Multi-participant voice calls for group chats.
- **Call Controls:** Mute/unmute, end call, toggle video — all accessible from the main window or the in-game overlay.
- **Ringtone System:** Custom incoming/outgoing ringtones using the Web Audio API.
- **Call Timer:** Live call duration display.

### Friends System
- **User Search:** Find other VDeX users by username.
- **Friend Requests:** Send, accept, and decline friend requests.
- **Online Presence:** See who's online in real-time (Firebase Realtime Database presence system).
- **Friend Management:** Remove friends, block users.
- **Friends List:** Live-updating list showing online/offline status.

### Mod Manager
- **Modrinth Integration:** Search and browse mods from Modrinth's catalog.
- **CurseForge Integration:** Search and browse mods from CurseForge.
- **Filter by Loader & Version:** Filter search results by mod loader (Forge, Fabric, Quilt, NeoForge) and Minecraft version.
- **One-Click Install:** Download and install mods directly into your instance's mods folder.
- **Installed Mods View:** See all downloaded mods with options to delete them.
- **Mod Details:** View mod descriptions, version history, download counts, and compatibility info.

### Server Hosting (Aternos Integration)
- **Add Servers:** Simple two-field form — enter your server name and real Aternos address.
- **Embedded Aternos Panel:** Full Aternos website embedded inside the launcher via webview. Start, stop, and manage your server without opening a browser.
- **Server Detection:** Automatically detects the server address and status (Online/Offline) when browsing Aternos.
- **Quick Join:** Join your server directly from the launcher — it launches Minecraft and connects to the server address.
- **Copy Server IP:** One-click copy of server addresses.
- **Server Dashboard:** View server details, edit name/address, delete servers.

### In-Game Overlay
- **Floating Overlay Window:** A compact overlay that appears on top of Minecraft during voice calls.
- **Call Controls:** Mute and end call without alt-tabbing.
- **Live Chat:** Send and receive messages while playing.
- **Toggle Visibility:** Show/hide the overlay with a button or shortcut.

### Settings & Customization
- **Java Path:** Auto-detected or manually browse to a custom Java installation.
- **RAM Allocation:** Set maximum RAM for Minecraft (slider).
- **Custom JVM Arguments:** Add your own JVM flags.
- **FPS Boost:** Toggle and select boost profile (Balanced / Max FPS / Low-End).
- **Launch Behavior:** Choose what happens when Minecraft launches — keep launcher open, minimize to tray, or close.
- **Show Console:** Toggle game console log output.
- **Auto-Update:** Toggle automatic update checks.
- **Smart Fix AI Key:** Configure your OpenRouter API key for AI crash diagnosis.
- **Skin Manager:** Select and apply custom skins (file picker or URL).

### UI & Experience
- **Splash Screen:** Animated loading screen with progress bar and floating particles.
- **Modern Dark Theme:** Purple/violet gradient design with glassmorphism effects.
- **Smooth Animations:** Loader availability badges animate in/out, step indicators for download progress, glowing Smart Fix button.
- **Sidebar Navigation:** Tabs for Home (game launcher), Mods, Servers, Friends, Chat, and Settings.
- **System Tray:** Minimize to tray with status icon. Tray menu shows call status.
- **Desktop Notifications:** Native Windows notifications for incoming calls and messages.

---

## Project Structure

```
VDeX Launcher/
|-- main.js                 # Electron main process — window management, IPC handlers, game launch orchestration
|-- preload.js              # Context bridge — exposes safe IPC APIs to renderer
|-- index.html              # Main app UI — all tabs, modals, settings panels
|-- styles.css              # Full application stylesheet
|-- app.js                  # Renderer orchestration — auth state, tab switching, settings, event wiring
|-- minecraft.js            # Game launcher UI — version select, loader select, download/launch, logs, crash banner
|-- mods.js                 # Mod search & install UI — Modrinth + CurseForge integration
|-- servers.js              # Server management UI — add servers, Aternos webview, server dashboard
|-- friends.js              # Friends system — search, requests, presence, friend list
|-- chat.js                 # Chat & calls — messaging, voice/video calls, WebRTC, group calls
|-- auth.js                 # Authentication — Firebase email/password + Google sign-in
|-- firebase-config.js      # Firebase project configuration
|-- overlay.html            # In-game overlay window (call controls + chat)
|-- overlay-preload.js      # Overlay window preload script
|-- splash.html             # Splash/loading screen
|-- logo.svg                # VDeX logo
|-- icon.ico                # Windows application icon
|-- icon.png                # PNG icon source
|-- package.json            # Dependencies, build config, scripts
|
|-- core/
|   |-- launch-engine.js    # Game launch logic — MCLC integration, direct Forge launch, native extraction
|   |-- loader-manager.js   # Mod loader install — Forge, Fabric, Quilt, NeoForge
|   |-- version-manager.js  # Version manifest fetching, install detection
|   |-- java-manager.js     # Java detection, auto-download (Adoptium), version selection
|   |-- download-manager.js # HTTP download utilities, ZIP extraction
|   |-- log-manager.js      # Game log capture and forwarding
|   |-- crash-doctor.js     # AI crash diagnosis + pattern matching + fix planning
```

---

## Core Modules

### Launch Engine (`core/launch-engine.js`)
The heart of the launcher. Handles three launch paths:
1. **MCLC Path** — Uses `minecraft-launcher-core` for vanilla and simple loader launches.
2. **Direct Forge Launch** (`_launchForgeDirect`) — For Forge 1.17+, bypasses MCLC's broken module path handling. Builds classpath, extracts natives, constructs JVM arguments manually.
3. **Legacy Direct Launch** (`_launchLegacyDirect`) — For old Forge versions (pre-1.13). Handles legacy classpath format and `LaunchWrapper`.

All paths call `_ensureVanillaFiles()` first to guarantee the version JSON and JAR exist, then `_extractNatives()` to download and extract platform-specific DLLs (LWJGL, JInput, etc.).

### Java Manager (`core/java-manager.js`)
Determines the correct Java version based on MC version and loader:
- Java 8 for MC 1.16.5 and below
- Java 17 for MC 1.17 - 1.20.4
- Java 21 for MC 1.20.5+

Auto-downloads bundled Java from Adoptium if not found locally. Supports custom Java path override.

### Loader Manager (`core/loader-manager.js`)
Installs mod loaders automatically:
- **Fabric** — Downloads profile JSON from Fabric Meta API.
- **Quilt** — Downloads profile JSON from Quilt Meta API.
- **Forge** — Downloads installer JAR (tries 5 URL patterns for compatibility), runs it with Java. Legacy Forge (pre-1.12.2) uses `yauzl` to extract `install_profile.json` directly.
- **NeoForge** — Downloads installer from NeoForge Maven.

### Crash Doctor (`core/crash-doctor.js`)
Two-tier crash diagnosis:
1. **AI Analysis** — Sends error logs + context to Google Gemini 2.0 Flash via OpenRouter API. Returns structured diagnosis with cause, detail, fix action, and confidence score.
2. **Pattern Matching** — 17 regex-based rules covering all common crash types. Each rule has a weighted score; the highest-scoring match determines the primary fix.

Available automatic fixes: `fix-java`, `increase-ram`, `decrease-ram`, `fix-libraries`, `fix-natives`, `re-download`, `reinstall-loader`.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop Framework | Electron 40 |
| Game Launch | minecraft-launcher-core (MCLC) + custom direct launch |
| Authentication | Firebase Auth (Email/Password + Google) |
| Database | Firebase Firestore (messages, users, friends) |
| Real-time | Firebase Realtime Database (presence, call signaling) |
| Voice/Video | WebRTC (peer-to-peer) |
| Mod APIs | Modrinth API v2, CurseForge API v1 |
| AI Crash Fix | OpenRouter API (Google Gemini 2.0 Flash) |
| Server Hosting | Aternos (embedded webview) |
| Java Runtime | Adoptium/Temurin (auto-downloaded) |
| ZIP Handling | yauzl, adm-zip |
| Installer | electron-builder (NSIS) |
| UI | Custom HTML/CSS, Poppins font, Remix Icons |

---

## Build & Run

### Prerequisites
- Node.js 18+
- npm

### Development
```bash
npm install
npm start
```

### Build Windows Installer
```bash
npm run build
```
Output: `dist/VDeX Launcher Setup 1.0.0.exe`

### Build Portable
```bash
npm run build:portable
```
Output: `dist/VDeX-Launcher-Portable.exe`

---

## Data Storage

| Data | Location |
|------|----------|
| Settings | `%APPDATA%/vdex-launcher/settings.json` |
| Minecraft files | `%APPDATA%/vdex-launcher/minecraft/` |
| Java runtimes | `%APPDATA%/vdex-launcher/java/` |
| Mods | `%APPDATA%/vdex-launcher/mods/` |
| Skins | `%APPDATA%/vdex-launcher/skins/` |
| Instance dirs | `%APPDATA%/vdex-launcher/minecraft/instances/<version>-<loader>/` |
| Server configs | localStorage (renderer process) |

---

## Author

**VDeX**

## License

ISC
