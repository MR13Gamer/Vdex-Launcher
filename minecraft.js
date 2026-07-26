// Minecraft launcher frontend module — Enhanced with logs, crash detection, loader auto-install

let allVersions = [];
let selectedVersion = '';
let selectedLoader = 'vanilla';
let isDownloading = false;
let isCancelled = false;
let isLaunching = false;
let logsVisible = false;
let logsAutoScroll = true;
let availableLoaders = null;
let mcRunning = false;

const LOADERS = [
  { id: 'vanilla', name: 'Vanilla', icon: 'ri-gamepad-fill' },
  { id: 'forge', name: 'Forge', icon: 'ri-hammer-fill' },
  { id: 'fabric', name: 'Fabric', icon: 'ri-t-shirt-fill' },
  { id: 'quilt', name: 'Quilt', icon: 'ri-quill-pen-fill' },
  { id: 'neoforge', name: 'NeoForge', icon: 'ri-fire-fill' }
];

// Init — fetch versions and set up UI
export async function initMinecraft() {
  renderLoaders();
  await fetchVersions();
  setupProgressListener();
  setupLogListener();
  setupCrashListener();
  setupLogsPanel();
  setupCrashBanner();
}

// Fetch all MC versions from Mojang
async function fetchVersions() {
  const versionSelect = document.getElementById('mc-version-select');
  if (!versionSelect) return;
  versionSelect.innerHTML = '<option value="">Loading versions...</option>';

  try {
    allVersions = await window.electronAPI.getMinecraftVersions();
    renderVersions('release');
  } catch (err) {
    versionSelect.innerHTML = '<option value="">Failed to load versions</option>';
    console.error('Failed to fetch versions:', err);
  }
}

function renderVersions(filter) {
  const versionSelect = document.getElementById('mc-version-select');
  if (!versionSelect) return;

  let filtered = allVersions;
  if (filter === 'release') {
    filtered = allVersions.filter(v => v.type === 'release');
  } else if (filter === 'snapshot') {
    filtered = allVersions.filter(v => v.type === 'snapshot');
  } else if (filter === 'old_beta') {
    filtered = allVersions.filter(v => v.type === 'old_beta');
  } else if (filter === 'old_alpha') {
    filtered = allVersions.filter(v => v.type === 'old_alpha');
  }

  // Group by major version for releases
  if (filter === 'release' && filtered.length > 0) {
    const groups = {};
    for (const v of filtered) {
      const parts = v.id.split('.');
      const group = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : v.id;
      if (!groups[group]) groups[group] = [];
      groups[group].push(v);
    }

    let html = '';
    for (const [group, versions] of Object.entries(groups)) {
      html += `<optgroup label="${group}.x (${versions.length})">`;
      html += versions.map(v => `<option value="${v.id}">${v.id}</option>`).join('');
      html += '</optgroup>';
    }
    versionSelect.innerHTML = html;
  } else {
    versionSelect.innerHTML = filtered.map(v =>
      `<option value="${v.id}">${v.id}${v.type !== 'release' ? ` (${v.type})` : ''}</option>`
    ).join('');
  }

  if (filtered.length > 0) {
    selectedVersion = filtered[0].id;
    versionSelect.value = selectedVersion;
    checkInstallStatus();
    fetchAvailableLoaders(selectedVersion);
  }
}

function renderLoaders() {
  const container = document.getElementById('mc-loader-list');
  if (!container) return;

  container.innerHTML = LOADERS.map(l => `
    <button class="loader-btn ${l.id === selectedLoader ? 'active' : ''}" data-loader="${l.id}">
      <i class="${l.icon}"></i>
      <span>${l.name}</span>
      <span class="loader-badge" id="loader-badge-${l.id}"></span>
    </button>
  `).join('');

  // Add click handlers
  container.querySelectorAll('.loader-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('loader-unavailable')) return;
      selectedLoader = btn.dataset.loader;
      container.querySelectorAll('.loader-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      checkInstallStatus();
      // Persist loader selection
      window.electronAPI?.setSetting('mcLoader', selectedLoader);
    });
  });
}

// Fetch available loaders for the selected MC version
async function fetchAvailableLoaders(mcVersion) {
  if (!mcVersion) return;
  try {
    availableLoaders = await window.electronAPI.getAvailableLoaders(mcVersion);
    updateLoaderBadges();
  } catch (err) {
    console.error('Failed to fetch loaders:', err);
  }
}

