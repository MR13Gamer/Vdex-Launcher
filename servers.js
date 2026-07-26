// Server Hosting UI Module
// Integrates with Aternos for free MC server hosting
// Server configs stored in localStorage + embedded Aternos panel

const STORAGE_KEY = 'vdex-servers';
const ATERNOS_URL = 'https://aternos.org';

let servers = [];
let currentServerId = null;
let aternosWebview = null;
let editingServerId = null;

// =================== PERSISTENCE ===================

function loadServers() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    servers = data ? JSON.parse(data) : [];
  } catch (e) {
    servers = [];
  }
  return servers;
}

function saveServers() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

function getServer(id) {
  return servers.find(s => s.id === id);
}

// =================== INIT ===================

export function initServers() {
  loadServers();
  renderServerList();
  attachServerListeners();
  // Auto-load Aternos webview on init (it's the default tab now)
  initAternosWebview();
}

function attachServerListeners() {
  // Sub-tab switching
  document.querySelectorAll('.servers-subtab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.stab;
      document.querySelectorAll('.servers-subtab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.servers-subtab-content').forEach(c => c.classList.remove('active'));
      const content = document.getElementById(`subtab-${target}`);
      if (content) content.classList.add('active');

      // Hide dashboard when switching tabs
      document.getElementById('server-dashboard-view')?.classList.add('hidden');

      // Ensure webview is loaded when switching to Aternos panel
      if (target === 'aternos-panel' && !aternosWebview) {
        initAternosWebview();
      }
    });
  });

  // Open Aternos panel button (in my-servers view)
  document.getElementById('open-aternos-btn')?.addEventListener('click', () => {
    switchToAternosPanel();
  });

  // Create server button
  document.getElementById('create-server-btn')?.addEventListener('click', () => {
    showWizard();
  });

  // Back from dashboard
  document.getElementById('server-dash-back')?.addEventListener('click', () => {
    hideDashboard();
  });

  // Dashboard: Manage on Aternos
  document.getElementById('dash-manage-aternos')?.addEventListener('click', () => {
    switchToAternosPanel('https://aternos.org/servers/');
  });

  // Dashboard: Copy IP
  document.getElementById('dash-copy-ip')?.addEventListener('click', () => {
    if (!currentServerId) return;
    const server = getServer(currentServerId);
    if (!server) return;
    const addr = server.address || '';
    navigator.clipboard.writeText(addr).then(() => {
      const btn = document.getElementById('dash-copy-ip');
      btn.innerHTML = '<i class="ri-check-line"></i> Copied!';
      setTimeout(() => { btn.innerHTML = '<i class="ri-file-copy-line"></i> Copy Server IP'; }, 2000);
    });
  });

  // Dashboard: Copy address button
  document.getElementById('copy-server-addr-btn')?.addEventListener('click', () => {
    if (!currentServerId) return;
    const server = getServer(currentServerId);
    if (!server) return;
    const addr = server.address || '';
    navigator.clipboard.writeText(addr).then(() => {
      const icon = document.querySelector('#copy-server-addr-btn i');
      if (icon) {
        icon.className = 'ri-check-line';
        setTimeout(() => { icon.className = 'ri-file-copy-line'; }, 1500);
      }
    });
  });

  // Dashboard: Edit server info
  document.getElementById('dash-edit-server')?.addEventListener('click', () => {
    if (!currentServerId) return;
    showEditModal(currentServerId);
  });

  // Dashboard: Start on Aternos
  document.getElementById('server-start-btn')?.addEventListener('click', () => {
    switchToAternosPanel('https://aternos.org/servers/');
  });

  // Dashboard: Join server (launch MC and connect)
  document.getElementById('server-join-btn')?.addEventListener('click', () => {
    if (!currentServerId) return;
    const server = getServer(currentServerId);
    if (!server || !server.address) {
      alert('No server address configured. Edit the server to add an address.');
      return;
    }
    joinServer(server);
  });

  // Dashboard: Delete server
  document.getElementById('server-delete-btn')?.addEventListener('click', () => {
    if (!currentServerId) return;
    if (!confirm('Delete this server? This cannot be undone.')) return;
    servers = servers.filter(s => s.id !== currentServerId);
    saveServers();
    currentServerId = null;
    hideDashboard();
    renderServerList();
  });

  // Aternos floating bar: Save server
  document.getElementById('aternos-save-server')?.addEventListener('click', () => {
    if (!detectedServerAddress) return;
    // Check if already saved
    const existing = servers.find(s => s.address === detectedServerAddress);
    if (existing) {
      const btn = document.getElementById('aternos-save-server');
      if (btn) { btn.innerHTML = '<i class="ri-check-line"></i> Already saved'; setTimeout(() => { btn.innerHTML = '<i class="ri-save-line"></i> Save Server'; }, 2000); }
      return;
    }
    const server = {
      id: `server_${Date.now()}`,
      name: detectedServerAddress.split('.')[0] || 'Aternos Server',
      address: detectedServerAddress,
      platform: 'java',
      software: 'Aternos',
      version: 'Latest',
      maxPlayers: 20,
      hosting: 'aternos',
      createdAt: new Date().toISOString()
    };
    servers.push(server);
    saveServers();
    renderServerList();
    const btn = document.getElementById('aternos-save-server');
    if (btn) { btn.innerHTML = '<i class="ri-check-line"></i> Saved!'; setTimeout(() => { btn.innerHTML = '<i class="ri-save-line"></i> Save Server'; }, 2000); }
  });

  // Aternos floating bar: Play (join server)
  document.getElementById('aternos-play-server')?.addEventListener('click', () => {
    if (!detectedServerAddress) return;
    // Save if not already saved
    let server = servers.find(s => s.address === detectedServerAddress);
    if (!server) {
      server = {
        id: `server_${Date.now()}`,
        name: detectedServerAddress.split('.')[0] || 'Aternos Server',
        address: detectedServerAddress,
        platform: 'java',
        software: 'Aternos',
        version: 'Latest',
        maxPlayers: 20,
        hosting: 'aternos',
        createdAt: new Date().toISOString()
      };
      servers.push(server);
      saveServers();
      renderServerList();
    }
    joinServer(server);
  });

  // Aternos browser nav
  document.getElementById('aternos-back')?.addEventListener('click', () => {
    if (aternosWebview) aternosWebview.goBack();
  });
  document.getElementById('aternos-forward')?.addEventListener('click', () => {
    if (aternosWebview) aternosWebview.goForward();
  });
  document.getElementById('aternos-reload')?.addEventListener('click', () => {
    if (aternosWebview) aternosWebview.reload();
  });
  document.getElementById('aternos-home')?.addEventListener('click', () => {
    if (aternosWebview) aternosWebview.loadURL(ATERNOS_URL);
  });
  document.getElementById('aternos-external')?.addEventListener('click', () => {
    if (aternosWebview) {
      try { window.electronAPI.openExternal(aternosWebview.getURL()); } catch (e) {}
    } else {
      try { window.electronAPI.openExternal(ATERNOS_URL); } catch (e) {}
    }
  });
}

