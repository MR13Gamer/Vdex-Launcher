const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage, Notification, globalShortcut, net, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// Set app ID for Windows taskbar grouping & icon
app.setAppUserModelId('com.vdex.launcher');

// Core modules
const VersionManager = require('./core/version-manager');
const JavaManager = require('./core/java-manager');
const LaunchEngine = require('./core/launch-engine');
const LoaderManager = require('./core/loader-manager');
const LogManager = require('./core/log-manager');
const CrashDoctor = require('./core/crash-doctor');
const ClientManager = require('./core/client-manager');
const { httpsDownload, downloadFile: dmDownloadFile } = require('./core/download-manager');

const zlib = require('zlib');

const MC_DIR = path.join(app.getPath('userData'), 'minecraft');
const MODS_DIR = path.join(app.getPath('userData'), 'mods');
const SKINS_DIR = path.join(app.getPath('userData'), 'skins');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

// =================== SERVERS.DAT NBT HELPER ===================
// Minimal NBT read/write for Minecraft servers.dat

function readServersDat(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath);
    let data = raw;
    // Try gunzip first (some versions use gzip)
    try { data = zlib.gunzipSync(raw); } catch (e) { /* not gzipped, use raw */ }

    let offset = 0;
    const readByte = () => data.readInt8(offset++);
    const readUByte = () => data.readUInt8(offset++);
    const readShort = () => { const v = data.readInt16BE(offset); offset += 2; return v; };
    const readUShort = () => { const v = data.readUInt16BE(offset); offset += 2; return v; };
    const readInt = () => { const v = data.readInt32BE(offset); offset += 4; return v; };
    const readLong = () => { offset += 8; return 0; }; // skip longs
    const readFloat = () => { offset += 4; return 0; };
    const readDouble = () => { offset += 8; return 0; };
    const readString = () => { const len = readUShort(); const s = data.toString('utf8', offset, offset + len); offset += len; return s; };

    function skipTag(type) {
      switch (type) {
        case 1: offset += 1; break;
        case 2: offset += 2; break;
        case 3: offset += 4; break;
        case 4: offset += 8; break;
        case 5: offset += 4; break;
        case 6: offset += 8; break;
        case 7: { const len = readInt(); offset += len; break; }
        case 8: { const len = readUShort(); offset += len; break; }
        case 9: { const lt = readUByte(); const ll = readInt(); for (let i = 0; i < ll; i++) skipTag(lt); break; }
        case 10: { while (true) { const t = readUByte(); if (t === 0) break; readString(); skipTag(t); } break; }
        case 11: { const len = readInt(); offset += len * 4; break; }
        case 12: { const len = readInt(); offset += len * 8; break; }
      }
    }

    function readCompound() {
      const result = {};
      while (offset < data.length) {
        const tagType = readUByte();
        if (tagType === 0) break;
        const tagName = readString();
        if (tagType === 8) { result[tagName] = readString(); }
        else if (tagType === 1) { result[tagName] = readByte(); }
        else if (tagType === 9 && tagName === 'servers') {
          const listType = readUByte();
          const listLen = readInt();
          result.servers = [];
          for (let i = 0; i < listLen; i++) {
            if (listType === 10) result.servers.push(readCompound());
            else skipTag(listType);
          }
        }
        else skipTag(tagType);
      }
      return result;
    }

    // Root compound
    const rootType = readUByte();
    if (rootType !== 10) return [];
    readString(); // root name
    const root = readCompound();
    return root.servers || [];
  } catch (e) {
    console.error('Failed to parse servers.dat:', e.message);
    return [];
  }
}

function writeServersDat(servers, filePath) {
  const bufs = [];
  const writeByte = (b) => { const buf = Buffer.alloc(1); buf.writeUInt8(b & 0xFF); bufs.push(buf); };
  const writeShort = (s) => { const buf = Buffer.alloc(2); buf.writeUInt16BE(s & 0xFFFF); bufs.push(buf); };
  const writeInt = (i) => { const buf = Buffer.alloc(4); buf.writeInt32BE(i); bufs.push(buf); };
  const writeString = (str) => { const b = Buffer.from(str, 'utf8'); writeShort(b.length); bufs.push(b); };
  const writeTagString = (name, value) => { writeByte(8); writeString(name); writeString(value || ''); };
  const writeTagByte = (name, value) => { writeByte(1); writeString(name); writeByte(value); };

  // Root compound
  writeByte(10); writeShort(0); // TAG_Compound, empty name
  // Servers list
  writeByte(9); writeString('servers'); writeByte(10); writeInt(servers.length);
  for (const s of servers) {
    if (s.name) writeTagString('name', s.name);
    if (s.ip) writeTagString('ip', s.ip);
    if (s.icon) writeTagString('icon', s.icon);
    if (s.acceptTextures !== undefined) writeTagByte('acceptTextures', s.acceptTextures ? 1 : 0);
    writeByte(0); // TAG_End
  }
  writeByte(0); // Root TAG_End

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat(bufs));
}

function addServerToMinecraft(serverName, serverAddress) {
  const serversDatPath = path.join(MC_DIR, 'servers.dat');
  const servers = readServersDat(serversDatPath);
  // Check if server already exists
  const exists = servers.some(s => s.ip === serverAddress);
  if (!exists) {
    servers.push({ name: serverName, ip: serverAddress });
    writeServersDat(servers, serversDatPath);
    console.log(`Added server "${serverName}" (${serverAddress}) to servers.dat`);
  } else {
    console.log(`Server ${serverAddress} already in servers.dat`);
  }
}

/**
 * Get the mods directory — always uses a single shared mods folder
 * Path: %APPDATA%/vdex-launcher/mods
 */
function getInstanceModsDir() {
  const modsDir = path.join(app.getPath('userData'), 'mods');
  ensureDir(modsDir);
  return modsDir;
}

// =================== SETTINGS SYSTEM ===================
let settings = {};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
    settings = {};
  }
  return settings;
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function getSetting(key, defaultValue = null) {
  return settings[key] !== undefined ? settings[key] : defaultValue;
}

function setSetting(key, value) {
  settings[key] = value;
  saveSettings();
}