function updateLoaderBadges() {
  if (!availableLoaders) return;
  const loaderTypes = ['fabric', 'quilt', 'forge', 'neoforge'];
  let delay = 0;

  for (const type of loaderTypes) {
    const badge = document.getElementById(`loader-badge-${type}`);
    const btn = document.querySelector(`.loader-btn[data-loader="${type}"]`);
    if (!badge || !btn) continue;

    const info = availableLoaders[type];
    if (!info || !info.available) {
      // Animate out unavailable loaders with staggered delay
      const wasAvailable = !btn.classList.contains('loader-unavailable');
      if (wasAvailable) {
        btn.style.transition = 'none';
        btn.style.maxWidth = btn.offsetWidth + 'px';
        btn.style.opacity = '1';
        btn.offsetHeight; // force reflow
        btn.style.transition = '';
        setTimeout(() => {
          btn.classList.add('loader-unavailable');
          // If this was the active loader, fall back to vanilla
          if (selectedLoader === type) {
            selectedLoader = 'vanilla';
            const vanillaBtn = document.querySelector('.loader-btn[data-loader="vanilla"]');
            if (vanillaBtn) vanillaBtn.classList.add('active');
            btn.classList.remove('active');
            checkInstallStatus();
          }
        }, delay);
        delay += 80;
      } else {
        btn.classList.add('loader-unavailable');
      }
      badge.textContent = '';
      badge.className = 'loader-badge';
    } else {
      // Animate in available loaders
      const wasHidden = btn.classList.contains('loader-unavailable');
      btn.classList.remove('loader-unavailable');
      if (wasHidden) {
        btn.classList.add('loader-appear');
        setTimeout(() => btn.classList.remove('loader-appear'), 400);
      }
      if (info.installed) {
        badge.textContent = 'Installed';
        badge.className = 'loader-badge installed';
      } else {
        badge.textContent = '';
        badge.className = 'loader-badge';
      }
    }
  }
}

// Check if current selection is already installed
async function checkInstallStatus() {
  if (!selectedVersion) return;
  const actionBtn = document.getElementById('mc-action-btn');
  const actionText = document.getElementById('mc-action-text');
  const actionIcon = document.getElementById('mc-action-icon');
  if (!actionBtn) return;

  try {
    const installed = await window.electronAPI.checkInstalled(selectedVersion, selectedLoader);
    if (installed) {
      actionBtn.className = 'mc-action-btn enter';
      actionText.textContent = 'Enter Game';
      actionIcon.className = 'ri-play-fill';
      actionBtn.dataset.action = 'launch';
    } else {
      actionBtn.className = 'mc-action-btn download';
      actionText.textContent = 'Download';
      actionIcon.className = 'ri-download-line';
      actionBtn.dataset.action = 'download';
    }
  } catch (err) {
    actionBtn.className = 'mc-action-btn download';
    actionText.textContent = 'Download';
    actionIcon.className = 'ri-download-line';
    actionBtn.dataset.action = 'download';
  }
}