// =================== ATERNOS WEBVIEW ===================

function initAternosWebview(url) {
  const container = document.getElementById('aternos-webview-container');
  if (!container) return;

  // Remove existing webview if any
  if (aternosWebview) {
    aternosWebview.remove();
  }

  const webview = document.createElement('webview');
  webview.setAttribute('src', url || ATERNOS_URL);
  webview.setAttribute('class', 'aternos-webview');
  webview.setAttribute('partition', 'persist:aternos');
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  container.appendChild(webview);
  aternosWebview = webview;

  const loading = document.getElementById('aternos-loading');

  webview.addEventListener('did-start-loading', () => {
    if (loading) loading.classList.add('active');
  });

  webview.addEventListener('did-stop-loading', () => {
    if (loading) loading.classList.remove('active');
  });

  webview.addEventListener('did-navigate', (e) => {
    updateUrlBar(e.url);
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    updateUrlBar(e.url);
  });

  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    // Load new URLs inside the same webview
    if (e.url && e.url.includes('aternos.org')) {
      webview.loadURL(e.url);
    } else {
      try { window.electronAPI.openExternal(e.url); } catch (err) {}
    }
  });

  webview.addEventListener('dom-ready', () => {
    if (loading) loading.classList.remove('active');
    // Inject custom CSS to make Aternos look better embedded
    webview.insertCSS(`
      body { background: #0f0a1a !important; }
      .page-header-navigation, .footer { display: none !important; }
    `).catch(() => {});
    // Start polling for server info
    startServerDetection();
  });
}

let serverDetectionInterval = null;
let detectedServerAddress = '';

function startServerDetection() {
  if (serverDetectionInterval) clearInterval(serverDetectionInterval);
  serverDetectionInterval = setInterval(detectServerFromWebview, 3000);
  detectServerFromWebview(); // immediate first check
}