loadSettings();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// =================== LOCAL SERVER ===================
let localServer;
let serverPort = 0;
function startLocalServer() {
  const MIME_TYPES = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
  };
  const FIXED_PORT = 19847; // Fixed port so Firebase auth persistence works across restarts
  return new Promise((resolve) => {
    localServer = http.createServer((req, res) => {
      let filePath = (req.url === '/' ? '/index.html' : req.url).split('?')[0];
      const fullPath = path.join(__dirname, filePath);
      const ext = path.extname(fullPath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      if (fs.existsSync(fullPath) && !fs.statSync(fullPath).isDirectory()) {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(fs.readFileSync(fullPath));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    let resolved = false;
    const onListening = () => {
      if (resolved) return;
      resolved = true;
      serverPort = localServer.address().port;
      console.log(`Local server on http://localhost:${serverPort}`);
      resolve();
    };
    localServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${FIXED_PORT} in use, trying random port...`);
        localServer.listen(0, '127.0.0.1', onListening);
      }
    });
    localServer.listen(FIXED_PORT, '127.0.0.1', onListening);
  });
}

// =================== APP ICON ===================
let appIcon = null; // nativeImage generated from SVG at startup

async function generateAppIcon() {
  const pngPath = path.join(__dirname, 'icon.png');
  const icoPath = path.join(__dirname, 'icon.ico');
  const svgPath = path.join(__dirname, 'logo.svg');

  // Check if SVG changed since last icon generation
  let needsRegen = !fs.existsSync(pngPath) || !fs.existsSync(icoPath);
  if (!needsRegen && fs.existsSync(svgPath)) {
    const svgTime = fs.statSync(svgPath).mtimeMs;
    const pngTime = fs.statSync(pngPath).mtimeMs;
    if (svgTime > pngTime) needsRegen = true;
  }

  // Try loading cached .ico first (best for Windows taskbar)
  if (!needsRegen && fs.existsSync(icoPath)) {
    try {
      appIcon = nativeImage.createFromPath(icoPath);
      if (!appIcon.isEmpty()) {
        console.log('Loaded icon from icon.ico');
        return;
      }
    } catch (e) { needsRegen = true; }
  }

  // Fallback to PNG
  if (!needsRegen && fs.existsSync(pngPath)) {
    try {
      appIcon = nativeImage.createFromPath(pngPath);
      if (!appIcon.isEmpty()) {
        console.log('Loaded icon from icon.png');
        return;
      }
    } catch (e) { needsRegen = true; }
  }

  if (!fs.existsSync(svgPath)) return;

  try {
    const svgData = fs.readFileSync(svgPath, 'utf-8');
    const svgBase64 = Buffer.from(svgData).toString('base64');
    const html = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;}body{width:256px;height:256px;background:transparent;display:flex;align-items:center;justify-content:center;overflow:hidden;}</style></head><body><img src="data:image/svg+xml;base64,${svgBase64}" width="256" height="256"/></body></html>`;

    const iconWin = new BrowserWindow({
      width: 256, height: 256,
      show: false, frame: false, transparent: true,
      skipTaskbar: true,
      webPreferences: { offscreen: true }
    });

    await iconWin.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await new Promise(r => setTimeout(r, 500));
    const image = await iconWin.webContents.capturePage();
    iconWin.destroy();

    if (!image.isEmpty()) {
      // Save PNG
      try {
        fs.writeFileSync(pngPath, image.toPNG());
        console.log('Generated icon.png from SVG');
      } catch (e) {
        console.warn('Failed to save icon.png:', e.message);
      }

      // Generate .ico file (Windows taskbar needs this)
      try {
        const { default: pngToIco } = require('png-to-ico');
        const icoBuffer = await pngToIco(pngPath);
        fs.writeFileSync(icoPath, icoBuffer);
        console.log('Generated icon.ico from PNG');
        appIcon = nativeImage.createFromPath(icoPath);
        if (appIcon.isEmpty()) appIcon = image;
      } catch (e) {
        console.warn('Failed to generate .ico, using PNG:', e.message);
        appIcon = image;
      }
    }
  } catch (e) {
    console.error('Failed to generate app icon:', e.message);
  }
}

// =================== TRAY ===================
let tray = null;

function createTray() {
  if (tray) return;
  const icon = appIcon ? appIcon.resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('VDeX Launcher');
  updateTrayMenu();
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu(callStatus = null) {
  if (!tray) return;
  const template = [
    { label: 'Show VDeX Launcher', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' }
  ];
  if (callStatus) {
    template.push({ label: `In call: ${callStatus}`, enabled: false });
    template.push({ type: 'separator' });
  }
  template.push({ label: 'Quit', click: () => { app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(callStatus ? `VDeX - In call: ${callStatus}` : 'VDeX Launcher');
}

// =================== OVERLAY WINDOW ===================
let overlayWindow = null;
let overlayCallActive = false; // Track if user is in a voice call

function createOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.show();
    return;
  }
  overlayWindow = new BrowserWindow({
    width: 200,
    height: 50,
    x: 20,
    y: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'overlay-preload.js')
    }
  });

  overlayWindow.loadFile('overlay.html');
  overlayWindow.once('ready-to-show', () => {
    overlayWindow.show();
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

function hideOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

function toggleOverlayWindow() {
  // Only allow overlay toggle when in a voice call
  if (!overlayCallActive) return;
  if (overlayWindow) {
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.show();
      overlayWindow.focus();
    }
  } else {
    createOverlayWindow();
  }
}

// Relay overlay actions to main renderer
ipcMain.on('overlay-hide', () => {
  // Just hide instead of destroying — user can bring it back with hotkey
  if (overlayWindow) overlayWindow.hide();
});

ipcMain.on('overlay-toggle-mute', () => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('overlay-action', { action: 'toggle-mute' });
  }
});

ipcMain.on('overlay-end-call', () => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('overlay-action', { action: 'end-call' });
  }
});

ipcMain.on('overlay-send-message', (event, text) => {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('overlay-action', { action: 'send-message', text });
  }
});

ipcMain.on('overlay-resize', (event, w, h) => {
  if (overlayWindow) {
    overlayWindow.setSize(w, h, true);
  }
});

// IPC to show/hide overlay from renderer
ipcMain.handle('show-overlay', async () => {
  createOverlayWindow();
  return { success: true };
});

ipcMain.handle('hide-overlay', async () => {
  hideOverlayWindow();
  return { success: true };
});

ipcMain.handle('toggle-overlay', async () => {
  if (!overlayCallActive) return { success: false, visible: false };
  toggleOverlayWindow();
  const visible = overlayWindow ? overlayWindow.isVisible() : false;
  return { success: true, visible };
});

// Forward call/chat state updates from main renderer to overlay
ipcMain.on('overlay-sync-call', (event, data) => {
  overlayCallActive = !!(data && data.active);
  if (overlayWindow && overlayWindow.webContents) {
    overlayWindow.webContents.send('overlay-update-call', data);
  }
  // Auto-hide overlay when call ends
  if (!overlayCallActive) {
    hideOverlayWindow();
  }
});

ipcMain.on('overlay-sync-mute', (event, isMuted) => {
  if (overlayWindow && overlayWindow.webContents) {
    overlayWindow.webContents.send('overlay-update-mute', isMuted);
  }
});

ipcMain.on('overlay-sync-messages', (event, messages) => {
  if (overlayWindow && overlayWindow.webContents) {
    overlayWindow.webContents.send('overlay-update-messages', messages);
  }
});

ipcMain.on('overlay-sync-timer', (event, time) => {
  if (overlayWindow && overlayWindow.webContents) {
    overlayWindow.webContents.send('overlay-update-timer', time);
  }
});

ipcMain.on('overlay-sync-members', (event, members) => {
  if (overlayWindow && overlayWindow.webContents) {
    overlayWindow.webContents.send('overlay-update-members', members);
  }
});

// =================== WINDOW ===================
let mainWindow;
function createWindow() {
  // Build icon — prefer .ico on Windows for proper taskbar icon
  const icoPath = path.join(__dirname, 'icon.ico');
  const pngPath2 = path.join(__dirname, 'icon.png');
  let winIcon = appIcon;
  if (fs.existsSync(icoPath)) {
    try { winIcon = nativeImage.createFromPath(icoPath); } catch (e) {}
  } else if (fs.existsSync(pngPath2)) {
    try { winIcon = nativeImage.createFromPath(pngPath2); } catch (e) {}
  }

  // Ensure we have a valid icon — .ico is best for Windows taskbar
  const icoFinal = path.join(__dirname, 'icon.ico');
  if (!winIcon || winIcon.isEmpty()) {
    if (fs.existsSync(icoFinal)) {
      try { winIcon = nativeImage.createFromPath(icoFinal); } catch (e) {}
    }
  }

  mainWindow = new BrowserWindow({
    width: 1100, height: 700, minWidth: 800, minHeight: 500,
    frame: false, titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a0e3e', symbolColor: '#a78bfa', height: 36 },
    backgroundColor: '#0f0a1a',
    icon: winIcon || path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true
    }
  });

  // Force-set icon after window creation (ensures Windows taskbar picks it up)
  try {
    const taskbarIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
    if (taskbarIcon && !taskbarIcon.isEmpty()) {
      mainWindow.setIcon(taskbarIcon);
    } else if (winIcon && !winIcon.isEmpty()) {
      mainWindow.setIcon(winIcon);
    }
  } catch (e) {
    if (winIcon && !winIcon.isEmpty()) mainWindow.setIcon(winIcon);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('accounts.google.com') || url.includes('firebaseapp.com') || url.includes('googleapis.com') || url.includes('google.com/o/oauth')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500, height: 650, frame: true, titleBarStyle: 'default',
          titleBarOverlay: false, autoHideMenuBar: true, resizable: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true }
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Enable getDisplayMedia — Electron requires this handler for screen capture
  mainWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      // Auto-select entire screen (first source) — user picks via Electron's native picker
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => {
      callback({});
    });
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  mainWindow.on('closed', () => { console.log('Window closed'); mainWindow = null; });
  mainWindow.webContents.on('did-fail-load', (e, code, desc) => { console.error('Load failed:', code, desc); });
  mainWindow.webContents.on('render-process-gone', (e, details) => { console.error('Render process gone:', details); });
}

// =================== SCREEN SHARE IPC ===================
ipcMain.handle('get-screen-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    });
    return sources.map(s => ({
      id: s.id, name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }));
  } catch (e) {
    console.error('Failed to get screen sources:', e);
    return [];
  }
});