// Handle download or launch
export async function handleAction(username) {
  const actionBtn = document.getElementById('mc-action-btn');
  const actionText = document.getElementById('mc-action-text');
  const actionIcon = document.getElementById('mc-action-icon');
  const progressBar = document.getElementById('mc-progress-bar');
  const progressText = document.getElementById('mc-progress-text');
  const stepIndicator = document.getElementById('mc-step-indicator');

  if (!actionBtn || isDownloading || isLaunching) return;
  if (!selectedVersion) {
    if (progressText) { progressText.style.display = 'block'; progressText.textContent = 'Please select a version first!'; }
    return;
  }

  const action = actionBtn.dataset.action;
  const cancelBtn = document.getElementById('mc-cancel-btn');
  isCancelled = false;

  // Hide crash banner on new action
  hideCrashBanner();

  if (action === 'download') {
    isDownloading = true;
    actionBtn.className = 'mc-action-btn downloading';
    actionText.textContent = 'Downloading...';
    actionIcon.className = 'ri-loader-4-line spinning';
    if (progressBar) progressBar.style.display = 'block';
    if (progressText) progressText.style.display = 'block';
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    if (stepIndicator) { stepIndicator.style.display = 'flex'; setStep('java'); }

    // Auto-install loader if non-vanilla
    if (selectedLoader !== 'vanilla') {
      actionText.textContent = `Installing ${selectedLoader}...`;
      if (progressText) progressText.textContent = `Setting up ${selectedLoader}...`;
      try {
        const loaderResult = await window.electronAPI.installLoader(selectedLoader, selectedVersion);
        if (!loaderResult.success) {
          console.warn(`Loader install warning: ${loaderResult.error}`);
          // Continue anyway — loader might already be installed or not needed for download
        }
      } catch (err) {
        console.warn('Loader install error:', err);
      }
      if (isCancelled) { resetActionButton(actionBtn, actionText, actionIcon, progressBar, progressText); return; }
      actionText.textContent = 'Downloading...';
    }

    if (stepIndicator) setStep('download');
    const result = await window.electronAPI.downloadMinecraft(selectedVersion, selectedLoader);

    if (cancelBtn) cancelBtn.classList.add('hidden');

    if (isCancelled) {
      resetActionButton(actionBtn, actionText, actionIcon, progressBar, progressText);
      return;
    }

    if (result.success) {
      if (progressText) progressText.textContent = 'Download complete! Ready to play.';
      actionBtn.className = 'mc-action-btn enter';
      actionText.textContent = 'Enter Game';
      actionIcon.className = 'ri-play-fill';
      actionBtn.dataset.action = 'launch';
    } else {
      actionText.textContent = 'Download Failed';
      actionIcon.className = 'ri-error-warning-line';
      if (progressText) progressText.textContent = result.error || 'Unknown error';
      setTimeout(() => {
        actionBtn.className = 'mc-action-btn download';
        actionText.textContent = 'Download';
        actionIcon.className = 'ri-download-line';
      }, 3000);
    }

    isDownloading = false;
    if (stepIndicator) stepIndicator.style.display = 'none';
    setTimeout(() => {
      if (progressBar) progressBar.style.display = 'none';
      if (progressText) { progressText.style.display = 'none'; progressText.textContent = ''; }
    }, 5000);

  } else if (action === 'launch') {
    if (isLaunching || mcRunning) return;
    isLaunching = true;
    actionBtn.className = 'mc-action-btn launching';
    actionText.textContent = 'Launching...';
    actionIcon.className = 'ri-loader-4-line spinning';
    if (progressText) { progressText.style.display = 'block'; progressText.textContent = 'Starting Minecraft...'; }
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    if (stepIndicator) { stepIndicator.style.display = 'flex'; setStep('java'); }

    const launchHint = document.getElementById('mc-launch-hint');
    if (launchHint) launchHint.style.display = 'flex';

    // Auto-install loader if non-vanilla and not installed
    if (selectedLoader !== 'vanilla') {
      try {
        const installed = await window.electronAPI.checkInstalled(selectedVersion, selectedLoader);
        if (!installed) {
          actionText.textContent = `Installing ${selectedLoader}...`;
          if (progressText) progressText.textContent = `Setting up ${selectedLoader}...`;
          const loaderResult = await window.electronAPI.installLoader(selectedLoader, selectedVersion);
          if (!loaderResult || !loaderResult.success) {
            isLaunching = false;
            const errMsg = (loaderResult && loaderResult.error) || `Failed to install ${selectedLoader}`;
            if (progressText) progressText.textContent = errMsg;
            actionText.textContent = 'Launch Failed';
            actionBtn.className = 'mc-action-btn';
            actionIcon.className = 'ri-play-fill';
            if (cancelBtn) cancelBtn.classList.add('hidden');
            if (stepIndicator) stepIndicator.style.display = 'none';
            const launchHint = document.getElementById('mc-launch-hint');
            if (launchHint) launchHint.style.display = 'none';
            setTimeout(() => resetActionButton(actionBtn, actionText, actionIcon, progressBar, progressText), 5000);
            return;
          }
        }
      } catch (err) {
        isLaunching = false;
        console.error('Loader install error:', err);
        if (progressText) progressText.textContent = `${selectedLoader} install failed: ${err.message || err}`;
        actionText.textContent = 'Launch Failed';
        actionBtn.className = 'mc-action-btn';
        actionIcon.className = 'ri-play-fill';
        if (cancelBtn) cancelBtn.classList.add('hidden');
        if (stepIndicator) stepIndicator.style.display = 'none';
        setTimeout(() => resetActionButton(actionBtn, actionText, actionIcon, progressBar, progressText), 5000);
        return;
      }
    }

    if (stepIndicator) setStep('launch');

    try {
      const result = await window.electronAPI.launchMinecraft(selectedVersion, selectedLoader, username);

      if (isCancelled) {
        isLaunching = false;
        if (launchHint) launchHint.style.display = 'none';
        if (cancelBtn) cancelBtn.classList.add('hidden');
        if (stepIndicator) stepIndicator.style.display = 'none';
        resetActionButton(actionBtn, actionText, actionIcon, progressBar, progressText);
        return;
      }

      if (result.success) {
        isLaunching = false;
        if (cancelBtn) cancelBtn.classList.add('hidden');
        if (stepIndicator) stepIndicator.style.display = 'none';
        actionBtn.className = 'mc-action-btn launching';
        actionText.textContent = 'Running';
        actionIcon.className = 'ri-play-fill';
        if (progressText) progressText.textContent = 'Minecraft is running!';

        mcRunning = true;
        window.dispatchEvent(new CustomEvent('mc-running-changed', { detail: { running: true } }));

        try {
          const behavior = await window.electronAPI.getSetting('launchBehavior', 'keep-open');
          if (behavior === 'hide-to-tray') {
            await window.electronAPI.minimizeToTray();
          } else if (behavior === 'close') {
            window.close();
          }
        } catch (e) {}
      } else {
        isLaunching = false;
        if (cancelBtn) cancelBtn.classList.add('hidden');
        if (stepIndicator) stepIndicator.style.display = 'none';
        actionText.textContent = 'Launch Failed';
        actionIcon.className = 'ri-error-warning-line';
        if (progressText) { progressText.style.display = 'block'; progressText.textContent = result.error || 'Unknown error. Make sure Java 17+ is installed.'; }
        setTimeout(() => {
          actionBtn.className = 'mc-action-btn enter';
          actionBtn.dataset.action = 'launch';
          actionText.textContent = 'Enter Game';
          actionIcon.className = 'ri-play-fill';
        }, 8000);
      }
    } catch (err) {
      isLaunching = false;
      if (cancelBtn) cancelBtn.classList.add('hidden');
      if (stepIndicator) stepIndicator.style.display = 'none';
      actionText.textContent = 'Launch Failed';
      actionIcon.className = 'ri-error-warning-line';
      if (progressText) { progressText.style.display = 'block'; progressText.textContent = String(err); }
      setTimeout(() => {
        actionBtn.className = 'mc-action-btn enter';
        actionBtn.dataset.action = 'launch';
        actionText.textContent = 'Enter Game';
        actionIcon.className = 'ri-play-fill';
      }, 8000);
    }
  }
}

