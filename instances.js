// instances.js — Instance Manager renderer
// Handles: create/edit/delete instances, browse Modrinth mods per instance, launch

const MODRINTH_API = 'https://api.modrinth.com/v2';

let allInstances = [];
let currentInstanceId = null; // which instance is open in the detail view
let modSearchTimeout = null;

// =================== INIT ===================
export function initInstances() {
  renderInstancesPage();
  setupInstanceEventListeners();
}

// =================== LOAD & RENDER LIST ===================
async function renderInstancesPage() {
  try {
    allInstances = await window.electronAPI.instancesList();
  } catch (e) {
    allInstances = [];
  }
  renderInstanceGrid();
}

function renderInstanceGrid() {
  const grid = document.getElementById('instances-grid');
  if (!grid) return;

  if (allInstances.length === 0) {
    grid.innerHTML = `
      <div class="instances-empty">
        <i class="ri-stack-line"></i>
        <h3>No Instances Yet</h3>
        <p>Create your first Minecraft instance to get started.</p>
        <button class="inst-create-btn-hero" id="inst-create-hero-btn">
          <i class="ri-add-line"></i> Create Instance
        </button>
      </div>`;
    document.getElementById('inst-create-hero-btn')?.addEventListener('click', openCreateModal);
    return;
  }

  grid.innerHTML = allInstances.map(inst => `
    <div class="instance-card" data-id="${inst.id}" style="--inst-color: ${inst.color}">
      <div class="instance-card-header">
        <div class="instance-icon">${inst.icon}</div>
        <div class="instance-card-actions">
          <button class="inst-card-btn inst-play-btn" data-id="${inst.id}" title="Launch">
            <i class="ri-play-fill"></i>
          </button>
          <button class="inst-card-btn inst-edit-btn" data-id="${inst.id}" title="Edit">
            <i class="ri-settings-3-line"></i>
          </button>
          <button class="inst-card-btn inst-dupe-btn" data-id="${inst.id}" title="Duplicate">
            <i class="ri-file-copy-line"></i>
          </button>
          <button class="inst-card-btn inst-del-btn" data-id="${inst.id}" title="Delete">
            <i class="ri-delete-bin-line"></i>
          </button>
        </div>
      </div>
      <div class="instance-card-body">
        <h3 class="instance-name">${escHtml(inst.name)}</h3>
        <div class="instance-tags">
          <span class="inst-tag">${escHtml(inst.version)}</span>
          <span class="inst-tag inst-tag-loader">${capitalize(inst.loader)}</span>
          ${inst.mods.length ? `<span class="inst-tag inst-tag-mods">${inst.mods.length} mod${inst.mods.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
        ${inst.description ? `<p class="instance-desc">${escHtml(inst.description)}</p>` : ''}
        <div class="instance-meta">
          ${inst.lastPlayed ? `<span><i class="ri-time-line"></i> ${timeAgo(inst.lastPlayed)}</span>` : '<span><i class="ri-time-line"></i> Never played</span>'}
        </div>
      </div>
      <button class="instance-open-btn" data-id="${inst.id}">
        <i class="ri-folder-open-line"></i> Manage Mods
      </button>
    </div>
  `).join('');

  // Bind card buttons
  grid.querySelectorAll('.inst-play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); launchInstance(btn.dataset.id); });
  });
  grid.querySelectorAll('.inst-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(btn.dataset.id); });
  });
  grid.querySelectorAll('.inst-dupe-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); duplicateInstance(btn.dataset.id); });
  });
  grid.querySelectorAll('.inst-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteInstance(btn.dataset.id); });
  });
  grid.querySelectorAll('.instance-open-btn').forEach(btn => {
    btn.addEventListener('click', () => openInstanceDetail(btn.dataset.id));
  });
}

// =================== DETAIL VIEW (mods) ===================
async function openInstanceDetail(instanceId) {
  currentInstanceId = instanceId;
  const inst = allInstances.find(i => i.id === instanceId);
  if (!inst) return;

  document.getElementById('instances-list-view').style.display = 'none';
  document.getElementById('instances-detail-view').style.display = '';

  document.getElementById('inst-detail-name').textContent = inst.name;
  document.getElementById('inst-detail-badge-version').textContent = inst.version;
  document.getElementById('inst-detail-badge-loader').textContent = capitalize(inst.loader);

  // Reset mod search
  document.getElementById('inst-mod-search-input').value = '';
  document.getElementById('inst-mod-search-results').innerHTML = '';

  await refreshInstalledMods();

  // Pre-fill version/loader filters for Modrinth search
  await populateModrinthVersionFilter(inst.version);
  document.getElementById('inst-modrinth-loader').value = inst.loader === 'vanilla' ? '' : inst.loader;
}

function closeInstanceDetail() {
  currentInstanceId = null;
  document.getElementById('instances-list-view').style.display = '';
  document.getElementById('instances-detail-view').style.display = 'none';
}

async function refreshInstalledMods() {
  if (!currentInstanceId) return;
  const container = document.getElementById('inst-installed-mods');
  container.innerHTML = '<div class="inst-loading"><i class="ri-loader-4-line ri-spin"></i> Loading mods...</div>';

  let mods = [];
  try {
    mods = await window.electronAPI.instancesListMods(currentInstanceId);
  } catch (e) {
    mods = [];
  }

  if (!mods || mods.length === 0) {
    container.innerHTML = `<div class="inst-no-mods"><i class="ri-puzzle-line"></i> No mods installed yet. Search Modrinth above to add mods.</div>`;
    return;
  }

  container.innerHTML = mods.map(m => `
    <div class="inst-mod-row" data-filename="${escHtml(m.name)}">
      <div class="inst-mod-row-info">
        <span class="inst-mod-row-name ${m.enabled ? '' : 'disabled'}">${escHtml(m.displayName)}</span>
        <span class="inst-mod-row-size">${formatBytes(m.size)}</span>
      </div>
      <div class="inst-mod-row-actions">
        <button class="inst-mod-toggle" data-filename="${escHtml(m.name)}" title="${m.enabled ? 'Disable' : 'Enable'}">
          <i class="ri-${m.enabled ? 'eye-fill' : 'eye-off-line'}"></i>
        </button>
        <button class="inst-mod-del" data-filename="${escHtml(m.name)}" title="Delete">
          <i class="ri-delete-bin-line"></i>
        </button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.inst-mod-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleInstalledMod(btn.dataset.filename));
  });
  container.querySelectorAll('.inst-mod-del').forEach(btn => {
    btn.addEventListener('click', () => deleteInstalledMod(btn.dataset.filename));
  });
}