// =================== FILE IPC ===================
ipcMain.handle('download-file', async (event, url, filename) => {
  const modsDir = getInstanceModsDir();
  const safeName = filename.replace(/[<>:"/\\|?*]/g, '_');
  const filePath = path.join(modsDir, safeName);
  console.log(`Downloading mod: ${url} -> ${filePath}`);
  console.log(`Mods dir: ${modsDir}`);

  if (!url || !url.startsWith('http')) {
    return { success: false, error: 'Invalid download URL' };
  }

  try {
    // Use net.fetch with redirect follow (Modrinth/CurseForge CDNs redirect)
    const response = await Promise.race([
      net.fetch(url, {
        headers: { 'User-Agent': 'VDeX-Launcher/1.0 (contact@vdex.dev)' },
        redirect: 'follow'
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Download timed out after 120s')), 120000))
    ]);

    if (!response.ok) {
      console.error(`Mod download HTTP error: ${response.status} ${response.statusText}`);
      // If CDN fails, try with https module as fallback
      console.log('Trying fallback download with https...');
      try {
        await httpsDownload(url, filePath);
        const stat = fs.statSync(filePath);
        if (stat.size > 0) {
          console.log(`Mod downloaded (fallback): ${safeName} (${stat.size} bytes)`);
          return { success: true, path: filePath };
        }
      } catch (fbErr) {
        console.error('Fallback download also failed:', fbErr.message);
      }
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    if (buffer.length > 0) {
      console.log(`Mod downloaded: ${safeName} (${buffer.length} bytes)`);
      return { success: true, path: filePath };
    }
    return { success: false, error: 'Downloaded file is empty' };
  } catch (err) {
    console.error('Mod download error:', err.message);
    // Fallback: try https download
    try {
      console.log('Trying fallback download with https...');
      await httpsDownload(url, filePath);
      const stat = fs.statSync(filePath);
      if (stat.size > 0) {
        console.log(`Mod downloaded (fallback): ${safeName} (${stat.size} bytes)`);
        return { success: true, path: filePath };
      }
    } catch (fbErr) {
      console.error('Fallback also failed:', fbErr.message);
    }
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('delete-file', async (event, filename) => {
  const modsDir = getInstanceModsDir();
  const filePath = path.join(modsDir, filename);
  if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return { success: true }; }
  return { success: false, error: 'File not found' };
});

ipcMain.handle('list-mods', async (event) => {
  const modsDir = getInstanceModsDir();
  return fs.readdirSync(modsDir).map(f => {
    const filePath = path.join(modsDir, f);
    const stats = fs.statSync(filePath);
    const disabled = f.endsWith('.disabled');
    return {
      name: f,
      displayName: disabled ? f.replace('.disabled', '') : f,
      size: stats.size,
      path: filePath,
      enabled: !disabled
    };
  });
});

// Toggle mod on/off (rename .jar <-> .jar.disabled)
ipcMain.handle('toggle-mod', async (event, filename) => {
  const modsDir = getInstanceModsDir();
  const filePath = path.join(modsDir, filename);
  if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
  try {
    let newName;
    if (filename.endsWith('.disabled')) {
      newName = filename.replace('.disabled', '');
    } else {
      newName = filename + '.disabled';
    }
    const newPath = path.join(modsDir, newName);
    fs.renameSync(filePath, newPath);
    return { success: true, newName, enabled: !filename.endsWith('.disabled') };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('open-external', async (event, url) => { await shell.openExternal(url); return { success: true }; });
ipcMain.handle('get-mods-path', async (event) => {
  const modsDir = getInstanceModsDir();
  return modsDir;
});

ipcMain.handle('list-directory', async (event, dirName) => {
  const dirPath = dirName === 'mods' ? MODS_DIR : path.join(app.getPath('userData'), dirName);
  ensureDir(dirPath);
  return fs.readdirSync(dirPath).map(f => {
    const stat = fs.statSync(path.join(dirPath, f));
    return { name: f, isDirectory: stat.isDirectory(), size: stat.size, modified: stat.mtime.toISOString() };
  });
});

ipcMain.handle('open-directory', async (event, dirPath) => {
  const resolved = dirPath === 'mods' ? MODS_DIR : path.join(app.getPath('userData'), dirPath);
  ensureDir(resolved);
  await shell.openPath(resolved);
  return { success: true };
});

// =================== MINECRAFT LAUNCHER (Modular) ===================

// Initialize core managers (lazy — they need app.getPath which is ready after 'ready')
let versionManager, javaManager, launchEngine, loaderManager, logManager, clientManager;

function initCoreManagers() {
  const userData = app.getPath('userData');
  versionManager = new VersionManager(MC_DIR);
  javaManager = new JavaManager(userData);
  launchEngine = new LaunchEngine(MC_DIR, getSetting);
  loaderManager = new LoaderManager(MC_DIR, javaManager);
  logManager = new LogManager(userData);
  clientManager = new ClientManager(MC_DIR);

  // Wire up log manager crash detection to notify renderer
  logManager.onCrash((crashInfo) => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('mc-crash', crashInfo);
    }
  });

  // Wire up log manager lines to notify renderer
  logManager.onLog((entry) => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('mc-log', entry);
    }
  });

  // Set mcDir for Java version detection from version JSONs
  javaManager.setMcDir(MC_DIR);

  // Apply custom Java path from settings
  const customJava = getSetting('javaPath', null);
  if (customJava) javaManager.setCustomJavaPath(customJava);
}

// Fetch all Minecraft versions
ipcMain.handle('mc-get-versions', async () => {
  try {
    return await versionManager.getAllVersions();
  } catch (err) {
    console.error('Failed to get versions:', err.message);
    throw err.message;
  }
});

// Check if a version+loader combo is already downloaded
ipcMain.handle('mc-check-installed', async (event, version, loader) => {
  return versionManager.isInstalled(version, loader);
});

// Cancel active download/launch
ipcMain.handle('mc-cancel', async () => {
  return launchEngine.cancel();
});

// Download Minecraft version
ipcMain.handle('mc-download', async (event, version, loader) => {
  if (!version || !version.trim()) {
    return { success: false, error: 'No version selected. Please select a Minecraft version first.' };
  }
  ensureDir(MC_DIR);
  const sender = event.sender;

  try {
    sender.send('mc-progress', { type: 'progress', task: 'Checking Java...', current: 0, total: 100 });
    logManager.addLine('info', 'Checking Java...');

    const javaPath = await javaManager.getJavaForVersion(version, (task, current, total) => {
      sender.send('mc-progress', { type: 'progress', task, current, total });
      logManager.addLine('info', task);
    }, loader);

    if (!fs.existsSync(javaPath)) {
      return { success: false, error: `Java not found at: ${javaPath}` };
    }

    const versionType = versionManager.getVersionType(version);
    logManager.addLine('info', `Downloading MC ${version} (${loader})...`);

    return await launchEngine.downloadVersion(version, loader, sender, javaPath, versionType, javaManager.using32Bit);
  } catch (err) {
    console.error('MC download error:', err);
    logManager.addLine('error', `Download failed: ${err.message}`);
    return { success: false, error: err.message || String(err) };
  }
});

// Launch Minecraft
ipcMain.handle('mc-launch', async (event, version, loader, username) => {
  if (!version || !version.trim()) {
    return { success: false, error: 'No version selected. Please select a Minecraft version first.' };
  }
  // Prevent double launch — if MC is already running, don't start another
  if (launchEngine.activeMcProcess) {
    return { success: false, error: 'Minecraft is already running.' };
  }
  ensureDir(MC_DIR);
  const sender = event.sender;

  try {
    sender.send('mc-progress', { type: 'progress', task: 'Checking Java...', current: 0, total: 100 });
    logManager.clearLogs();
    logManager.addLine('info', `Launching MC ${version} (${loader}) as ${username}...`);

    let javaPath = await javaManager.getJavaForVersion(version, (task, current, total) => {
      sender.send('mc-progress', { type: 'progress', task, current, total });
      logManager.addLine('info', task);
    }, loader);

    if (!fs.existsSync(javaPath)) {
      return { success: false, error: `Java not found at: ${javaPath}. Go to Settings and set your Java path manually.` };
    }

    const versionType = versionManager.getVersionType(version);
    const requiredJava = javaManager.getRequiredJavaMajor(version, loader);
    logManager.addLine('info', `[Java Manager] Required Java: ${requiredJava}`);
    logManager.addLine('info', `[Java Manager] Selected Java Path: ${javaPath}`);

    // Safety check: verify actual Java version matches what Forge needs
    if (loader === 'forge') {
      const actualJavaMajor = javaManager.getJavaMajorVersion(javaPath);
      if (actualJavaMajor && actualJavaMajor !== requiredJava) {
        console.warn(`[Java Manager] WARNING: Java ${actualJavaMajor} selected but Forge needs Java ${requiredJava}! Attempting to fix...`);
        logManager.addLine('warn', `Java ${actualJavaMajor} detected but Forge needs Java ${requiredJava}, auto-correcting...`);
        // Try to get the correct version
        const correctPath = javaManager.getBundledJavaPath(requiredJava);
        if (correctPath) {
          javaPath = correctPath;
          logManager.addLine('info', `Switched to correct Java ${requiredJava}: ${correctPath}`);
        } else {
          // Download the correct version
          try {
            javaPath = await javaManager.downloadJava(requiredJava, (task, current, total) => {
              sender.send('mc-progress', { type: 'progress', task, current, total });
            });
            logManager.addLine('info', `Downloaded and switched to Java ${requiredJava}: ${javaPath}`);
          } catch (dlErr) {
            logManager.addLine('error', `Failed to download Java ${requiredJava}: ${dlErr.message}`);
            return { success: false, error: `Forge requires Java ${requiredJava} but it could not be downloaded: ${dlErr.message}` };
          }
        }
      }
    }

    // Auto-install VDeX Client mods (Fabric/Quilt only)
    if (loader === 'fabric' || loader === 'quilt') {
      try {
        sender.send('mc-progress', { type: 'progress', task: 'Installing VDeX Client mods...', current: 30, total: 100 });
        logManager.addLine('info', '[VDeX Client] Installing enabled client mods...');

        // Helper: fetch JSON from URL
        const fetchJson = (url) => new Promise((resolve, reject) => {
          https.get(url, { headers: { 'User-Agent': 'VDeXLauncher/1.0' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
          }).on('error', reject);
        });

        // Helper: download file with redirect support
        const downloadToFile = (url, destPath) => new Promise((resolve, reject) => {
          const doDownload = (dlUrl, redirects = 0) => {
            if (redirects > 5) return reject(new Error('Too many redirects'));
            https.get(dlUrl, { headers: { 'User-Agent': 'VDeXLauncher/1.0' } }, (res) => {
              if (res.statusCode === 301 || res.statusCode === 302) {
                doDownload(res.headers.location, redirects + 1);
                return;
              }
              const fileStream = fs.createWriteStream(destPath);
              res.pipe(fileStream);
              fileStream.on('finish', () => { fileStream.close(); resolve(); });
              fileStream.on('error', reject);
            }).on('error', reject);
          };
          doDownload(url);
        });

        // Download a single mod JAR + its required dependencies
        const downloadModAndDeps = async (slug, mcVer, mcLoader, destDir, depth = 0) => {
          if (depth > 3) return false; // prevent infinite recursion
          try {
            // ONLY download mods that match the exact MC version — no fallback to wrong versions
            let response = await fetchJson(`https://api.modrinth.com/v2/project/${slug}/version?loaders=["${mcLoader}"]&game_versions=["${mcVer}"]`);
            if (!Array.isArray(response) || response.length === 0) {
              logManager.addLine('warn', `[VDeX Client] No compatible version of ${slug} for MC ${mcVer}, skipping`);
              return false;
            }

            const ver = response[0];
            const file = ver.files && ver.files.find(f => f.primary) || ver.files[0];
            if (!file || !file.url) return false;

            const destPath = path.join(destDir, file.filename);
            if (!fs.existsSync(destPath)) {
              await downloadToFile(file.url, destPath);
              logManager.addLine('info', `[VDeX Client] Downloaded: ${file.filename}`);
            }

            // Download required dependencies
            if (ver.dependencies && ver.dependencies.length > 0) {
              for (const dep of ver.dependencies) {
                if (dep.dependency_type !== 'required') continue;
                const depSlug = dep.project_id;
                if (!depSlug) continue;

                // Check if dependency already exists in mods folder
                const existingFiles = fs.readdirSync(destDir).filter(f => f.endsWith('.jar'));
                // Fetch project info to get the slug name
                try {
                  const projInfo = await fetchJson(`https://api.modrinth.com/v2/project/${depSlug}`);
                  const depName = (projInfo.slug || '').replace(/-/g, '').toLowerCase();
                  const alreadyHave = existingFiles.some(f => f.toLowerCase().includes(depName));
                  if (!alreadyHave) {
                    logManager.addLine('info', `[VDeX Client] Installing dependency: ${projInfo.title || depSlug}`);
                    await downloadModAndDeps(depSlug, mcVer, mcLoader, destDir, depth + 1);
                  }
                } catch (depErr) {
                  logManager.addLine('warn', `[VDeX Client] Dependency ${depSlug} failed: ${depErr.message}`);
                }
              }
            }

            return true;
          } catch (e) {
            console.error(`[VDeX Client] Failed to download ${slug}:`, e.message);
            return false;
          }
        };

        const clientResult = await clientManager.installClientMods(version, loader, downloadModAndDeps, (task, current, total) => {
          sender.send('mc-progress', { type: 'progress', task, current: 30 + Math.round((current / total) * 20), total: 100 });
          logManager.addLine('info', `[VDeX Client] ${task}`);
        });

        if (clientResult.installed.length > 0) {
          logManager.addLine('info', `[VDeX Client] Installed: ${clientResult.installed.join(', ')}`);
        }
        if (clientResult.skipped.length > 0) {
          logManager.addLine('info', `[VDeX Client] Already installed: ${clientResult.skipped.join(', ')}`);
        }
        if (clientResult.failed.length > 0) {
          logManager.addLine('warn', `[VDeX Client] Failed: ${clientResult.failed.join(', ')}`);
        }
      } catch (clientErr) {
        logManager.addLine('warn', `[VDeX Client] Client mod install failed: ${clientErr.message}`);
      }
    }

    // Pass Microsoft auth data if available
    const msAuth = getSetting('msAuth', null);
    const serverOpts = undefined;
    const result = await launchEngine.launchMinecraft(version, loader, username, sender, javaPath, versionType, javaManager.using32Bit, serverOpts, msAuth);

    // Listen for process close to detect crashes
    if (launchEngine.activeMcProcess) {
      const proc = launchEngine.activeMcProcess;

      // Capture stdout/stderr into log manager
      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            logManager.addLine(launchEngine._classifyLogLine(line), line);
          }
        });
      }
      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            logManager.addLine('error', line);
          }
        });
      }

      proc.on('close', (code) => {
        logManager.addLine('info', `Minecraft exited with code ${code}`);
        logManager.handleProcessExit(code);
        logManager.saveToFile();
      });
    }

    return result;
  } catch (err) {
    console.error('MC launch error:', err);
    logManager.addLine('error', `Launch failed: ${err.message}`);
    return { success: false, error: err.message || String(err) };
  }
});

// =================== NEW IPC HANDLERS ===================

// Log management
ipcMain.handle('mc-get-log', async () => {
  return logManager.getLogLines(500);
});

ipcMain.handle('mc-clear-log', async () => {
  logManager.clearLogs();
  return { success: true };
});