async function detectServerFromWebview() {
  if (!aternosWebview) return;
  try {
    // Inject JS to extract server address and status from the Aternos page
    const result = await aternosWebview.executeJavaScript(`
      (function() {
        // Try to get server address from the server page
        const addrEl = document.querySelector('.dns-text, .server-ip, [data-hostname]');
        const statusEl = document.querySelector('.status-label, .statuslabel-label');
        const serverNameEl = document.querySelector('.server-name, .navigation-server-name');
        let address = '';
        if (addrEl) {
          address = addrEl.textContent?.trim() || addrEl.getAttribute('data-hostname') || '';
        }
        // Fallback: look for .aternos.me in any visible text
        if (!address) {
          const allText = document.body?.innerText || '';
          const match = allText.match(/([\\w-]+\\.aternos\\.(?:me|host)(?::\\d+)?)/);
          if (match) address = match[1];
        }
        const status = statusEl ? statusEl.textContent?.trim().toLowerCase() : '';
        const serverName = serverNameEl ? serverNameEl.textContent?.trim() : '';
        return { address, status, serverName };
      })()
    `);

    const bar = document.getElementById('aternos-server-bar');
    const addrSpan = document.getElementById('aternos-detected-address');
    const statusSpan = document.getElementById('aternos-server-status');

    if (result && result.address && result.address.includes('aternos')) {
      detectedServerAddress = result.address;
      if (bar) bar.classList.remove('hidden');
      if (addrSpan) addrSpan.textContent = result.address;
      if (statusSpan) {
        const isOnline = result.status.includes('online') || result.status.includes('ready');
        statusSpan.textContent = isOnline ? 'Online' : 'Offline';
        statusSpan.className = `aternos-server-status ${isOnline ? 'online' : 'offline'}`;
      }
    }
  } catch (e) {
    // Page not ready or navigation in progress
  }
}

function updateUrlBar(url) {
  const urlText = document.getElementById('aternos-url-text');
  if (urlText && url) {
    try {
      const parsed = new URL(url);
      urlText.textContent = parsed.hostname + parsed.pathname;
    } catch (e) {
      urlText.textContent = url;
    }
  }
}

function switchToAternosPanel(url) {
  // Switch to Aternos tab
  document.querySelectorAll('.servers-subtab').forEach(t => t.classList.remove('active'));
  document.querySelector('.servers-subtab[data-stab="aternos-panel"]')?.classList.add('active');
  document.querySelectorAll('.servers-subtab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('subtab-aternos-panel')?.classList.add('active');
  document.getElementById('server-dashboard-view')?.classList.add('hidden');

  if (!aternosWebview) {
    initAternosWebview(url);
  } else if (url) {
    aternosWebview.loadURL(url);
  }
}

// =================== RENDER SERVER LIST ===================

function renderServerList() {
  const grid = document.getElementById('servers-grid');
  if (!grid) return;

  if (servers.length === 0) {
    grid.innerHTML = `
      <div class="servers-empty">
        <i class="ri-server-line"></i>
        <h3>No servers yet</h3>
        <p>Add your Aternos server to start playing</p>
        <button class="create-server-empty-btn" id="create-server-empty-btn">
          <i class="ri-add-line"></i> New Server
        </button>
      </div>
    `;
    document.getElementById('create-server-empty-btn')?.addEventListener('click', () => showWizard());
    return;
  }

  grid.innerHTML = servers.map(s => {
    const serverAddress = s.address || 'Not configured';
    return `
    <div class="server-card" data-server-id="${s.id}">
      <div class="server-card-header">
        <div class="server-card-icon"><i class="ri-sword-fill"></i></div>
        <div>
          <div class="server-card-name">${escapeHtml(s.name)}</div>
          <div class="server-card-software">Aternos</div>
        </div>
      </div>
      <div class="server-card-address"><i class="ri-link"></i> ${escapeHtml(serverAddress)}</div>
      <div class="server-card-buttons">
        <button class="server-manage-btn" data-server-id="${s.id}"><i class="ri-settings-3-line"></i> Details</button>
        <button class="server-join-card-btn" data-server-id="${s.id}" data-address="${escapeHtml(serverAddress)}"><i class="ri-login-box-fill"></i> Join</button>
        <button class="server-play-btn" data-server-id="${s.id}" data-address="${escapeHtml(serverAddress)}"><i class="ri-file-copy-line"></i> Copy IP</button>
      </div>
    </div>
  `;
  }).join('');

  // Card click → dashboard
  grid.querySelectorAll('.server-manage-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showDashboard(btn.dataset.serverId);
    });
  });

  // Aternos button → open panel
  grid.querySelectorAll('.server-aternos-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchToAternosPanel('https://aternos.org/servers/');
    });
  });

  // Join server from card
  grid.querySelectorAll('.server-join-card-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const serverId = btn.dataset.serverId;
      const server = getServer(serverId);
      if (server) joinServer(server);
    });
  });

  // Copy IP
  grid.querySelectorAll('.server-play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const address = btn.dataset.address;
      if (address && address !== 'Not configured') {
        navigator.clipboard.writeText(address).then(() => {
          btn.innerHTML = '<i class="ri-check-line"></i> Copied!';
          setTimeout(() => { btn.innerHTML = '<i class="ri-file-copy-line"></i> Copy IP'; }, 2000);
        });
      }
    });
  });

  // Card click → dashboard
  grid.querySelectorAll('.server-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      showDashboard(card.dataset.serverId);
    });
  });
}