async function toggleInstalledMod(filename) {
  if (!currentInstanceId) return;
  await window.electronAPI.instancesToggleMod(currentInstanceId, filename);
  await refreshInstalledMods();
}

async function deleteInstalledMod(filename) {
  if (!currentInstanceId) return;
  if (!confirm(`Delete ${filename}?`)) return;
  await window.electronAPI.instancesDeleteMod(currentInstanceId, filename);
  await refreshInstalledMods();
}

// =================== MODRINTH SEARCH ===================
async function searchModrinthForInstance(query) {
  const inst = allInstances.find(i => i.id === currentInstanceId);
  if (!inst) return;

  const version = document.getElementById('inst-modrinth-version').value || inst.version;
  const loader = document.getElementById('inst-modrinth-loader').value || '';

  const resultsEl = document.getElementById('inst-mod-search-results');
  resultsEl.innerHTML = '<div class="inst-loading"><i class="ri-loader-4-line ri-spin"></i> Searching Modrinth...</div>';

  try {
    const facets = [['project_type:mod']];
    if (version) facets.push([`versions:${version}`]);
    if (loader) facets.push([`categories:${loader}`]);

    const params = new URLSearchParams({
      query: query || '',
      limit: 20,
      facets: JSON.stringify(facets)
    });

    const resp = await fetch(`${MODRINTH_API}/search?${params}`, {
      headers: { 'User-Agent': 'VDeX-Launcher/1.0 (contact@vdex.dev)' }
    });
    const data = await resp.json();
    renderModrinthResults(data.hits || []);
  } catch (e) {
    resultsEl.innerHTML = `<div class="inst-error"><i class="ri-error-warning-line"></i> Search failed: ${e.message}</div>`;
  }
}