// Fix missing libraries (Quick Fix for NoClassDefFoundError, JNI errors, etc.)
ipcMain.handle('mc-fix-libraries', async (event, version, loader) => {
  try {
    logManager.addLine('info', `[Quick Fix] Fixing libraries for ${version} (${loader || 'vanilla'})...`);

    // 1. Ensure vanilla files exist
    await launchEngine._ensureVanillaFiles(version);
    logManager.addLine('info', '[Quick Fix] Vanilla files OK.');

    // 2. For modded versions, ensure all loader libraries
    if (loader && loader !== 'vanilla') {
      const prefix = loader === 'fabric' ? 'fabric-loader' : loader === 'quilt' ? 'quilt-loader' : loader;
      const loaderId = launchEngine._findInstalledVersion(version, prefix);
      if (loaderId) {
        logManager.addLine('info', `[Quick Fix] Checking libraries for ${loaderId}...`);
        await launchEngine._ensureAllLibraries(loaderId);
        logManager.addLine('info', '[Quick Fix] Loader libraries repaired.');
      } else {
        logManager.addLine('info', `[Quick Fix] No ${loader} installation found, checking vanilla libs...`);
      }
    }

    // 3. Always check vanilla version libraries too
    await launchEngine._ensureAllLibraries(version);
    logManager.addLine('info', '[Quick Fix] All libraries verified.');

    return { success: true, message: 'All libraries repaired successfully.' };
  } catch (err) {
    logManager.addLine('error', `[Quick Fix] Library fix failed: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// Smart Fix — AI-powered crash diagnosis and auto-fix
ipcMain.handle('mc-smart-fix', async (event, version, loader) => {
  const sender = event.sender;
  try {
    // 1. Read ALL recent log lines
    const allLogs = logManager.getLogLines(2000);
    logManager.addLine('info', '[Smart Fix] Analyzing crash logs...');
    sender.send('mc-smart-fix-progress', { step: 'diagnosing', message: 'Asking AI to analyze crash...' });

    // 2. Run AI-powered diagnosis (falls back to pattern matching if no key)
    const aiApiKey = getSetting('aiApiKey', '');
    const diagnosis = await CrashDoctor.diagnoseWithAI(allLogs, aiApiKey, version, loader);
    const aiLabel = diagnosis.aiPowered ? ' (AI)' : '';
    logManager.addLine('info', `[Smart Fix${aiLabel}] ${diagnosis.summary}`);
    sender.send('mc-smart-fix-progress', { step: 'diagnosed', message: diagnosis.summary, diagnosis });

    // 3. Get ordered fix plan
    const fixPlan = CrashDoctor.getFixPlan(diagnosis);
    logManager.addLine('info', `[Smart Fix] Fix plan: ${fixPlan.map(f => f.action).join(' → ')}`);

    // 4. Execute fixes in order
    let fixedSomething = false;
    const fixResults = [];

    for (const fix of fixPlan) {
      logManager.addLine('info', `[Smart Fix] Trying: ${fix.action} (${fix.reason})`);
      sender.send('mc-smart-fix-progress', {
        step: 'fixing',
        message: `Fixing: ${fix.reason} — ${fix.detail}`,
        action: fix.action
      });

      try {
        let result = { success: false };

        if (fix.action === 'fix-java') {
          // Reset Java path to auto-detect
          setSetting('javaPath', '');
          logManager.addLine('info', '[Smart Fix] Reset Java path to auto-detect.');
          result = { success: true, detail: 'Java path reset to auto-detect' };

        } else if (fix.action === 'increase-ram') {
          const currentRam = getSetting('ramMax', 2);
          const newRam = Math.min(currentRam + 2, 8);
          setSetting('ramMax', newRam);
          logManager.addLine('info', `[Smart Fix] RAM increased: ${currentRam}GB → ${newRam}GB`);
          result = { success: true, detail: `RAM increased to ${newRam}GB` };

        } else if (fix.action === 'decrease-ram') {
          const currentRam = getSetting('ramMax', 4);
          const newRam = Math.max(Math.floor(currentRam / 2), 1);
          setSetting('ramMax', newRam);
          logManager.addLine('info', `[Smart Fix] RAM decreased: ${currentRam}GB → ${newRam}GB`);
          result = { success: true, detail: `RAM decreased to ${newRam}GB` };

        } else if (fix.action === 'fix-natives') {
          // Download and extract native DLLs (lwjgl, jinput, etc.)
          logManager.addLine('info', '[Smart Fix] Downloading and extracting native libraries...');
          await launchEngine._ensureVanillaFiles(version);
          const vanillaJsonPath = path.join(MC_DIR, 'versions', version, `${version}.json`);
          if (fs.existsSync(vanillaJsonPath)) {
            const vanillaJson = JSON.parse(fs.readFileSync(vanillaJsonPath, 'utf-8'));
            const librariesDir = path.join(MC_DIR, 'libraries');
            const nativesDir = path.join(MC_DIR, 'versions', version, `${version}-natives`);
            if (!fs.existsSync(nativesDir)) fs.mkdirSync(nativesDir, { recursive: true });
            // Clear old (possibly corrupt) natives
            try {
              const existing = fs.readdirSync(nativesDir);
              for (const f of existing) fs.unlinkSync(path.join(nativesDir, f));
            } catch (e) {}
            await launchEngine._extractNatives(vanillaJson, librariesDir, nativesDir);
            const extracted = fs.readdirSync(nativesDir);
            logManager.addLine('info', `[Smart Fix] Extracted ${extracted.length} native files: ${extracted.join(', ')}`);
            result = { success: extracted.length > 0, detail: `Extracted ${extracted.length} native libraries` };
          } else {
            result = { success: false, error: 'Vanilla version JSON not found' };
          }

        } else if (fix.action === 'fix-libraries') {
          // Ensure vanilla files
          await launchEngine._ensureVanillaFiles(version);

          // Fix loader libraries if applicable
          if (loader && loader !== 'vanilla') {
            const prefix = loader === 'fabric' ? 'fabric-loader' : loader === 'quilt' ? 'quilt-loader' : loader;
            const loaderId = launchEngine._findInstalledVersion(version, prefix);
            if (loaderId) {
              await launchEngine._ensureAllLibraries(loaderId);
            }
          }
          // Fix vanilla libraries
          await launchEngine._ensureAllLibraries(version);
          logManager.addLine('info', '[Smart Fix] Libraries repaired.');
          result = { success: true, detail: 'All libraries verified and repaired' };

        } else if (fix.action === 're-download') {
          // Re-download vanilla files
          await launchEngine._ensureVanillaFiles(version);
          // Download full version again
          const javaPath = await javaManager.getJavaForVersion(version, (task, current, total) => {
            sender.send('mc-progress', { type: 'progress', task, current, total });
          }, loader);
          const versionType = versionManager.getVersionType(version);
          const dlResult = await launchEngine.downloadVersion(version, loader, sender, javaPath, versionType, javaManager.using32Bit);
          if (dlResult && dlResult.success) {
            // Also fix libraries after download
            await launchEngine._ensureAllLibraries(version).catch(() => {});
            logManager.addLine('info', '[Smart Fix] Version re-downloaded successfully.');
            result = { success: true, detail: 'Game files re-downloaded' };
          } else {
            result = { success: false, error: dlResult?.error || 'Download failed' };
          }

        } else if (fix.action === 'reinstall-loader') {
          if (loader && loader !== 'vanilla') {
            // Ensure vanilla files first
            await launchEngine._ensureVanillaFiles(version);
            const loaderResult = await loaderManager.installLoader(loader, version);
            if (loaderResult && loaderResult.success) {
              await launchEngine._ensureAllLibraries(version).catch(() => {});
              logManager.addLine('info', `[Smart Fix] ${loader} reinstalled.`);
              result = { success: true, detail: `${loader} reinstalled` };
            } else {
              result = { success: false, error: loaderResult?.error || 'Loader install failed' };
            }
          } else {
            result = { success: true, detail: 'No loader to reinstall (vanilla)' };
          }
        }

        fixResults.push({ action: fix.action, reason: fix.reason, ...result });
        if (result.success) {
          fixedSomething = true;
          break; // Stop after first successful fix
        }
      } catch (err) {
        logManager.addLine('error', `[Smart Fix] ${fix.action} failed: ${err.message}`);
        fixResults.push({ action: fix.action, reason: fix.reason, success: false, error: err.message });
      }
    }

    // 5. Report results
    const report = {
      success: fixedSomething,
      diagnosis: {
        summary: diagnosis.summary,
        causes: diagnosis.causes.slice(0, 5).map(c => ({
          cause: c.cause,
          detail: c.detail,
          confidence: c.confidence
        }))
      },
      fixResults
    };

    if (fixedSomething) {
      logManager.addLine('info', '[Smart Fix] Fix applied successfully! Ready to re-launch.');
      sender.send('mc-smart-fix-progress', { step: 'done', message: 'Fix applied! Re-launching...', report });
    } else {
      logManager.addLine('warn', '[Smart Fix] Could not fix the issue automatically.');
      sender.send('mc-smart-fix-progress', { step: 'failed', message: 'Could not fix automatically. Check logs for details.', report });
    }

    return report;
  } catch (err) {
    logManager.addLine('error', `[Smart Fix] Error: ${err.message}`);
    return { success: false, error: err.message, diagnosis: null, fixResults: [] };
  }
});

// Loader management
ipcMain.handle('mc-install-loader', async (event, type, mcVersion) => {
  try {
    const sender = event.sender;
    sender.send('mc-progress', { type: 'progress', task: `Installing ${type}...`, current: 0, total: 100 });
    logManager.addLine('info', `Installing ${type} for ${mcVersion}...`);

    // Ensure vanilla files exist before installing any loader (they all need vanilla JAR/JSON)
    sender.send('mc-progress', { type: 'progress', task: 'Ensuring vanilla files exist...', current: 5, total: 100 });
    await launchEngine._ensureVanillaFiles(mcVersion);

    const result = await loaderManager.installLoader(type, mcVersion);

    if (result.success) {
      logManager.addLine('info', `${type} installed successfully: ${result.versionId}`);
      sender.send('mc-progress', { type: 'progress', task: `${type} installed!`, current: 100, total: 100 });
    } else {
      logManager.addLine('error', `${type} install failed: ${result.error}`);
    }

    return result;
  } catch (err) {
    logManager.addLine('error', `Loader install error: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mc-get-loaders', async (event, mcVersion) => {
  try {
    return await loaderManager.getAvailableLoaders(mcVersion);
  } catch (err) {
    console.error('Failed to get loaders:', err.message);
    return { fabric: { available: false }, quilt: { available: false }, forge: { available: false }, neoforge: { available: false } };
  }
});

// Java info
ipcMain.handle('mc-get-java-info', async () => {
  return javaManager.getJavaInfo();
});

ipcMain.handle('mc-is-running', async () => {
  return !!(launchEngine && launchEngine.activeMcProcess);
});

// =================== SETTINGS IPC ===================
ipcMain.handle('get-settings', async () => {
  return { ...settings };
});

ipcMain.handle('get-setting', async (event, key, defaultValue) => {
  return getSetting(key, defaultValue);
});

ipcMain.handle('set-setting', async (event, key, value) => {
  setSetting(key, value);
  return { success: true };
});

ipcMain.handle('browse-java', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Java Executable',
    filters: [{ name: 'Java', extensions: ['exe'] }],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// =================== SKIN IPC ===================
ipcMain.handle('select-skin-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Skin Image',
    filters: [{ name: 'Images', extensions: ['png'] }],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    ensureDir(SKINS_DIR);
    const src = result.filePaths[0];
    const dest = path.join(SKINS_DIR, 'custom-skin.png');
    fs.copyFileSync(src, dest);
    return { success: true, path: dest };
  }
  return { success: false };
});

ipcMain.handle('save-skin-from-url', async (event, url) => {
  ensureDir(SKINS_DIR);
  const dest = path.join(SKINS_DIR, 'custom-skin.png');
  try {
    await httpsDownload(url, dest);
    return { success: true, path: dest };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-skin-path', async () => {
  const skinPath = path.join(SKINS_DIR, 'custom-skin.png');
  if (fs.existsSync(skinPath)) return skinPath;
  return null;
});

// =================== WINDOW CONTROL IPC ===================
ipcMain.handle('minimize-to-tray', async () => {
  if (mainWindow) {
    createTray();
    mainWindow.hide();
  }
  return { success: true };
});

ipcMain.handle('restore-window', async () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  return { success: true };
});

ipcMain.handle('update-tray-status', async (event, callStatus) => {
  updateTrayMenu(callStatus);
  return { success: true };
});

ipcMain.handle('show-notification', async (event, title, body) => {
  if (Notification.isSupported()) {
    const notif = new Notification({ title, body });
    notif.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notif.show();
  }
  return { success: true };
});

// =================== FILE SELECTION FOR CHAT ===================
ipcMain.handle('select-file-for-chat', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select File to Send',
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(stat.size) / Math.log(k));
    const size = parseFloat((stat.size / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    return { success: true, path: filePath, name, size };
  }
  return { success: false };
});