// Reset button back to its default state after cancel
function resetActionButton(actionBtn, actionText, actionIcon, progressBar, progressText) {
  isDownloading = false;
  isLaunching = false;
  if (progressBar) progressBar.style.display = 'none';
  if (progressText) { progressText.style.display = 'none'; progressText.textContent = ''; }
  const launchHint = document.getElementById('mc-launch-hint');
  if (launchHint) launchHint.style.display = 'none';
  const stepIndicator = document.getElementById('mc-step-indicator');
  if (stepIndicator) stepIndicator.style.display = 'none';
  checkInstallStatus();
}

// Cancel current download/launch
export async function cancelAction() {
  isCancelled = true;
  isDownloading = false;
  try {
    await window.electronAPI.cancelMinecraft();
  } catch (e) {
    console.error('Cancel error:', e);
  }
  const cancelBtn = document.getElementById('mc-cancel-btn');
  if (cancelBtn) cancelBtn.classList.add('hidden');
  const progressBar = document.getElementById('mc-progress-bar');
  const progressText = document.getElementById('mc-progress-text');
  const actionBtn = document.getElementById('mc-action-btn');
  const actionText = document.getElementById('mc-action-text');
  const actionIcon = document.getElementById('mc-action-icon');
  resetActionButton(actionBtn, actionText, actionIcon, progressBar, progressText);
}