// =================== SERVER DASHBOARD ===================

function showDashboard(serverId) {
  const server = getServer(serverId);
  if (!server) return;
  currentServerId = serverId;

  // Hide subtabs content, show dashboard
  document.querySelectorAll('.servers-subtab-content').forEach(c => c.classList.remove('active'));
  const dash = document.getElementById('server-dashboard-view');
  if (dash) dash.classList.remove('hidden');

  // Deselect subtabs
  document.querySelectorAll('.servers-subtab').forEach(t => t.classList.remove('active'));

  // Fill dashboard
  document.getElementById('dash-server-name').textContent = server.name;
  document.getElementById('dash-server-info').textContent = `Aternos | ${server.address || 'No address'}`;
  document.getElementById('conn-java-address').textContent = server.address || 'Not configured';
  const dashPlatform = document.getElementById('dash-platform');
  if (dashPlatform) dashPlatform.textContent = 'Java';
  const dashSoftware = document.getElementById('dash-software');
  if (dashSoftware) dashSoftware.textContent = 'Aternos';
  const dashVersion = document.getElementById('dash-version');
  if (dashVersion) dashVersion.textContent = server.version || 'Latest';
  const dashMaxPlayers = document.getElementById('dash-max-players');
  if (dashMaxPlayers) dashMaxPlayers.textContent = server.maxPlayers || 20;
  const dashCreated = document.getElementById('dash-created');
  if (dashCreated) dashCreated.textContent = server.createdAt ? new Date(server.createdAt).toLocaleDateString() : '-';
}

function hideDashboard() {
  document.getElementById('server-dashboard-view')?.classList.add('hidden');
  // Show My Servers tab
  document.querySelectorAll('.servers-subtab').forEach(t => t.classList.remove('active'));
  document.querySelector('.servers-subtab[data-stab="my-servers"]')?.classList.add('active');
  document.getElementById('subtab-my-servers')?.classList.add('active');
  currentServerId = null;
  renderServerList();
}

// =================== EDIT MODAL ===================