function renderModrinthResults(mods) {
  const resultsEl = document.getElementById('inst-mod-search-results');

  if (mods.length === 0) {
    resultsEl.innerHTML = '<div class="inst-no-mods"><i class="ri-search-line"></i> No mods found.</div>';
    return;
  }

  resultsEl.innerHTML = mods.map(mod => `
    <div class="inst-search-mod-card">
      <div class="inst-search-mod-icon">
        ${mod.icon_url ? `<img src="${mod.icon_url}" alt="" onerror="this.style.display='none'">` : '<i class="ri-puzzle-fill"></i>'}
      </div>
      <div class="inst-search-mod-info">
        <strong>${escHtml(mod.title)}</strong>
        <p>${escHtml(mod.description?.substring(0, 80) || '')}${mod.description?.length > 80 ? '...' : ''}</p>
        <div class="inst-search-mod-meta">
          <span><i class="ri-download-line"></i> ${formatDownloads(mod.downloads)}</span>
          <span><i class="ri-user-line"></i> ${escHtml(mod.author)}</span>
          ${mod.categories?.slice(0, 2).map(c => `<span class="inst-tag">${c}</span>`).join('') || ''}
        </div>
      </div>
      <button class="inst-add-mod-btn" data-slug="${escHtml(mod.slug)}" data-title="${escHtml(mod.title)}">
        <i class="ri-add-line"></i> Add
      </button>
    </div>
  `).join('');

  resultsEl.querySelectorAll('.inst-add-mod-btn').forEach(btn => {
    btn.addEventListener('click', () => addModToInstance(btn.dataset.slug, btn.dataset.title, btn));
  });
}