// Listen for progress events from main process
function setupProgressListener() {
  window.electronAPI.onMcProgress((data) => {
    const progressFill = document.getElementById('mc-progress-fill');
    const progressText = document.getElementById('mc-progress-text');

    if (data.type === 'progress' && progressFill && data.total > 0) {
      const pct = Math.round((data.current / data.total) * 100);
      progressFill.style.width = `${pct}%`;
      if (progressText) progressText.textContent = `${data.task || 'Downloading'}: ${pct}%`;

      // Update step indicator based on task
      updateStepFromTask(data.task);
    }
    if (data.type === 'error') {
      const cancelBtn = document.getElementById('mc-cancel-btn');
      if (cancelBtn) cancelBtn.classList.add('hidden');
      const launchHint = document.getElementById('mc-launch-hint');
      if (launchHint) launchHint.style.display = 'none';
      const stepIndicator = document.getElementById('mc-step-indicator');
      if (stepIndicator) stepIndicator.style.display = 'none';
      const actionBtn = document.getElementById('mc-action-btn');
      const actionText = document.getElementById('mc-action-text');
      const actionIcon = document.getElementById('mc-action-icon');
      if (actionBtn) {
        actionBtn.className = 'mc-action-btn enter';
        actionBtn.dataset.action = 'launch';
        actionText.textContent = 'Enter Game';
        actionIcon.className = 'ri-play-fill';
      }
      if (progressText) { progressText.style.display = 'block'; progressText.textContent = data.error || 'An error occurred'; }
      isDownloading = false;
    }
    if (data.type === 'close') {
      const cancelBtn = document.getElementById('mc-cancel-btn');
      if (cancelBtn) cancelBtn.classList.add('hidden');
      const actionBtn = document.getElementById('mc-action-btn');
      const actionText = document.getElementById('mc-action-text');
      const actionIcon = document.getElementById('mc-action-icon');
      const launchHint = document.getElementById('mc-launch-hint');
      if (launchHint) launchHint.style.display = 'none';
      const stepIndicator = document.getElementById('mc-step-indicator');
      if (stepIndicator) stepIndicator.style.display = 'none';

      mcRunning = false;
      isLaunching = false;
      window.dispatchEvent(new CustomEvent('mc-running-changed', { detail: { running: false } }));
      try { window.electronAPI.restoreWindow(); } catch (e) {}
      try { window.electronAPI.hideOverlay(); } catch (e) {}

      if (actionBtn) {
        actionBtn.className = 'mc-action-btn enter';
        actionBtn.dataset.action = 'launch';
        actionText.textContent = 'Play Again';
        actionIcon.className = 'ri-play-fill';
        setTimeout(() => {
          if (actionText.textContent === 'Play Again') {
            actionText.textContent = 'Enter Game';
          }
        }, 5000);
      }
    }
  });
}

// =================== LOGS PANEL ===================

function setupLogListener() {
  window.electronAPI.onMcLog((entry) => {
    appendLogLine(entry);
  });
}

function appendLogLine(entry) {
  const output = document.getElementById('mc-logs-output');
  if (!output) return;

  const line = document.createElement('div');
  line.className = `log-line log-${entry.type || 'info'}`;
  const ts = entry.timestamp || new Date().toISOString().substr(11, 8);
  line.textContent = `[${ts}] ${entry.message}`;
  output.appendChild(line);

  // Keep max 1000 lines in DOM
  while (output.children.length > 1000) {
    output.removeChild(output.firstChild);
  }

  // Auto-scroll
  if (logsAutoScroll) {
    output.scrollTop = output.scrollHeight;
  }
}

