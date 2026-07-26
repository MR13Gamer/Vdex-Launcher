const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  downloadFile: (url, filename, version, loader) => ipcRenderer.invoke('download-file', url, filename, version, loader),
  deleteFile: (filename, version, loader) => ipcRenderer.invoke('delete-file', filename, version, loader),
  listMods: (version, loader) => ipcRenderer.invoke('list-mods', version, loader),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getModsPath: (version, loader) => ipcRenderer.invoke('get-mods-path', version, loader),
  listDirectory: (dirName) => ipcRenderer.invoke('list-directory', dirName),
  openDirectory: (dirPath) => ipcRenderer.invoke('open-directory', dirPath),
  // Minecraft launcher
  getMinecraftVersions: () => ipcRenderer.invoke('mc-get-versions'),
  checkInstalled: (version, loader) => ipcRenderer.invoke('mc-check-installed', version, loader),
  downloadMinecraft: (version, loader) => ipcRenderer.invoke('mc-download', version, loader),
  launchMinecraft: (version, loader, username) => ipcRenderer.invoke('mc-launch', version, loader, username),
  cancelMinecraft: () => ipcRenderer.invoke('mc-cancel'),
  onMcProgress: (callback) => ipcRenderer.on('mc-progress', (event, data) => callback(data)),
  // Logs
  getLog: () => ipcRenderer.invoke('mc-get-log'),
  clearLog: () => ipcRenderer.invoke('mc-clear-log'),
  onMcLog: (callback) => ipcRenderer.on('mc-log', (event, data) => callback(data)),
  onMcCrash: (callback) => ipcRenderer.on('mc-crash', (event, data) => callback(data)),
  fixLibraries: (version, loader) => ipcRenderer.invoke('mc-fix-libraries', version, loader),
  smartFix: (version, loader) => ipcRenderer.invoke('mc-smart-fix', version, loader),
  onSmartFixProgress: (callback) => ipcRenderer.on('mc-smart-fix-progress', (event, data) => callback(data)),
  // Loaders
  installLoader: (type, mcVersion) => ipcRenderer.invoke('mc-install-loader', type, mcVersion),
  getAvailableLoaders: (mcVersion) => ipcRenderer.invoke('mc-get-loaders', mcVersion),
  // Java info
  getJavaInfo: () => ipcRenderer.invoke('mc-get-java-info'),
  isMcRunning: () => ipcRenderer.invoke('mc-is-running'),
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getSetting: (key, defaultValue) => ipcRenderer.invoke('get-setting', key, defaultValue),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  browseJava: () => ipcRenderer.invoke('browse-java'),
  // Skin manager
  selectSkinFile: () => ipcRenderer.invoke('select-skin-file'),
  saveSkinFromUrl: (url) => ipcRenderer.invoke('save-skin-from-url', url),
  getSkinPath: () => ipcRenderer.invoke('get-skin-path'),
  // Window control / Tray
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  restoreWindow: () => ipcRenderer.invoke('restore-window'),
  updateTrayStatus: (callStatus) => ipcRenderer.invoke('update-tray-status', callStatus),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  // Overlay
  showOverlay: () => ipcRenderer.invoke('show-overlay'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  toggleOverlay: () => ipcRenderer.invoke('toggle-overlay'),
  onOverlayAction: (callback) => ipcRenderer.on('overlay-action', (event, data) => callback(data)),
  syncOverlayCall: (data) => ipcRenderer.send('overlay-sync-call', data),
  syncOverlayMute: (isMuted) => ipcRenderer.send('overlay-sync-mute', isMuted),
  syncOverlayMessages: (messages) => ipcRenderer.send('overlay-sync-messages', messages),
  syncOverlayTimer: (time) => ipcRenderer.send('overlay-sync-timer', time),
  syncOverlayMembers: (members) => ipcRenderer.send('overlay-sync-members', members),
  // Screen share
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  // File selection for chat
  selectFileForChat: () => ipcRenderer.invoke('select-file-for-chat'),
  // Server config
  saveServerConfig: (data) => ipcRenderer.invoke('save-server-config', data),
  loadServerConfig: () => ipcRenderer.invoke('load-server-config'),
  // Launch MC and join a server directly
  launchMinecraftServer: (version, loader, username, serverAddress) => ipcRenderer.invoke('mc-launch-server', version, loader, username, serverAddress),
  // Bug reports
  getBugs: () => ipcRenderer.invoke('bugs-get-all'),
  setBugsUsername: (username) => ipcRenderer.invoke('bugs-set-username', username),
  submitBug: (title, issue) => ipcRenderer.invoke('bugs-submit', title, issue),
  deleteBug: (bugId) => ipcRenderer.invoke('bugs-delete', bugId),
  // World Manager
  listWorlds: () => ipcRenderer.invoke('worlds-list'),
  renameWorld: (oldName, newName) => ipcRenderer.invoke('worlds-rename', oldName, newName),
  deleteWorld: (name) => ipcRenderer.invoke('worlds-delete', name),
  duplicateWorld: (name) => ipcRenderer.invoke('worlds-duplicate', name),
  backupWorld: (name) => ipcRenderer.invoke('worlds-backup', name),
  openWorldFolder: (name) => ipcRenderer.invoke('worlds-open-folder', name),
  // Screenshots
  listScreenshots: () => ipcRenderer.invoke('screenshots-list'),
  getScreenshotImage: (filePath) => ipcRenderer.invoke('screenshots-get-image', filePath),
  deleteScreenshot: (filePath) => ipcRenderer.invoke('screenshots-delete', filePath),
  openScreenshotsFolder: () => ipcRenderer.invoke('screenshots-open-folder'),
  // Resource Packs
  listResourcePacks: () => ipcRenderer.invoke('resourcepacks-list'),
  deleteResourcePack: (name) => ipcRenderer.invoke('resourcepacks-delete', name),
  openResourcePacksFolder: () => ipcRenderer.invoke('resourcepacks-open-folder'),
  installResourcePack: (url, filename) => ipcRenderer.invoke('resourcepacks-install', url, filename),
  // Shaders
  listShaders: () => ipcRenderer.invoke('shaders-list'),
  deleteShader: (name) => ipcRenderer.invoke('shaders-delete', name),
  openShadersFolder: () => ipcRenderer.invoke('shaders-open-folder'),
  installShader: (url, filename) => ipcRenderer.invoke('shaders-install', url, filename),
  // Performance
  analyzePerformance: () => ipcRenderer.invoke('perf-analyze'),
  // Mod Conflicts
  scanModConflicts: () => ipcRenderer.invoke('mods-scan-conflicts'),
  // Modrinth API (main process)
  modrinthSearch: (projectType, query, limit) => ipcRenderer.invoke('modrinth-search', projectType, query, limit),
  modrinthVersions: (slug) => ipcRenderer.invoke('modrinth-versions', slug),
  // Themes
  getTheme: () => ipcRenderer.invoke('theme-get'),
  setTheme: (theme) => ipcRenderer.invoke('theme-set', theme),
  getCustomTheme: () => ipcRenderer.invoke('theme-get-custom'),
  setCustomTheme: (customTheme) => ipcRenderer.invoke('theme-set-custom', customTheme),
  // App Gallery (screenshots & videos)
  galleryList: () => ipcRenderer.invoke('gallery-list'),
  galleryGetMedia: (filePath) => ipcRenderer.invoke('gallery-get-media', filePath),
  galleryDelete: (filePath) => ipcRenderer.invoke('gallery-delete', filePath),
  galleryOpenFolder: () => ipcRenderer.invoke('gallery-open-folder'),
  galleryGetPath: () => ipcRenderer.invoke('gallery-get-path'),
  gallerySaveVideo: (buffer) => ipcRenderer.invoke('gallery-save-video', buffer),
  onGalleryCaptureDone: (callback) => ipcRenderer.on('gallery-capture-done', (event, data) => callback(data)),
  onGalleryStartVideoSelect: (callback) => ipcRenderer.on('gallery-start-video-select', (event, data) => callback(data || {})),
  // Mod toggle
  toggleMod: (filename) => ipcRenderer.invoke('toggle-mod', filename),
  // Microsoft Auth
  msAuthLogin: () => ipcRenderer.invoke('ms-auth-login'),
  msAuthCheck: () => ipcRenderer.invoke('ms-auth-check'),
  msAuthLogout: () => ipcRenderer.invoke('ms-auth-logout'),
  // VDeX Client (Lunar-style)
  clientGetMods: () => ipcRenderer.invoke('client-get-mods'),
  clientToggleMod: (modId, enabled) => ipcRenderer.invoke('client-toggle-mod', modId, enabled),
  clientGetModConfig: (modId) => ipcRenderer.invoke('client-get-mod-config', modId),
  clientSetModConfig: (modId, config) => ipcRenderer.invoke('client-set-mod-config', modId, config),
  clientGetProfiles: () => ipcRenderer.invoke('client-get-profiles'),
  clientApplyProfile: (profileId) => ipcRenderer.invoke('client-apply-profile', profileId),
  clientGetCosmetics: () => ipcRenderer.invoke('client-get-cosmetics'),
  clientSetCosmetic: (type, itemId) => ipcRenderer.invoke('client-set-cosmetic', type, itemId),
  clientGetHudLayout: () => ipcRenderer.invoke('client-get-hud-layout'),
  clientSetHudLayout: (layout) => ipcRenderer.invoke('client-set-hud-layout', layout),
  clientInstallMods: (version, loader) => ipcRenderer.invoke('client-install-mods', version, loader),
  clientGetCustomCapes: () => ipcRenderer.invoke('client-get-custom-capes'),
  clientUploadCape: () => ipcRenderer.invoke('client-upload-cape'),
  // Instance Manager
  instancesList: () => ipcRenderer.invoke('instances-list'),
  instancesGet: (id) => ipcRenderer.invoke('instances-get', id),
  instancesCreate: (data) => ipcRenderer.invoke('instances-create', data),
  instancesUpdate: (id, changes) => ipcRenderer.invoke('instances-update', id, changes),
  instancesDelete: (id) => ipcRenderer.invoke('instances-delete', id),
  instancesDuplicate: (id) => ipcRenderer.invoke('instances-duplicate', id),
  instancesListMods: (instanceId) => ipcRenderer.invoke('instances-list-mods', instanceId),
  instancesDownloadMod: (instanceId, url, filename) => ipcRenderer.invoke('instances-download-mod', instanceId, url, filename),
  instancesDeleteMod: (instanceId, filename) => ipcRenderer.invoke('instances-delete-mod', instanceId, filename),
  instancesToggleMod: (instanceId, filename) => ipcRenderer.invoke('instances-toggle-mod', instanceId, filename),
  instancesGetPath: (instanceId) => ipcRenderer.invoke('instances-get-path', instanceId),
  instancesOpenFolder: (instanceId) => ipcRenderer.invoke('instances-open-folder', instanceId),
  instancesLaunch: (instanceId) => ipcRenderer.invoke('instances-launch', instanceId)
});