async function addModToInstance(slug, title, btn) {
  if (!currentInstanceId) return;
  const inst = allInstances.find(i => i.id === currentInstanceId);
  if (!inst) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';

  try {
    const version = document.getElementById('inst-modrinth-version').value || inst.version;
    const loader = document.getElementById('inst-modrinth-loader').value || '';

    // Fetch versions filtered by MC version + loader
    let apiUrl = `${MODRINTH_API}/project/${slug}/version`;
    const qp = [];
    if (version) qp.push(`game_versions=["${version}"]`);
    if (loader) qp.push(`loaders=["${loader}"]`);
    if (qp.length) apiUrl += '?' + qp.join('&');

    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'VDeX-Launcher/1.0 (contact@vdex.dev)' }
    });
    const versions = await resp.json();

    if (!Array.isArray(versions) || versions.length === 0) {
      // Fallback: try without loader filter
      const resp2 = await fetch(`${MODRINTH_API}/project/${slug}/version${version ? `?game_versions=["${version}"]` : ''}`, {
        headers: { 'User-Agent': 'VDeX-Launcher/1.0 (contact@vdex.dev)' }
      });
      const versions2 = await resp2.json();
      if (!Array.isArray(versions2) || versions2.length === 0) {
        showInstToast(`No compatible version found for ${title}`, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="ri-add-line"></i> Add';
        return;
      }
      return downloadModVersion(versions2[0], slug, title, btn);
    }

    await downloadModVersion(versions[0], slug, title, btn);
  } catch (e) {
    showInstToast(`Failed to add ${title}: ${e.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-add-line"></i> Add';
  }
}

async function downloadModVersion(ver, slug, title, btn) {
  const file = ver.files?.find(f => f.primary) || ver.files?.[0];
  if (!file?.url) {
    showInstToast(`No download file found for ${title}`, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-add-line"></i> Add';
    return;
  }

  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Downloading...';

  const result = await window.electronAPI.instancesDownloadMod(currentInstanceId, file.url, file.filename);
  if (result.success) {
    showInstToast(`${title} added!`, 'success');
    btn.innerHTML = '<i class="ri-check-line"></i> Added';
    await refreshInstalledMods();
    // Reload instance list to update mod count
    allInstances = await window.electronAPI.instancesList();
  } else {
    showInstToast(`Failed: ${result.error}`, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="ri-add-line"></i> Add';
  }
}

// =================== CREATE / EDIT MODAL ===================
function openCreateModal() {
  const modal = document.getElementById('inst-create-modal');
  if (!modal) return;
  // Reset form
  document.getElementById('inst-form-title').textContent = 'Create Instance';
  document.getElementById('inst-form-id').value = '';
  document.getElementById('inst-form-name').value = '';
  document.getElementById('inst-form-version').value = '';
  document.getElementById('inst-form-loader').value = 'fabric';
  document.getElementById('inst-form-icon').value = '🎮';
  document.getElementById('inst-form-desc').value = '';
  document.getElementById('inst-form-color').value = '#7c3aed';
  populateVersionSelect();
  modal.classList.remove('hidden');
  document.getElementById('inst-form-name').focus();
}

async function openEditModal(instanceId) {
  const inst = allInstances.find(i => i.id === instanceId);
  if (!inst) return;
  const modal = document.getElementById('inst-create-modal');
  if (!modal) return;

  document.getElementById('inst-form-title').textContent = 'Edit Instance';
  document.getElementById('inst-form-id').value = inst.id;
  document.getElementById('inst-form-name').value = inst.name;
  document.getElementById('inst-form-version').value = inst.version;
  document.getElementById('inst-form-loader').value = inst.loader;
  document.getElementById('inst-form-icon').value = inst.icon;
  document.getElementById('inst-form-desc').value = inst.description || '';
  document.getElementById('inst-form-color').value = inst.color || '#7c3aed';
  await populateVersionSelect(inst.version);
  modal.classList.remove('hidden');
}

function closeCreateModal() {
  document.getElementById('inst-create-modal')?.classList.add('hidden');
}

async function saveInstanceForm() {
  const id = document.getElementById('inst-form-id').value;
  const name = document.getElementById('inst-form-name').value.trim();
  const version = document.getElementById('inst-form-version').value;
  const loader = document.getElementById('inst-form-loader').value;
  const icon = document.getElementById('inst-form-icon').value.trim() || '🎮';
  const color = document.getElementById('inst-form-color').value;
  const description = document.getElementById('inst-form-desc').value.trim();

  if (!name) { showInstToast('Please enter an instance name', 'error'); return; }
  if (!version) { showInstToast('Please select a Minecraft version', 'error'); return; }

  if (id) {
    // Edit
    await window.electronAPI.instancesUpdate(id, { name, icon, color, description });
    showInstToast('Instance updated!', 'success');
  } else {
    // Create
    await window.electronAPI.instancesCreate({ name, version, loader, icon, color, description });
    showInstToast('Instance created!', 'success');
  }

  closeCreateModal();
  allInstances = await window.electronAPI.instancesList();
  renderInstanceGrid();
}

async function populateVersionSelect(selectedVersion = '') {
  const select = document.getElementById('inst-form-version');
  if (!select) return;
  select.innerHTML = '<option value="">Loading versions...</option>';
  try {
    const versions = await window.electronAPI.getMinecraftVersions();
    const releases = versions.filter(v => v.type === 'release');
    select.innerHTML = releases.map(v =>
      `<option value="${v.id}" ${v.id === selectedVersion ? 'selected' : ''}>${v.id}</option>`
    ).join('');
    if (!selectedVersion && releases.length) select.value = releases[0].id;
  } catch (e) {
    select.innerHTML = '<option value="">Failed to load versions</option>';
  }
}

async function populateModrinthVersionFilter(selectedVersion = '') {
  const select = document.getElementById('inst-modrinth-version');
  if (!select) return;
  try {
    const versions = await window.electronAPI.getMinecraftVersions();
    const releases = versions.filter(v => v.type === 'release').slice(0, 30);
    select.innerHTML = '<option value="">Any version</option>' + releases.map(v =>
      `<option value="${v.id}" ${v.id === selectedVersion ? 'selected' : ''}>${v.id}</option>`
    ).join('');
  } catch (e) {
    select.innerHTML = `<option value="${selectedVersion}">${selectedVersion}</option>`;
  }
}

// =================== INSTANCE ACTIONS ===================
async function launchInstance(instanceId) {
  const inst = allInstances.find(i => i.id === instanceId);
  if (!inst) return;

  const btn = document.querySelector(`.inst-play-btn[data-id="${instanceId}"]`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>'; }

  showInstToast(`Launching ${inst.name}...`, 'info');

  try {
    const result = await window.electronAPI.instancesLaunch(instanceId);
    if (!result.success) {
      showInstToast(`Launch failed: ${result.error}`, 'error');
    } else {
      showInstToast(`${inst.name} launched!`, 'success');
      allInstances = await window.electronAPI.instancesList();
      renderInstanceGrid();
    }
  } catch (e) {
    showInstToast(`Launch error: ${e.message}`, 'error');
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ri-play-fill"></i>'; }
}

async function duplicateInstance(instanceId) {
  const inst = allInstances.find(i => i.id === instanceId);
  if (!inst) return;
  await window.electronAPI.instancesDuplicate(instanceId);
  allInstances = await window.electronAPI.instancesList();
  renderInstanceGrid();
  showInstToast(`Duplicated "${inst.name}"`, 'success');
}

async function deleteInstance(instanceId) {
  const inst = allInstances.find(i => i.id === instanceId);
  if (!inst) return;
  if (!confirm(`Delete instance "${inst.name}"? This will also delete its mods.`)) return;
  await window.electronAPI.instancesDelete(instanceId);
  allInstances = await window.electronAPI.instancesList();
  renderInstanceGrid();
  showInstToast(`Deleted "${inst.name}"`, 'success');
}

// =================== EVENT LISTENERS ===================
function setupInstanceEventListeners() {
  // Create button in header
  document.getElementById('inst-create-btn')?.addEventListener('click', openCreateModal);

  // Modal save/close
  document.getElementById('inst-form-save')?.addEventListener('click', saveInstanceForm);
  document.getElementById('inst-form-cancel')?.addEventListener('click', closeCreateModal);
  document.getElementById('inst-modal-close')?.addEventListener('click', closeCreateModal);

  // Close modal on backdrop click
  document.getElementById('inst-create-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCreateModal();
  });

  // Detail view: back button
  document.getElementById('inst-detail-back')?.addEventListener('click', closeInstanceDetail);

  // Detail view: open folder
  document.getElementById('inst-detail-open-folder')?.addEventListener('click', () => {
    if (currentInstanceId) window.electronAPI.instancesOpenFolder(currentInstanceId);
  });

  // Detail view: launch
  document.getElementById('inst-detail-launch')?.addEventListener('click', () => {
    if (currentInstanceId) launchInstance(currentInstanceId);
  });

  // Mod search input
  document.getElementById('inst-mod-search-input')?.addEventListener('input', (e) => {
    clearTimeout(modSearchTimeout);
    const q = e.target.value.trim();
    if (q.length < 2) {
      document.getElementById('inst-mod-search-results').innerHTML = '';
      return;
    }
    modSearchTimeout = setTimeout(() => searchModrinthForInstance(q), 400);
  });

  // Modrinth search button
  document.getElementById('inst-mod-search-btn')?.addEventListener('click', () => {
    const q = document.getElementById('inst-mod-search-input').value.trim();
    searchModrinthForInstance(q);
  });

  // Version/loader filter change — re-search
  document.getElementById('inst-modrinth-version')?.addEventListener('change', () => {
    const q = document.getElementById('inst-mod-search-input').value.trim();
    if (q.length >= 2) searchModrinthForInstance(q);
  });
  document.getElementById('inst-modrinth-loader')?.addEventListener('change', () => {
    const q = document.getElementById('inst-mod-search-input').value.trim();
    if (q.length >= 2) searchModrinthForInstance(q);
  });

  // Icon picker
  const iconInput = document.getElementById('inst-form-icon');
  document.querySelectorAll('.inst-icon-option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (iconInput) iconInput.value = btn.textContent;
      document.querySelectorAll('.inst-icon-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

// =================== HELPERS ===================
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDownloads(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function showInstToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `inst-toast inst-toast-${type}`;
  toast.innerHTML = `<i class="ri-${type === 'success' ? 'check' : type === 'error' ? 'error-warning' : 'information'}-line"></i> ${escHtml(msg)}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('visible'), 10);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