function setupLogsPanel() {
  const toggleBtn = document.getElementById('mc-logs-toggle');
  const closeBtn = document.getElementById('mc-logs-close');
  const copyBtn = document.getElementById('mc-logs-copy');
  const clearBtn = document.getElementById('mc-logs-clear');
  const logsSection = document.getElementById('mc-logs-section');
  const logsOutput = document.getElementById('mc-logs-output');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      logsVisible = !logsVisible;
      if (logsSection) logsSection.style.display = logsVisible ? 'block' : 'none';
      toggleBtn.classList.toggle('active', logsVisible);

      // Load existing logs when opening
      if (logsVisible && logsOutput && logsOutput.children.length === 0) {
        try {
          const logs = await window.electronAPI.getLog();
          for (const entry of logs) {
            appendLogLine(entry);
          }
        } catch (e) {}
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      logsVisible = false;
      if (logsSection) logsSection.style.display = 'none';
      if (toggleBtn) toggleBtn.classList.remove('active');
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (logsOutput) {
        const text = Array.from(logsOutput.children).map(el => el.textContent).join('\n');
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.innerHTML = '<i class="ri-check-line"></i> Copied';
          setTimeout(() => { copyBtn.innerHTML = '<i class="ri-file-copy-line"></i> Copy'; }, 2000);
        });
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (logsOutput) logsOutput.innerHTML = '';
      try { await window.electronAPI.clearLog(); } catch (e) {}
    });
  }

  // Detect manual scroll to pause auto-scroll
  if (logsOutput) {
    logsOutput.addEventListener('scroll', () => {
      const atBottom = logsOutput.scrollTop + logsOutput.clientHeight >= logsOutput.scrollHeight - 20;
      logsAutoScroll = atBottom;
    });
  }
}

// =================== CRASH DETECTION UI ===================

function setupCrashListener() {
  window.electronAPI.onMcCrash((crashInfo) => {
    showCrashBanner(crashInfo);
  });
}

function showCrashBanner(crashInfo) {
  const banner = document.getElementById('mc-crash-banner');
  const title = document.getElementById('mc-crash-title');
  const message = document.getElementById('mc-crash-message');
  const fixBtn = document.getElementById('mc-crash-fix');
  if (!banner) return;

  if (title) title.textContent = crashInfo.title || 'Minecraft Crashed';
  if (message) message.textContent = crashInfo.message || 'An unknown error occurred. Click Smart Fix to diagnose.';

  // Reset fix button state
  if (fixBtn) { fixBtn.disabled = false; fixBtn.innerHTML = '<i class="ri-brain-fill"></i> Smart Fix'; }

  banner.classList.remove('hidden');

  // Auto-open logs on crash
  if (!logsVisible) {
    const toggleBtn = document.getElementById('mc-logs-toggle');
    if (toggleBtn) toggleBtn.click();
  }
}

function hideCrashBanner() {
  const banner = document.getElementById('mc-crash-banner');
  if (banner) banner.classList.add('hidden');
}