function showEditModal(serverId) {
  const server = getServer(serverId);
  if (!server) return;
  editingServerId = serverId;

  document.querySelector('.server-edit-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'server-wizard server-edit-modal';
  modal.innerHTML = `
    <div class="server-wizard-content">
      <h3 class="wizard-title">Edit Server</h3>
      <div class="wizard-form-group">
        <label>Server Name</label>
        <input type="text" id="edit-server-name" value="${escapeHtml(server.name)}" maxlength="30" />
      </div>
      <div class="wizard-form-group">
        <label>Server Address</label>
        <input type="text" id="edit-server-address" value="${escapeHtml(server.address || '')}" placeholder="yourserver.aternos.me" />
      </div>
      <div class="wizard-form-group">
        <label>Max Players</label>
        <input type="number" id="edit-max-players" value="${server.maxPlayers || 20}" min="1" max="100" />
      </div>
      <div class="wizard-actions">
        <button class="wizard-btn secondary" id="edit-cancel">Cancel</button>
        <button class="wizard-btn primary" id="edit-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  document.getElementById('edit-cancel')?.addEventListener('click', () => modal.remove());
  document.getElementById('edit-save')?.addEventListener('click', () => {
    const name = document.getElementById('edit-server-name')?.value.trim();
    const address = document.getElementById('edit-server-address')?.value.trim();
    const maxPlayers = parseInt(document.getElementById('edit-max-players')?.value) || 20;
    if (!name) return;

    server.name = name;
    server.address = address;
    server.maxPlayers = maxPlayers;
    saveServers();
    modal.remove();
    showDashboard(serverId);
  });
}

// =================== ADD SERVER ===================

function showWizard() {
  document.querySelector('.server-wizard')?.remove();

  const modal = document.createElement('div');
  modal.className = 'server-wizard';
  modal.innerHTML = `
    <div class="server-wizard-content">
      <h3 class="wizard-title"><i class="ri-add-line"></i> New Server</h3>
      <p class="wizard-subtitle">Add your Aternos server to the launcher</p>
      <div class="wizard-form-group">
        <label>Server Name</label>
        <input type="text" id="wizard-server-name" placeholder="My Minecraft Server" maxlength="30" autofocus />
      </div>
      <div class="wizard-form-group">
        <label>Aternos Server Address</label>
        <input type="text" id="wizard-aternos-address" placeholder="yourserver.aternos.me" />
      </div>
      <div class="wizard-aternos-hint" style="margin-top:12px;padding:10px 14px;background:rgba(139,92,246,0.1);border-radius:10px;border:1px solid rgba(139,92,246,0.15);font-size:12px;color:#a78bfa;">
        <i class="ri-information-line"></i> Enter your real Aternos address. You can start and manage your server from the Aternos Panel tab.
      </div>
      <div class="wizard-actions">
        <button class="wizard-btn secondary" id="wizard-cancel">Cancel</button>
        <button class="wizard-btn primary" id="wizard-create"><i class="ri-add-line"></i> Add Server</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  document.getElementById('wizard-cancel')?.addEventListener('click', () => modal.remove());

  document.getElementById('wizard-create')?.addEventListener('click', () => {
    const name = document.getElementById('wizard-server-name')?.value.trim();
    const address = document.getElementById('wizard-aternos-address')?.value.trim();

    if (!name) {
      document.getElementById('wizard-server-name')?.focus();
      return;
    }
    if (!address) {
      document.getElementById('wizard-aternos-address')?.focus();
      return;
    }

    // Check duplicate name
    if (servers.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      alert('A server with this name already exists.');
      return;
    }

    const server = {
      id: `server_${Date.now()}`,
      name: name,
      address: address,
      platform: 'java',
      software: 'Aternos',
      version: 'Latest',
      maxPlayers: 20,
      hosting: 'aternos',
      createdAt: new Date().toISOString()
    };

    servers.push(server);
    saveServers();
    renderServerList();
    modal.remove();

    // Switch to Aternos panel so user can start the server
    switchToAternosPanel();
  });
}

// =================== JOIN SERVER ===================

async function joinServer(server) {
  if (!server.address || server.address === 'Not configured') {
    alert('Server address not configured. Edit the server to add an address first.');
    return;
  }

  // Get the current MC version and loader from the home page selectors
  const versionSelect = document.getElementById('mc-version-select');
  const version = versionSelect?.value;
  if (!version) {
    alert('Please select a Minecraft version on the Home page first.');
    return;
  }

  // Try to get current loader selection from home page
  const activeLoader = document.querySelector('.mc-loader-card.selected');
  const loader = activeLoader?.dataset?.loader || 'vanilla';

  // Get username
  const username = window.getMcUsername ? window.getMcUsername() : 'VDeXPlayer';

  // Show joining status
  const joinBtn = document.getElementById('server-join-btn');
  if (joinBtn) {
    joinBtn.disabled = true;
    joinBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Launching...';
  }

  try {
    const result = await window.electronAPI.launchMinecraftServer(version, loader, username, server.address);
    if (result && result.success) {
      if (joinBtn) {
        joinBtn.innerHTML = '<i class="ri-check-line"></i> Launched!';
        setTimeout(() => {
          joinBtn.disabled = false;
          joinBtn.innerHTML = '<i class="ri-login-box-fill"></i> Join Server';
        }, 3000);
      }
    } else {
      alert(`Failed to launch: ${result?.error || 'Unknown error'}`);
      if (joinBtn) {
        joinBtn.disabled = false;
        joinBtn.innerHTML = '<i class="ri-login-box-fill"></i> Join Server';
      }
    }
  } catch (err) {
    alert(`Launch error: ${err.message || err}`);
    if (joinBtn) {
      joinBtn.disabled = false;
      joinBtn.innerHTML = '<i class="ri-login-box-fill"></i> Join Server';
    }
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