// =================== BUG REPORTS ===================
const BUGS_FILE = path.join(app.getPath('userData'), 'bug-reports.json');

function loadBugs() {
  try {
    if (fs.existsSync(BUGS_FILE)) {
      return JSON.parse(fs.readFileSync(BUGS_FILE, 'utf-8'));
    }
  } catch (e) {}
  return { username: null, bugs: [] };
}

function saveBugs(data) {
  fs.writeFileSync(BUGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

ipcMain.handle('bugs-get-all', async () => {
  return loadBugs();
});

ipcMain.handle('bugs-set-username', async (event, username) => {
  const data = loadBugs();
  if (data.username) {
    return { success: false, error: 'Username already set' };
  }
  data.username = username;
  saveBugs(data);
  return { success: true };
});

ipcMain.handle('bugs-submit', async (event, title, issue) => {
  const data = loadBugs();
  if (!data.username) {
    return { success: false, error: 'Please set your reporter name first' };
  }
  const bug = {
    id: `bug_${Date.now()}`,
    title,
    issue,
    reporter: data.username,
    createdAt: new Date().toISOString(),
    status: 'open'
  };
  data.bugs.unshift(bug);
  saveBugs(data);
  return { success: true, bug };
});

ipcMain.handle('bugs-delete', async (event, bugId) => {
  const data = loadBugs();
  data.bugs = data.bugs.filter(b => b.id !== bugId);
  saveBugs(data);
  return { success: true };
});

// =================== SERVER CONFIG ===================
const SERVER_CONFIG_FILE = path.join(app.getPath('userData'), 'server-config.json');

ipcMain.handle('save-server-config', async (event, data) => {
  try {
    fs.writeFileSync(SERVER_CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Launch MC and directly join a server
ipcMain.handle('mc-launch-server', async (event, version, loader, username, serverAddress) => {
  if (!version || !version.trim()) {
    return { success: false, error: 'No version selected. Please select a Minecraft version on the Home page first.' };
  }
  if (!serverAddress || !serverAddress.trim()) {
    return { success: false, error: 'No server address provided.' };
  }
  if (launchEngine.activeMcProcess) {
    return { success: false, error: 'Minecraft is already running.' };
  }

  // Parse server:port
  const parts = serverAddress.split(':');
  const serverHost = parts[0];
  const serverPort2 = parts[1] || '25565';

  ensureDir(MC_DIR);
  const sender = event.sender;

  try {
    sender.send('mc-progress', { type: 'progress', task: 'Checking Java...', current: 0, total: 100 });
    logManager.clearLogs();
    logManager.addLine('info', `Launching MC ${version} (${loader}) as ${username} -> Server: ${serverAddress}`);

    let javaPath = await javaManager.getJavaForVersion(version, (task, current, total) => {
      sender.send('mc-progress', { type: 'progress', task, current, total });
      logManager.addLine('info', task);
    }, loader);

    if (!fs.existsSync(javaPath)) {
      return { success: false, error: `Java not found at: ${javaPath}` };
    }

    // Forge Java version safety check
    if (loader === 'forge') {
      const requiredJava = javaManager.getRequiredJavaMajor(version, loader);
      const actualJavaMajor = javaManager.getJavaMajorVersion(javaPath);
      if (actualJavaMajor && actualJavaMajor !== requiredJava) {
        logManager.addLine('warn', `Java ${actualJavaMajor} detected but Forge needs Java ${requiredJava}, auto-correcting...`);
        const correctPath = javaManager.getBundledJavaPath(requiredJava);
        if (correctPath) {
          javaPath = correctPath;
        } else {
          try {
            javaPath = await javaManager.downloadJava(requiredJava, (task, current, total) => {
              sender.send('mc-progress', { type: 'progress', task, current, total });
            });
          } catch (dlErr) {
            return { success: false, error: `Forge requires Java ${requiredJava} but it could not be downloaded: ${dlErr.message}` };
          }
        }
      }
    }

    const versionType = versionManager.getVersionType(version);

    // Download MC if not already installed
    const isInstalled = versionManager.isInstalled(version, loader);
    if (!isInstalled) {
      sender.send('mc-progress', { type: 'progress', task: 'Downloading Minecraft ' + version + '...', current: 10, total: 100 });
      logManager.addLine('info', `Downloading MC ${version} (${loader}) before server join...`);
      const dlResult = await launchEngine.downloadVersion(version, loader, sender, javaPath, versionType, javaManager.using32Bit);
      if (!dlResult || !dlResult.success) {
        return { success: false, error: 'Failed to download Minecraft: ' + (dlResult?.error || 'Unknown error') };
      }
    }

    // Add server to Minecraft's servers.dat so it shows in multiplayer list
    try {
      addServerToMinecraft(serverAddress.split(':')[0], serverAddress);
      logManager.addLine('info', `Added ${serverAddress} to Minecraft server list`);
    } catch (e) {
      console.warn('Failed to write servers.dat:', e.message);
    }

    const msAuth = getSetting('msAuth', null);
    const launchResult = await launchEngine.launchMinecraft(version, loader, username, sender, javaPath, versionType, javaManager.using32Bit, {
      serverHost,
      serverPort: serverPort2
    }, msAuth);

    if (launchEngine.activeMcProcess) {
      const proc = launchEngine.activeMcProcess;
      if (proc.stdout) {
        proc.stdout.on('data', (data) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) logManager.addLine(launchEngine._classifyLogLine(line), line);
        });
      }
      if (proc.stderr) {
        proc.stderr.on('data', (data) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) logManager.addLine('error', line);
        });
      }
      proc.on('close', (code) => {
        logManager.addLine('info', `Minecraft exited with code ${code}`);
        logManager.handleProcessExit(code);
        logManager.saveToFile();
        // Show launcher again when MC closes
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      });

      // Hide launcher after successful launch
      if (launchResult.success && mainWindow) {
        setTimeout(() => {
          if (mainWindow) mainWindow.hide();
        }, 2000);
      }
    }

    return launchResult;
  } catch (err) {
    console.error('MC server launch error:', err);
    logManager.addLine('error', `Server launch failed: ${err.message}`);
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('load-server-config', async () => {
  try {
    if (fs.existsSync(SERVER_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(SERVER_CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {}
  return null;
});

// =================== WORLD MANAGER ===================
const WORLDS_DIR_DEFAULT = path.join(MC_DIR, 'saves');

function getWorldsDir() {
  return WORLDS_DIR_DEFAULT;
}

ipcMain.handle('worlds-list', async () => {
  const worldsDir = getWorldsDir();
  if (!fs.existsSync(worldsDir)) return [];
  const dirs = fs.readdirSync(worldsDir, { withFileTypes: true }).filter(d => d.isDirectory());
  const worlds = [];
  for (const dir of dirs) {
    const worldPath = path.join(worldsDir, dir.name);
    const levelDat = path.join(worldPath, 'level.dat');
    if (!fs.existsSync(levelDat)) continue;
    const stats = fs.statSync(levelDat);
    const iconPath = path.join(worldPath, 'icon.png');
    let hasIcon = fs.existsSync(iconPath);
    let iconBase64 = null;
    if (hasIcon) {
      try { iconBase64 = 'data:image/png;base64,' + fs.readFileSync(iconPath).toString('base64'); } catch (e) {}
    }
    let sizeBytes = 0;
    try { sizeBytes = getDirSize(worldPath); } catch (e) {}
    worlds.push({
      name: dir.name,
      path: worldPath,
      lastPlayed: stats.mtime.toISOString(),
      size: sizeBytes,
      icon: iconBase64
    });
  }
  worlds.sort((a, b) => new Date(b.lastPlayed) - new Date(a.lastPlayed));
  return worlds;
});

function getDirSize(dirPath) {
  let size = 0;
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) size += getDirSize(fullPath);
    else { try { size += fs.statSync(fullPath).size; } catch (e) {} }
  }
  return size;
}

ipcMain.handle('worlds-rename', async (event, oldName, newName) => {
  const worldsDir = getWorldsDir();
  const oldPath = path.join(worldsDir, oldName);
  const newPath = path.join(worldsDir, newName);
  if (!fs.existsSync(oldPath)) return { success: false, error: 'World not found' };
  if (fs.existsSync(newPath)) return { success: false, error: 'A world with that name already exists' };
  try { fs.renameSync(oldPath, newPath); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('worlds-delete', async (event, worldName) => {
  const worldPath = path.join(getWorldsDir(), worldName);
  if (!fs.existsSync(worldPath)) return { success: false, error: 'World not found' };
  try { fs.rmSync(worldPath, { recursive: true, force: true }); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('worlds-duplicate', async (event, worldName) => {
  const worldsDir = getWorldsDir();
  const srcPath = path.join(worldsDir, worldName);
  if (!fs.existsSync(srcPath)) return { success: false, error: 'World not found' };
  let copyName = worldName + ' - Copy';
  let i = 2;
  while (fs.existsSync(path.join(worldsDir, copyName))) { copyName = worldName + ` - Copy ${i++}`; }
  try { copyDirSync(srcPath, path.join(worldsDir, copyName)); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('worlds-backup', async (event, worldName) => {
  const worldsDir = getWorldsDir();
  const srcPath = path.join(worldsDir, worldName);
  if (!fs.existsSync(srcPath)) return { success: false, error: 'World not found' };
  const backupDir = path.join(app.getPath('userData'), 'backups');
  ensureDir(backupDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupName = `${worldName}_backup_${timestamp}`;
  try { copyDirSync(srcPath, path.join(backupDir, backupName)); return { success: true, backupPath: path.join(backupDir, backupName) }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('worlds-open-folder', async (event, worldName) => {
  const worldPath = path.join(getWorldsDir(), worldName);
  if (fs.existsSync(worldPath)) shell.openPath(worldPath);
  return { success: true };
});

function copyDirSync(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

// =================== SCREENSHOT GALLERY ===================
ipcMain.handle('screenshots-list', async () => {
  const screenshotsDir = path.join(MC_DIR, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) return [];
  const files = fs.readdirSync(screenshotsDir).filter(f => /\.(png|jpg|jpeg|gif|bmp)$/i.test(f));
  const screenshots = [];
  for (const file of files) {
    const filePath = path.join(screenshotsDir, file);
    const stats = fs.statSync(filePath);
    screenshots.push({
      name: file,
      path: filePath,
      date: stats.mtime.toISOString(),
      size: stats.size
    });
  }
  screenshots.sort((a, b) => new Date(b.date) - new Date(a.date));
  return screenshots;
});

ipcMain.handle('screenshots-get-image', async (event, filePath) => {
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return 'data:image/' + mime + ';base64,' + fs.readFileSync(filePath).toString('base64');
});

ipcMain.handle('screenshots-delete', async (event, filePath) => {
  try { fs.unlinkSync(filePath); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('screenshots-open-folder', async () => {
  const screenshotsDir = path.join(MC_DIR, 'screenshots');
  ensureDir(screenshotsDir);
  shell.openPath(screenshotsDir);
  return { success: true };
});

// =================== APP GALLERY (Screenshots & Videos) ===================
const GALLERY_DIR = path.join(app.getPath('userData'), 'gallery');

ipcMain.handle('gallery-list', async () => {
  ensureDir(GALLERY_DIR);
  const files = fs.readdirSync(GALLERY_DIR).filter(f => /\.(png|jpg|jpeg|gif|bmp|webm|mp4)$/i.test(f));
  const items = [];
  for (const file of files) {
    const filePath = path.join(GALLERY_DIR, file);
    const stats = fs.statSync(filePath);
    const ext = path.extname(file).toLowerCase();
    items.push({
      name: file,
      path: filePath,
      date: stats.mtime.toISOString(),
      size: stats.size,
      type: ['.webm', '.mp4'].includes(ext) ? 'video' : 'image'
    });
  }
  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  return items;
});

ipcMain.handle('gallery-get-media', async (event, filePath) => {
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  const isVideo = ['.webm', '.mp4'].includes(ext);
  const mimeType = isVideo ? (ext === '.mp4' ? 'video/mp4' : 'video/webm') : ('image/' + (ext === '.jpg' ? 'jpeg' : ext.replace('.', '')));
  return 'data:' + mimeType + ';base64,' + fs.readFileSync(filePath).toString('base64');
});

ipcMain.handle('gallery-delete', async (event, filePath) => {
  try { fs.unlinkSync(filePath); return { success: true }; } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('gallery-open-folder', async () => {
  ensureDir(GALLERY_DIR);
  shell.openPath(GALLERY_DIR);
  return { success: true };
});

ipcMain.handle('gallery-get-path', async () => {
  ensureDir(GALLERY_DIR);
  return GALLERY_DIR;
});

ipcMain.handle('gallery-save-video', async (event, buffer) => {
  ensureDir(GALLERY_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(GALLERY_DIR, `recording-${timestamp}.webm`);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  if (mainWindow) mainWindow.webContents.send('gallery-capture-done', { type: 'video', path: filePath });
  if (Notification.isSupported()) {
    new Notification({ title: 'Recording Saved', body: 'Video saved to gallery', icon: appIcon || undefined }).show();
  }
  return { success: true, path: filePath };
});

// =================== MICROSOFT AUTH ===================
let msAuthWindow = null;

ipcMain.handle('ms-auth-login', async () => {
  return new Promise((resolve) => {
    if (msAuthWindow) {
      msAuthWindow.focus();
      return resolve({ success: false, error: 'Auth window already open' });
    }

    msAuthWindow = new BrowserWindow({
      width: 520,
      height: 620,
      parent: mainWindow,
      modal: true,
      show: true,
      title: 'Sign in with Microsoft',
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    const clientId = '00000000402b5328'; // Minecraft public client ID

    const authUrl = `https://login.live.com/oauth20_authorize.srf?client_id=${clientId}&response_type=code&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=XboxLive.signin%20offline_access`;

    msAuthWindow.loadURL(authUrl);

    msAuthWindow.webContents.on('will-redirect', async (event, url) => {
      if (url.startsWith('https://login.live.com/oauth20_desktop.srf')) {
        const urlObj = new URL(url);
        const authCode = urlObj.searchParams.get('code');
        const error = urlObj.searchParams.get('error');
        if (msAuthWindow) { msAuthWindow.close(); msAuthWindow = null; }

        if (error || !authCode) {
          return resolve({ success: false, error: error || 'No auth code received' });
        }

        try {
          const tokens = await completeMsAuth(authCode, clientId);
          resolve({ success: true, ...tokens });
        } catch (e) {
          resolve({ success: false, error: e.message || 'Auth failed' });
        }
      }
    });

    msAuthWindow.on('closed', () => {
      msAuthWindow = null;
      resolve({ success: false, error: 'Auth window closed' });
    });
  });
});

async function msHttpPost(hostname, path, body, contentType = 'application/x-www-form-urlencoded') {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const ct = typeof body === 'string' ? contentType : 'application/json';
    const req = https.request({ hostname, port: 443, path, method: 'POST', headers: { 'Content-Type': ct, 'Content-Length': Buffer.byteLength(data), 'Accept': 'application/json' } }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Invalid JSON response: ' + raw.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function completeMsAuth(authCode, clientId) {
  // Step 1: Exchange code for Microsoft token
  const msToken = await msHttpPost('login.live.com', '/oauth20_token.srf',
    `client_id=${clientId}&code=${encodeURIComponent(authCode)}&grant_type=authorization_code&redirect_uri=https://login.live.com/oauth20_desktop.srf`
  );
  if (msToken.error) throw new Error('MS Token error: ' + (msToken.error_description || msToken.error));

  // Step 2: Xbox Live auth
  const xblToken = await msHttpPost('user.auth.xboxlive.com', '/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msToken.access_token },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
  });
  if (!xblToken.Token) throw new Error('Xbox Live auth failed');

  // Step 3: XSTS token
  const xstsToken = await msHttpPost('xsts.auth.xboxlive.com', '/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT'
  });
  if (xstsToken.XErr) {
    const errors = { 2148916233: 'No Xbox account found. Please create one first.', 2148916235: 'Xbox Live is not available in your region.', 2148916238: 'Account belongs to a minor. Add it to a Family.' };
    throw new Error(errors[xstsToken.XErr] || 'XSTS error: ' + xstsToken.XErr);
  }

  const userHash = xstsToken.DisplayClaims.xui[0].uhs;

  // Step 4: Minecraft token
  const mcToken = await msHttpPost('api.minecraftservices.com', '/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${userHash};${xstsToken.Token}`
  });
  if (!mcToken.access_token) throw new Error('Minecraft auth failed');

  // Step 5: Get profile
  const mcProfile = await new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.minecraftservices.com', path: '/minecraft/profile', method: 'GET', headers: { 'Authorization': 'Bearer ' + mcToken.access_token } }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Profile parse failed')); }
      });
    });
    req.on('error', reject);
    req.end();
  });

  if (mcProfile.error || !mcProfile.id) throw new Error(mcProfile.errorMessage || 'No Minecraft profile found. You may not own the game.');

  // Save auth to settings for persistence
  const authData = {
    access_token: mcToken.access_token,
    username: mcProfile.name,
    uuid: mcProfile.id,
    ms_refresh_token: msToken.refresh_token,
    expires_at: Date.now() + (mcToken.expires_in * 1000)
  };
  setSetting('msAuth', authData);

  return authData;
}

// Check stored MS auth
ipcMain.handle('ms-auth-check', async () => {
  const authData = getSetting('msAuth', null);
  if (!authData) return { loggedIn: false };
  // Check if token is still valid (with 5 min buffer)
  if (authData.expires_at && Date.now() < authData.expires_at - 300000) {
    return { loggedIn: true, username: authData.username, uuid: authData.uuid };
  }
  // Try refresh
  if (authData.ms_refresh_token) {
    try {
      const clientId = '00000000402b5328';
      const msToken = await msHttpPost('login.live.com', '/oauth20_token.srf',
        `client_id=${clientId}&refresh_token=${encodeURIComponent(authData.ms_refresh_token)}&grant_type=refresh_token&redirect_uri=https://login.live.com/oauth20_desktop.srf`
      );
      if (msToken.access_token) {
        const tokens = await completeMsAuth_fromMsToken(msToken, clientId);
        return { loggedIn: true, username: tokens.username, uuid: tokens.uuid };
      }
    } catch (e) {
      console.error('MS auth refresh failed:', e.message);
    }
  }
  return { loggedIn: false };
});

async function completeMsAuth_fromMsToken(msToken, clientId) {
  // Steps 2-5 same as completeMsAuth but starting from existing MS token
  const xblToken = await msHttpPost('user.auth.xboxlive.com', '/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msToken.access_token },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
  });
  if (!xblToken.Token) throw new Error('Xbox Live auth failed on refresh');

  const xstsToken = await msHttpPost('xsts.auth.xboxlive.com', '/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT'
  });
  if (xstsToken.XErr) throw new Error('XSTS error on refresh: ' + xstsToken.XErr);

  const userHash = xstsToken.DisplayClaims.xui[0].uhs;

  const mcToken = await msHttpPost('api.minecraftservices.com', '/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${userHash};${xstsToken.Token}`
  });
  if (!mcToken.access_token) throw new Error('MC auth refresh failed');

  const mcProfile = await new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.minecraftservices.com', path: '/minecraft/profile', method: 'GET', headers: { 'Authorization': 'Bearer ' + mcToken.access_token } }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });

  const authData = {
    access_token: mcToken.access_token,
    username: mcProfile.name || 'Player',
    uuid: mcProfile.id || '0',
    ms_refresh_token: msToken.refresh_token,
    expires_at: Date.now() + (mcToken.expires_in * 1000)
  };
  setSetting('msAuth', authData);
  return authData;
}

ipcMain.handle('ms-auth-logout', async () => {
  setSetting('msAuth', null);
  return { success: true };
});

// =================== RESOURCE PACKS ===================
ipcMain.handle('resourcepacks-list', async () => {
  const rpDir = path.join(MC_DIR, 'resourcepacks');
  if (!fs.existsSync(rpDir)) return [];
  const files = fs.readdirSync(rpDir).filter(f => f.endsWith('.zip') || fs.statSync(path.join(rpDir, f)).isDirectory());
  const packs = [];
  for (const file of files) {
    const filePath = path.join(rpDir, file);
    const stats = fs.statSync(filePath);
    packs.push({ name: file, path: filePath, size: stats.size, isDir: stats.isDirectory() });
  }
  return packs;
});

ipcMain.handle('resourcepacks-delete', async (event, name) => {
  const filePath = path.join(MC_DIR, 'resourcepacks', name);
  if (!fs.existsSync(filePath)) return { success: false, error: 'Not found' };
  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) fs.rmSync(filePath, { recursive: true, force: true });
    else fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('resourcepacks-open-folder', async () => {
  const rpDir = path.join(MC_DIR, 'resourcepacks');
  ensureDir(rpDir);
  shell.openPath(rpDir);
  return { success: true };
});

ipcMain.handle('resourcepacks-install', async (event, url, filename) => {
  const rpDir = path.join(MC_DIR, 'resourcepacks');
  ensureDir(rpDir);
  const safeName = filename.replace(/[<>:"/\\|?*]/g, '_');
  const destPath = path.join(rpDir, safeName);
  console.log(`Installing resource pack: ${url} -> ${destPath}`);
  try {
    await dmDownloadFile(url, destPath);
    return { success: true };
  } catch (e) {
    console.error('RP download failed, trying fallback:', e.message);
    try {
      await httpsDownload(url, destPath);
      return { success: true };
    } catch (e2) { return { success: false, error: e2.message }; }
  }
});

// =================== SHADERS ===================
ipcMain.handle('shaders-list', async () => {
  const shaderDir = path.join(MC_DIR, 'shaderpacks');
  if (!fs.existsSync(shaderDir)) return [];
  const files = fs.readdirSync(shaderDir).filter(f => f.endsWith('.zip') || f.endsWith('.txt') === false);
  const shaders = [];
  for (const file of files) {
    const filePath = path.join(shaderDir, file);
    const stats = fs.statSync(filePath);
    if (file === 'OFF' || file.startsWith('.')) continue;
    shaders.push({ name: file, path: filePath, size: stats.size, isDir: stats.isDirectory() });
  }
  return shaders;
});

ipcMain.handle('shaders-delete', async (event, name) => {
  const filePath = path.join(MC_DIR, 'shaderpacks', name);
  if (!fs.existsSync(filePath)) return { success: false, error: 'Not found' };
  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) fs.rmSync(filePath, { recursive: true, force: true });
    else fs.unlinkSync(filePath);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('shaders-open-folder', async () => {
  const shaderDir = path.join(MC_DIR, 'shaderpacks');
  ensureDir(shaderDir);
  shell.openPath(shaderDir);
  return { success: true };
});

ipcMain.handle('shaders-install', async (event, url, filename) => {
  const shaderDir = path.join(MC_DIR, 'shaderpacks');
  ensureDir(shaderDir);
  const safeName = filename.replace(/[<>:"/\\|?*]/g, '_');
  const destPath = path.join(shaderDir, safeName);
  console.log(`Installing shader: ${url} -> ${destPath}`);
  try {
    await dmDownloadFile(url, destPath);
    return { success: true };
  } catch (e) {
    console.error('Shader download failed, trying fallback:', e.message);
    try {
      await httpsDownload(url, destPath);
      return { success: true };
    } catch (e2) { return { success: false, error: e2.message }; }
  }
});

// =================== PERFORMANCE ANALYZER ===================
ipcMain.handle('perf-analyze', async () => {
  const os = require('os');
  const totalRam = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
  const freeRam = Math.round(os.freemem() / (1024 * 1024 * 1024) * 10) / 10;
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || 'Unknown';
  const cpuCores = cpus.length;
  const allocatedRam = getSetting('ramMax', 2);
  const fpsBoost = getSetting('fpsBoost', false);
  const boostProfile = getSetting('boostProfile', 'balanced');
  const jvmArgs = getSetting('jvmArgs', '');
  const modsDir = path.join(app.getPath('userData'), 'mods');
  let modCount = 0;
  try { if (fs.existsSync(modsDir)) modCount = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar')).length; } catch (e) {}

  const recommendations = [];
  if (allocatedRam < 2) recommendations.push({ type: 'warning', text: 'Allocate at least 2GB RAM for smooth gameplay' });
  if (allocatedRam < 4 && modCount > 10) recommendations.push({ type: 'warning', text: `You have ${modCount} mods - consider allocating 4-6GB RAM` });
  if (allocatedRam > totalRam * 0.75) recommendations.push({ type: 'error', text: 'RAM allocation exceeds 75% of system memory - may cause instability' });
  if (!fpsBoost) recommendations.push({ type: 'info', text: 'Enable FPS Boost in Settings for optimized JVM flags' });
  if (modCount > 30) recommendations.push({ type: 'warning', text: `${modCount} mods installed - consider removing unused ones` });
  if (freeRam < 2) recommendations.push({ type: 'error', text: 'Low free system memory - close other applications' });
  if (modCount > 0 && modCount <= 5) recommendations.push({ type: 'info', text: 'Mod count is manageable - performance should be good' });
  if (fpsBoost && boostProfile !== 'max-fps') recommendations.push({ type: 'info', text: 'Try "Max FPS" boost profile for maximum performance' });
  if (recommendations.length === 0) recommendations.push({ type: 'success', text: 'Everything looks good! Your setup is optimized.' });

  return {
    system: { totalRam, freeRam, cpuModel, cpuCores, platform: process.platform, arch: process.arch },
    minecraft: { allocatedRam, fpsBoost, boostProfile, jvmArgs, modCount },
    recommendations
  };
});

// =================== MOD CONFLICT DETECTOR ===================
ipcMain.handle('mods-scan-conflicts', async () => {
  const modsDir = path.join(app.getPath('userData'), 'mods');
  if (!fs.existsSync(modsDir)) return { mods: [], conflicts: [] };
  const modFiles = fs.readdirSync(modsDir).filter(f => f.endsWith('.jar'));
  const mods = modFiles.map(f => {
    const stats = fs.statSync(path.join(modsDir, f));
    return { name: f, size: stats.size, path: path.join(modsDir, f) };
  });

  const conflicts = [];
  const knownConflicts = {
    'optifine': ['sodium', 'iris', 'rubidium'],
    'sodium': ['optifine', 'rubidium', 'magnesium'],
    'lithium': [],
    'starlight': ['phosphor'],
    'phosphor': ['starlight'],
    'fabric-api': [],
    'forge': ['fabric'],
    'iris': ['optifine'],
    'rubidium': ['sodium', 'optifine']
  };

  const modNames = mods.map(m => m.name.toLowerCase());
  for (const mod of mods) {
    const modLower = mod.name.toLowerCase();
    for (const [key, conflictsWith] of Object.entries(knownConflicts)) {
      if (modLower.includes(key)) {
        for (const conflict of conflictsWith) {
          const conflicting = modNames.find(m => m.includes(conflict) && m !== modLower);
          if (conflicting) {
            const existing = conflicts.find(c => (c.mod1.includes(key) && c.mod2.includes(conflict)) || (c.mod1.includes(conflict) && c.mod2.includes(key)));
            if (!existing) {
              conflicts.push({
                mod1: mod.name,
                mod2: mods.find(m => m.name.toLowerCase() === conflicting).name,
                reason: `${key} and ${conflict} are incompatible - they provide the same functionality`,
                severity: 'high'
              });
            }
          }
        }
      }
    }
  }

  return { mods, conflicts };
});

// =================== MODRINTH SEARCH (main process) ===================
ipcMain.handle('modrinth-search', async (event, projectType, query, limit) => {
  try {
    const params = new URLSearchParams({
      query: query || '',
      limit: String(limit || 20),
      facets: JSON.stringify([['project_type:' + projectType]])
    });
    const resp = await net.fetch('https://api.modrinth.com/v2/search?' + params.toString(), {
      headers: { 'User-Agent': 'VDeX-Launcher/1.0' }
    });
    if (!resp.ok) return { error: 'HTTP ' + resp.status };
    return await resp.json();
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('modrinth-versions', async (event, slug) => {
  try {
    const resp = await net.fetch('https://api.modrinth.com/v2/project/' + encodeURIComponent(slug) + '/version?limit=1', {
      headers: { 'User-Agent': 'VDeX-Launcher/1.0' }
    });
    if (!resp.ok) return { error: 'HTTP ' + resp.status };
    return await resp.json();
  } catch (e) { return { error: e.message }; }
});

// =================== THEME SYSTEM ===================
ipcMain.handle('theme-get', async () => {
  return getSetting('theme', 'dark');
});

ipcMain.handle('theme-set', async (event, theme) => {
  setSetting('theme', theme);
  return { success: true };
});

ipcMain.handle('theme-get-custom', async () => {
  return getSetting('customTheme', null);
});

ipcMain.handle('theme-set-custom', async (event, customTheme) => {
  setSetting('customTheme', customTheme);
  return { success: true };
});

// =================== CLIENT MANAGER (Lunar-style) ===================
ipcMain.handle('client-get-mods', async () => {
  return clientManager.getAllMods();
});

ipcMain.handle('client-toggle-mod', async (event, modId, enabled) => {
  return clientManager.toggleMod(modId, enabled);
});

ipcMain.handle('client-get-mod-config', async (event, modId) => {
  return clientManager.getModConfig(modId);
});

ipcMain.handle('client-set-mod-config', async (event, modId, config) => {
  return clientManager.setModConfig(modId, config);
});

ipcMain.handle('client-get-profiles', async () => {
  return clientManager.getProfiles();
});

ipcMain.handle('client-apply-profile', async (event, profileId) => {
  return clientManager.applyProfile(profileId);
});

ipcMain.handle('client-get-cosmetics', async () => {
  return clientManager.getCosmetics();
});

ipcMain.handle('client-set-cosmetic', async (event, type, itemId) => {
  return clientManager.setCosmetic(type, itemId);
});

ipcMain.handle('client-get-hud-layout', async () => {
  return clientManager.getHudLayout();
});

ipcMain.handle('client-set-hud-layout', async (event, layout) => {
  return clientManager.setHudLayout(layout);
});

ipcMain.handle('client-install-mods', async (event, version, loader) => {
  // Download function that fetches from Modrinth
  async function downloadModFromMorinrth(slug, mcVersion, mcLoader, destDir) {
    try {
      const searchUrl = `https://api.modrinth.com/v2/project/${slug}/version?loaders=["${mcLoader}"]&game_versions=["${mcVersion}"]`;
      const response = await new Promise((resolve, reject) => {
        https.get(searchUrl, { headers: { 'User-Agent': 'VDeXLauncher/1.0' } }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(e); }
          });
        }).on('error', reject);
      });

      if (!Array.isArray(response) || response.length === 0) return false;

      const version = response[0];
      const file = version.files && version.files[0];
      if (!file || !file.url) return false;

      const destPath = path.join(destDir, file.filename);
      if (fs.existsSync(destPath)) return true; // Already installed

      await new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(destPath);
        https.get(file.url, { headers: { 'User-Agent': 'VDeXLauncher/1.0' } }, (res) => {
          if (res.statusCode === 302 || res.statusCode === 301) {
            https.get(res.headers.location, { headers: { 'User-Agent': 'VDeXLauncher/1.0' } }, (res2) => {
              res2.pipe(fileStream);
              fileStream.on('finish', () => { fileStream.close(); resolve(); });
            }).on('error', reject);
          } else {
            res.pipe(fileStream);
            fileStream.on('finish', () => { fileStream.close(); resolve(); });
          }
        }).on('error', reject);
      });

      return true;
    } catch (e) {
      console.error(`Failed to download mod ${slug}:`, e.message);
      return false;
    }
  }

  return clientManager.installClientMods(version, loader, downloadModFromMorinrth);
});

ipcMain.handle('client-get-custom-capes', async () => {
  return clientManager.listCustomCapes();
});

ipcMain.handle('client-upload-cape', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return { success: false };
  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  const filename = `custom-cape-${Date.now()}${path.extname(filePath)}`;
  return clientManager.uploadCustomCape(buffer, filename);
});

// =================== INSTANCE MANAGER IPC ===================
const InstanceManager = require('./core/instance-manager');
const instanceManager = new InstanceManager(app.getPath('userData'));

ipcMain.handle('instances-list', () => {
  return instanceManager.getAll();
});

ipcMain.handle('instances-get', (event, id) => {
  return instanceManager.getById(id);
});

ipcMain.handle('instances-create', (event, data) => {
  return instanceManager.create(data);
});

ipcMain.handle('instances-update', (event, id, changes) => {
  return instanceManager.update(id, changes);
});

ipcMain.handle('instances-delete', (event, id) => {
  return instanceManager.delete(id);
});

ipcMain.handle('instances-duplicate', (event, id) => {
  return instanceManager.duplicate(id);
});

ipcMain.handle('instances-list-mods', (event, instanceId) => {
  return instanceManager.syncMods(instanceId) && instanceManager.listModFiles(instanceId);
});

ipcMain.handle('instances-download-mod', async (event, instanceId, url, filename) => {
  const modsDir = instanceManager.getModsDir(instanceId);
  if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
  const safeName = filename.replace(/[<>:"/\\|?*]/g, '_');
  const filePath = path.join(modsDir, safeName);

  if (!url || !url.startsWith('http')) return { success: false, error: 'Invalid URL' };
  try {
    const response = await Promise.race([
      net.fetch(url, { headers: { 'User-Agent': 'VDeX-Launcher/1.0 (contact@vdex.dev)' } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('instances-delete-mod', (event, instanceId, filename) => {
  const modsDir = instanceManager.getModsDir(instanceId);
  const filePath = path.join(modsDir, filename);
  const disabledPath = filePath + '.disabled';
  if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return { success: true }; }
  if (fs.existsSync(disabledPath)) { fs.unlinkSync(disabledPath); return { success: true }; }
  return { success: false, error: 'File not found' };
});

ipcMain.handle('instances-toggle-mod', (event, instanceId, filename) => {
  const modsDir = instanceManager.getModsDir(instanceId);
  const enabledPath = path.join(modsDir, filename.replace('.disabled', ''));
  const disabledPath = enabledPath + '.disabled';
  if (fs.existsSync(enabledPath)) {
    fs.renameSync(enabledPath, disabledPath);
    return { enabled: false };
  } else if (fs.existsSync(disabledPath)) {
    fs.renameSync(disabledPath, enabledPath);
    return { enabled: true };
  }
  return { success: false, error: 'File not found' };
});

ipcMain.handle('instances-get-path', (event, instanceId) => {
  return instanceManager.getInstanceDir(instanceId);
});

ipcMain.handle('instances-open-folder', (event, instanceId) => {
  const dir = instanceManager.getInstanceDir(instanceId);
  if (fs.existsSync(dir)) shell.openPath(dir);
  return { success: true };
});

ipcMain.handle('instances-launch', async (event, instanceId) => {
  const instance = instanceManager.getById(instanceId);
  if (!instance) return { success: false, error: 'Instance not found' };

  if (launchEngine.activeMcProcess) {
    return { success: false, error: 'Minecraft is already running.' };
  }

  ensureDir(MC_DIR);
  const sender = event.sender;

  try {
    sender.send('mc-progress', { type: 'progress', task: 'Checking Java...', current: 0, total: 100 });
    logManager.clearLogs();
    logManager.addLine('info', `Launching instance "${instance.name}" (MC ${instance.version} + ${instance.loader})...`);

    let javaPath = getSetting('javaPath', null) || javaManager.detectJava();
    if (!javaPath || !fs.existsSync(javaPath)) {
      const requiredJava = javaManager.getRequiredJavaMajor(instance.version, instance.loader);
      try {
        javaPath = await javaManager.downloadJava(requiredJava, (task, current, total) => {
          sender.send('mc-progress', { type: 'progress', task, current, total });
        });
      } catch (e) {
        return { success: false, error: `Java not found: ${e.message}` };
      }
    }

    const versionType = versionManager.getVersionType(instance.version);

    // Override mods directory to this instance's folder
    const instanceModsDir = instanceManager.getModsDir(instanceId);

    const msAuth = getSetting('msAuth', null);
    const loginMode = getSetting('mcLoginMode', 'offline');
    const username = loginMode === 'microsoft' && msAuth ? msAuth.username : (getSetting('mcUsername', 'Player') || 'Player');

    const launchOpts = {
      version: instance.version,
      loader: instance.loader,
      username,
      javaPath,
      versionType,
      is32Bit: javaManager.using32Bit,
      serverOpts: null,
      msAuth: loginMode === 'microsoft' ? msAuth : null,
      modsDir: instanceModsDir
    };

    // Update lastPlayed timestamp
    instanceManager.update(instanceId, { lastPlayed: Date.now() });

    return await launchEngine.launchMinecraft(
      launchOpts.version, launchOpts.loader, launchOpts.username, sender,
      launchOpts.javaPath, launchOpts.versionType, launchOpts.is32Bit,
      launchOpts.serverOpts, launchOpts.msAuth
    );
  } catch (err) {
    console.error('[Instance Launch] Error:', err);
    logManager.addLine('error', `Launch failed: ${err.message}`);
    return { success: false, error: err.message || String(err) };
  }
});

// Catch uncaught exceptions from minecraft-launcher-core (it throws inside callbacks)
process.on('uncaughtException', (err) => {
  // EPIPE errors are normal when MC process closes its stdin — ignore silently
  if (err.code === 'EPIPE' || (err.message && err.message.includes('EPIPE'))) {
    console.log('Ignored EPIPE error (normal during MC launch)');
    return;
  }
  console.error('Uncaught Exception:', err.message);
  if (mainWindow && mainWindow.webContents) {
    try {
      mainWindow.webContents.send('mc-progress', { type: 'error', error: err.message });
    } catch (e) {}
  }
});

// =================== SPLASH SCREEN ===================
let splashWindow = null;

function createSplashWindow() {
  const splashIcoPath = path.join(__dirname, 'icon.ico');
  const splashPngPath = path.join(__dirname, 'icon.png');
  let splashIcon = appIcon;
  if (fs.existsSync(splashIcoPath)) {
    try { splashIcon = nativeImage.createFromPath(splashIcoPath); } catch (e) {}
  } else if (fs.existsSync(splashPngPath)) {
    try { splashIcon = nativeImage.createFromPath(splashPngPath); } catch (e) {}
  }

  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    center: true,
    show: false,
    icon: splashIcon || path.join(__dirname, 'icon.ico'),
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splashWindow.loadFile('splash.html');
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
    // Ensure taskbar icon is set
    try {
      const ico = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
      if (ico && !ico.isEmpty()) splashWindow.setIcon(ico);
    } catch (e) {}
  });
  splashWindow.on('closed', () => { splashWindow = null; });
}

// =================== APP LIFECYCLE ===================
app.whenReady().then(async () => {
  // Generate PNG icon from SVG before creating any windows
  await generateAppIcon();

  // Show splash screen immediately
  createSplashWindow();

  // Initialize everything while splash is showing
  initCoreManagers();
  await startLocalServer();

  // Wait for remaining splash duration (minimum 3 seconds total)
  const splashStart = Date.now();
  const SPLASH_DURATION = 5000;

  createWindow();
  // Hide main window until splash is done
  mainWindow.hide();

  const elapsed = Date.now() - splashStart;
  const remaining = Math.max(SPLASH_DURATION - elapsed, 0);

  setTimeout(() => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      // Re-set icon when window is shown (Windows taskbar sometimes needs this)
      try {
        const ico = nativeImage.createFromPath(path.join(__dirname, 'icon.ico'));
        if (ico && !ico.isEmpty()) mainWindow.setIcon(ico);
      } catch (e) {}
    }
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
  }, remaining);

  // Register global hotkey: Shift+Tab to toggle overlay (like Steam)
  globalShortcut.register('Shift+Tab', () => {
    toggleOverlayWindow();
  });

  // Also register Ctrl+Shift+O as alternative
  globalShortcut.register('Ctrl+Shift+O', () => {
    toggleOverlayWindow();
  });

  // Ctrl+P: Capture screenshot — MC window if running, otherwise app/screen
  globalShortcut.register('Ctrl+P', async () => {
    try {
      const galleryDir = path.join(app.getPath('userData'), 'gallery');
      ensureDir(galleryDir);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      let image = null;
      const mcRunning = !!(launchEngine && launchEngine.activeMcProcess);

      if (mcRunning) {
        // Try to capture Minecraft window via desktopCapturer
        const sources = await desktopCapturer.getSources({
          types: ['window', 'screen'],
          thumbnailSize: { width: 3840, height: 2160 },
          fetchWindowIcons: false
        });
        // Look for Minecraft window first (MC window titles: "Minecraft 1.x.x", "Minecraft* 1.x", or LWJGL-based)
        const mcSource = sources.find(s => {
          const n = s.name.toLowerCase();
          return n.includes('minecraft') || n.includes('lwjgl') ||
            (n.includes('java') && !n.includes('javascript') && !n.includes('vdex'));
        });
        if (mcSource && !mcSource.thumbnail.isEmpty()) {
          image = mcSource.thumbnail;
        } else {
          // Fallback: capture the entire primary screen
          const screenSource = sources.find(s => s.id.startsWith('screen:'));
          if (screenSource && !screenSource.thumbnail.isEmpty()) {
            image = screenSource.thumbnail;
          }
        }
      }

      // Fallback: capture the launcher window
      if (!image && mainWindow) {
        image = await mainWindow.webContents.capturePage();
      }

      if (!image || image.isEmpty()) return;

      const label = mcRunning ? 'mc-screenshot' : 'screenshot';
      const filePath = path.join(galleryDir, `${label}-${timestamp}.png`);
      fs.writeFileSync(filePath, image.toPNG());
      if (mainWindow) mainWindow.webContents.send('gallery-capture-done', { type: 'image', path: filePath });
      if (Notification.isSupported()) {
        new Notification({ title: mcRunning ? 'MC Screenshot Saved' : 'Screenshot Saved', body: 'Saved to gallery', icon: appIcon || undefined }).show();
      }
    } catch (e) {
      console.error('Screenshot capture failed:', e);
    }
  });

  // Ctrl+Shift+V: Start video recording — area select or full MC capture
  globalShortcut.register('Ctrl+Shift+V', () => {
    if (!mainWindow) return;
    const mcRunning = !!(launchEngine && launchEngine.activeMcProcess);
    if (mcRunning) {
      // Bring launcher to front briefly for area selection, or start full-screen MC recording
      mainWindow.show();
      mainWindow.focus();
    }
    mainWindow.webContents.send('gallery-start-video-select', { mcRunning });
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Don't quit if main window is just hidden (tray mode)
  if (tray) return;
  if (localServer) localServer.close();
  app.quit();
});