function setupCrashBanner() {
  const dismissBtn = document.getElementById('mc-crash-dismiss');
  const logsBtn = document.getElementById('mc-crash-logs');
  const fixBtn = document.getElementById('mc-crash-fix');

  if (dismissBtn) {
    dismissBtn.addEventListener('click', hideCrashBanner);
  }

  if (logsBtn) {
    logsBtn.addEventListener('click', () => {
      if (!logsVisible) {
        const toggleBtn = document.getElementById('mc-logs-toggle');
        if (toggleBtn) toggleBtn.click();
      }
    });
  }

  if (fixBtn) {
    fixBtn.addEventListener('click', async () => {
      const msg = document.getElementById('mc-crash-message');
      const titleEl = document.getElementById('mc-crash-title');
      const fixBtnEl = document.getElementById('mc-crash-fix');
      const version = selectedVersion;
      const loader = selectedLoader || 'vanilla';

      if (!version) {
        if (msg) msg.textContent = 'No version selected. Select a version first.';
        return;
      }

      // Show diagnosing state
      if (fixBtnEl) { fixBtnEl.disabled = true; fixBtnEl.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> AI Analyzing...'; }
      if (titleEl) titleEl.textContent = 'Smart Fix';
      if (msg) msg.textContent = 'Sending crash logs to AI for analysis...';

      // Listen for progress updates
      const progressHandler = (data) => {
        if (data.step === 'diagnosing') {
          if (msg) msg.textContent = data.message;
          if (fixBtnEl) fixBtnEl.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> AI Analyzing...';
        } else if (data.step === 'diagnosed') {
          const aiTag = data.diagnosis?.aiPowered ? ' [AI]' : '';
          if (msg) msg.textContent = `${aiTag} ${data.message}`;
          if (fixBtnEl) fixBtnEl.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Fixing...';
        } else if (data.step === 'fixing') {
          if (msg) msg.textContent = data.message;
        }
      };
      window.electronAPI.onSmartFixProgress(progressHandler);

      try {
        // Call the smart fix engine
        const report = await window.electronAPI.smartFix(version, loader);

        if (report.success) {
          // Show what was diagnosed and fixed
          const fixedAction = report.fixResults.find(r => r.success);
          if (titleEl) titleEl.textContent = 'Fixed!';
          if (msg) msg.textContent = fixedAction
            ? `${fixedAction.reason}: ${fixedAction.detail || 'Fixed'}. Re-launching...`
            : 'Fix applied. Re-launching...';

          // Brief pause then auto re-launch
          await new Promise(r => setTimeout(r, 1200));
          hideCrashBanner();

          const username = window.getMcUsername ? window.getMcUsername() : 'VDeXPlayer';
          const actionBtn = document.getElementById('mc-action-btn');
          if (actionBtn) {
            actionBtn.dataset.action = 'launch';
            actionBtn.className = 'mc-action-btn enter';
            const actionText = document.getElementById('mc-action-text');
            const actionIcon = document.getElementById('mc-action-icon');
            if (actionText) actionText.textContent = 'Enter Game';
            if (actionIcon) actionIcon.className = 'ri-play-fill';
          }

          const launchResult = await window.electronAPI.launchMinecraft(version, loader, username);
          if (launchResult && launchResult.success) {
            const actionBtn2 = document.getElementById('mc-action-btn');
            const actionText2 = document.getElementById('mc-action-text');
            if (actionBtn2) actionBtn2.className = 'mc-action-btn launching';
            if (actionText2) actionText2.textContent = 'Running';
          } else {
            showCrashBanner({
              title: 'Still Failing',
              message: launchResult?.error || 'Launch failed after fix.',
              quickFix: ''
            });
          }
        } else {
          // Show diagnosis even if fix failed
          if (titleEl) titleEl.textContent = 'Could Not Fix Automatically';
          const diagInfo = report.diagnosis;
          if (diagInfo && diagInfo.causes && diagInfo.causes.length > 0) {
            const topCause = diagInfo.causes[0];
            if (msg) msg.textContent = `${topCause.cause}: ${topCause.detail} (${topCause.confidence}% confidence). Try fixing manually or check logs.`;
          } else {
            if (msg) msg.textContent = report.error || 'Unknown error. Check logs for details.';
          }
        }
      } catch (e) {
        if (titleEl) titleEl.textContent = 'Fix Error';
        if (msg) msg.textContent = `Error: ${e.message || 'Unknown error'}`;
      }

      // Reset button
      if (fixBtnEl) { fixBtnEl.disabled = false; fixBtnEl.innerHTML = '<i class="ri-brain-fill"></i> Smart Fix'; }
    });
  }
}

// =================== STEP INDICATOR ===================

function setStep(activeStep) {
  const steps = document.querySelectorAll('.mc-step');
  let foundActive = false;
  steps.forEach(step => {
    const stepName = step.dataset.step;
    if (stepName === activeStep) {
      step.classList.add('active');
      step.classList.remove('done');
      foundActive = true;
    } else if (!foundActive) {
      step.classList.remove('active');
      step.classList.add('done');
    } else {
      step.classList.remove('active', 'done');
    }
  });
}

function updateStepFromTask(task) {
  if (!task) return;
  const lower = task.toLowerCase();
  if (lower.includes('java') || lower.includes('checking java')) {
    setStep('java');
  } else if (lower.includes('download') || lower.includes('assets') || lower.includes('libraries')) {
    setStep('download');
  } else if (lower.includes('extract') || lower.includes('natives')) {
    setStep('extract');
  } else if (lower.includes('launch') || lower.includes('arguments')) {
    setStep('launch');
  }
}

// =================== EXPORTS ===================

export function getSelectedVersion() { return selectedVersion; }
export function getSelectedLoader() { return selectedLoader; }
export function setSelectedVersion(v) { selectedVersion = v; checkInstallStatus(); fetchAvailableLoaders(v); }
export function isMcRunning() { return mcRunning; }

// Version filter (release/snapshot/old_beta/old_alpha/all)
export function filterVersions(type) {
  renderVersions(type);
}
