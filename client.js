/**
 * VDeX Client — Lunar Client-style mod management UI
 * Renderer module for the Client page
 */

let allClientMods = [];
let currentCategory = 'All';
let clientSearchQuery = '';

// ═══════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════
export async function initClient() {
  await loadClientMods();
  initClientSubtabs();
  initCategoryFilters();
  initClientSearch();
  initProfileCards();
  initCosmetics();
  initHudEditor();
}

// ═══════════════════════════════════════════════════════════════════════
// SUB-TABS
// ═══════════════════════════════════════════════════════════════════════
function initClientSubtabs() {
  document.querySelectorAll('.client-subtab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.client-subtab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.client-subtab-content').forEach(c => c.classList.remove('active'));
      const target = document.getElementById(`ctab-${tab.dataset.ctab}`);
      if (target) target.classList.add('active');

      // Refresh content on tab switch
      if (tab.dataset.ctab === 'client-mods') loadClientMods();
      if (tab.dataset.ctab === 'client-profiles') renderProfiles();
      if (tab.dataset.ctab === 'client-cosmetics') loadCosmetics();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CLIENT MODS
// ═══════════════════════════════════════════════════════════════════════
async function loadClientMods() {
  try {
    allClientMods = await window.electronAPI.clientGetMods();
    renderModGrid();
    updateModCounter();
  } catch (e) {
    console.error('Failed to load client mods:', e);
  }
}

function initCategoryFilters() {
  document.querySelectorAll('.client-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.client-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.category;
      renderModGrid();
    });
  });
}

function initClientSearch() {
  const input = document.getElementById('client-mod-search');
  if (!input) return;
  input.addEventListener('input', (e) => {
    clientSearchQuery = e.target.value.toLowerCase();
    renderModGrid();
  });
}

function getFilteredMods() {
  return allClientMods.filter(mod => {
    const matchCategory = currentCategory === 'All' || mod.category === currentCategory;
    const matchSearch = !clientSearchQuery ||
      mod.name.toLowerCase().includes(clientSearchQuery) ||
      mod.description.toLowerCase().includes(clientSearchQuery);
    return matchCategory && matchSearch;
  });
}

function renderModGrid() {
  const grid = document.getElementById('client-mods-grid');
  if (!grid) return;

  const mods = getFilteredMods();

  if (mods.length === 0) {
    grid.innerHTML = `<div class="client-empty"><i class="ri-puzzle-fill"></i><p>No mods found</p></div>`;
    return;
  }

  grid.innerHTML = mods.map(mod => `
    <div class="client-mod-card ${mod.enabled ? 'enabled' : ''}" data-mod-id="${mod.id}">
      <div class="client-mod-header">
        <div class="client-mod-icon"><i class="${mod.icon}"></i></div>
        <label class="client-toggle">
          <input type="checkbox" ${mod.enabled ? 'checked' : ''} data-toggle-mod="${mod.id}" />
          <span class="client-toggle-slider"></span>
        </label>
      </div>
      <div class="client-mod-body">
        <h4 class="client-mod-name">${mod.name}</h4>
        <p class="client-mod-desc">${mod.description}</p>
        <div class="client-mod-footer">
          <span class="client-mod-cat"><i class="ri-price-tag-3-fill"></i> ${mod.category}</span>
          ${mod.modrinthSlug ? '<span class="client-mod-badge auto">Auto-Install</span>' : '<span class="client-mod-badge manual">Config Only</span>'}
        </div>
      </div>
      ${Object.keys(mod.configKeys || {}).length > 0 ? `<button class="client-mod-config-btn" data-config-mod="${mod.id}" title="Configure"><i class="ri-settings-3-fill"></i></button>` : ''}
    </div>
  `).join('');

  // Toggle listeners
  grid.querySelectorAll('[data-toggle-mod]').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      e.stopPropagation();
      const modId = cb.dataset.toggleMod;
      const enabled = cb.checked;
      await window.electronAPI.clientToggleMod(modId, enabled);
      const card = cb.closest('.client-mod-card');
      if (card) card.classList.toggle('enabled', enabled);
      updateModCounter();
    });
  });

  // Config button listeners
  grid.querySelectorAll('[data-config-mod]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModConfig(btn.dataset.configMod);
    });
  });
}

function updateModCounter() {
  const counter = document.getElementById('client-mod-count');
  if (!counter) return;
  const enabled = allClientMods.filter(m => m.enabled).length;
  counter.textContent = `${enabled}/${allClientMods.length} mods enabled`;
}

// ═══════════════════════════════════════════════════════════════════════
// MOD CONFIG MODAL
// ═══════════════════════════════════════════════════════════════════════
async function openModConfig(modId) {
  const mod = allClientMods.find(m => m.id === modId);
  if (!mod) return;

  const config = await window.electronAPI.clientGetModConfig(modId);
  const modal = document.getElementById('client-config-modal');
  const title = document.getElementById('client-config-title');
  const body = document.getElementById('client-config-body');

  title.innerHTML = `<i class="${mod.icon}"></i> ${mod.name} Settings`;

  // Build config form
  let html = '';
  for (const [key, value] of Object.entries(config)) {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

    if (typeof value === 'boolean') {
      html += `
        <div class="config-item">
          <span class="config-label">${label}</span>
          <label class="client-toggle small">
            <input type="checkbox" ${value ? 'checked' : ''} data-cfg-key="${key}" data-cfg-type="bool" />
            <span class="client-toggle-slider"></span>
          </label>
        </div>`;
    } else if (typeof value === 'number') {
      const isFloat = !Number.isInteger(value);
      html += `
        <div class="config-item">
          <span class="config-label">${label}</span>
          <input type="number" class="config-input" value="${value}" step="${isFloat ? 0.1 : 1}" data-cfg-key="${key}" data-cfg-type="number" />
        </div>`;
    } else if (typeof value === 'string' && value.startsWith('#') && value.length <= 9) {
      html += `
        <div class="config-item">
          <span class="config-label">${label}</span>
          <div class="config-color-wrap">
            <input type="color" class="config-color" value="${value.substring(0, 7)}" data-cfg-key="${key}" data-cfg-type="color" />
            <span class="config-color-hex">${value}</span>
          </div>
        </div>`;
    } else if (typeof value === 'string' && ['top-left', 'top-right', 'top-center', 'bottom-left', 'bottom-right', 'center', 'right', 'top'].includes(value)) {
      html += `
        <div class="config-item">
          <span class="config-label">${label}</span>
          <select class="config-select" data-cfg-key="${key}" data-cfg-type="string">
            ${['top-left', 'top-right', 'top-center', 'bottom-left', 'bottom-right', 'center', 'right'].map(p =>
              `<option value="${p}" ${p === value ? 'selected' : ''}>${p.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>`
            ).join('')}
          </select>
        </div>`;
    } else if (typeof value === 'string' && !Array.isArray(value)) {
      html += `
        <div class="config-item">
          <span class="config-label">${label}</span>
          <input type="text" class="config-input" value="${value}" data-cfg-key="${key}" data-cfg-type="string" />
        </div>`;
    }
    // Skip arrays/objects for simplicity
  }

  body.innerHTML = html || '<p class="config-empty">No configurable options</p>';
  modal.classList.remove('hidden');
  modal.dataset.modId = modId;

  // Color input live preview
  body.querySelectorAll('.config-color').forEach(input => {
    input.addEventListener('input', () => {
      const hex = input.parentElement.querySelector('.config-color-hex');
      if (hex) hex.textContent = input.value;
    });
  });
}

function closeModConfig() {
  const modal = document.getElementById('client-config-modal');
  modal.classList.add('hidden');
}

async function saveModConfig() {
  const modal = document.getElementById('client-config-modal');
  const modId = modal.dataset.modId;
  const body = document.getElementById('client-config-body');
  const update = {};

  body.querySelectorAll('[data-cfg-key]').forEach(el => {
    const key = el.dataset.cfgKey;
    const type = el.dataset.cfgType;
    if (type === 'bool') update[key] = el.checked;
    else if (type === 'number') update[key] = parseFloat(el.value);
    else if (type === 'color') update[key] = el.value;
    else update[key] = el.value;
  });

  await window.electronAPI.clientSetModConfig(modId, update);
  closeModConfig();

  // Show saved toast
  showClientToast('Settings saved');
}

// Init modal buttons
document.getElementById('client-config-close')?.addEventListener('click', closeModConfig);
document.getElementById('client-config-save')?.addEventListener('click', saveModConfig);

// ═══════════════════════════════════════════════════════════════════════
// PROFILES
// ═══════════════════════════════════════════════════════════════════════
async function initProfileCards() {
  await renderProfiles();
}

async function renderProfiles() {
  const container = document.getElementById('client-profiles-grid');
  if (!container) return;

  try {
    const profiles = await window.electronAPI.clientGetProfiles();
    container.innerHTML = profiles.map(p => `
      <div class="client-profile-card ${p.active ? 'active' : ''}" data-profile-id="${p.id}">
        <div class="client-profile-icon" style="background:${p.color}20;color:${p.color}">
          <i class="${p.icon}"></i>
        </div>
        <div class="client-profile-info">
          <h3>${p.name}</h3>
          <p>${p.description}</p>
          <div class="client-profile-mods">
            <i class="ri-puzzle-fill"></i> ${p.mods.length} mods
          </div>
        </div>
        <button class="client-profile-apply ${p.active ? 'applied' : ''}" data-apply-profile="${p.id}">
          ${p.active ? '<i class="ri-check-fill"></i> Active' : '<i class="ri-play-fill"></i> Apply'}
        </button>
      </div>
    `).join('');

    container.querySelectorAll('[data-apply-profile]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const profileId = btn.dataset.applyProfile;
        await window.electronAPI.clientApplyProfile(profileId);
        showClientToast(`Profile "${profiles.find(p => p.id === profileId)?.name}" applied`);
        await loadClientMods();
        await renderProfiles();
      });
    });
  } catch (e) {
    container.innerHTML = '<p class="client-empty">Failed to load profiles</p>';
  }
}

// ═══════════════════════════════════════════════════════════════════════
// COSMETICS
// ═══════════════════════════════════════════════════════════════════════
async function initCosmetics() {
  await loadCosmetics();
  initCosmeticTabs();
}

function initCosmeticTabs() {
  document.querySelectorAll('.cosmetic-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cosmetic-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.cosmetic-section').forEach(s => s.classList.remove('active'));
      const target = document.getElementById(`cosmetic-${btn.dataset.cosmeticTab}`);
      if (target) target.classList.add('active');
    });
  });
}

async function loadCosmetics() {
  try {
    const data = await window.electronAPI.clientGetCosmetics();
    renderCapeGrid(data.available.capes, data.active.cape);
    renderWingsGrid(data.available.wings, data.active.wings);
    renderEmoteGrid(data.available.emotes, data.active.emote);
    renderHatGrid(data.available.hats, data.active.hat);
    renderBandanaGrid(data.available.bandanas, data.active.bandana);
  } catch (e) {
    console.error('Failed to load cosmetics:', e);
  }
}

function renderCapeGrid(capes, activeId) {
  const grid = document.getElementById('cosmetic-capes-grid');
  if (!grid) return;
  grid.innerHTML = capes.map(c => `
    <div class="cosmetic-item ${c.id === activeId ? 'selected' : ''}" data-cosmetic="cape" data-cosmetic-id="${c.id}">
      <div class="cosmetic-preview" style="background:linear-gradient(135deg, ${c.color}, ${c.color}88)">
        ${c.custom ? '<i class="ri-upload-2-fill"></i>' : '<i class="ri-t-shirt-fill"></i>'}
      </div>
      <span class="cosmetic-name">${c.name}</span>
    </div>
  `).join('');
  bindCosmeticSelection(grid, 'cape');
}

function renderWingsGrid(wings, activeId) {
  const grid = document.getElementById('cosmetic-wings-grid');
  if (!grid) return;
  grid.innerHTML = wings.map(w => `
    <div class="cosmetic-item ${w.id === activeId ? 'selected' : ''}" data-cosmetic="wings" data-cosmetic-id="${w.id}">
      <div class="cosmetic-preview" style="background:linear-gradient(135deg, ${w.color}, ${w.color}88)">
        <i class="ri-leaf-fill"></i>
      </div>
      <span class="cosmetic-name">${w.name}</span>
    </div>
  `).join('');
  bindCosmeticSelection(grid, 'wings');
}

function renderEmoteGrid(emotes, activeId) {
  const grid = document.getElementById('cosmetic-emotes-grid');
  if (!grid) return;
  grid.innerHTML = emotes.map(e => `
    <div class="cosmetic-item ${e.id === activeId ? 'selected' : ''}" data-cosmetic="emote" data-cosmetic-id="${e.id}">
      <div class="cosmetic-preview emote-preview">
        <i class="${e.icon}"></i>
      </div>
      <span class="cosmetic-name">${e.name}</span>
    </div>
  `).join('');
  bindCosmeticSelection(grid, 'emote');
}

function renderHatGrid(hats, activeId) {
  const grid = document.getElementById('cosmetic-hats-grid');
  if (!grid) return;
  grid.innerHTML = hats.map(h => `
    <div class="cosmetic-item ${h.id === activeId ? 'selected' : ''}" data-cosmetic="hat" data-cosmetic-id="${h.id}">
      <div class="cosmetic-preview" style="background:linear-gradient(135deg, ${h.color}, ${h.color}88)">
        <i class="ri-vip-crown-fill"></i>
      </div>
      <span class="cosmetic-name">${h.name}</span>
    </div>
  `).join('');
  bindCosmeticSelection(grid, 'hat');
}

function renderBandanaGrid(bandanas, activeId) {
  const grid = document.getElementById('cosmetic-bandanas-grid');
  if (!grid) return;
  grid.innerHTML = bandanas.map(b => `
    <div class="cosmetic-item ${b.id === activeId ? 'selected' : ''}" data-cosmetic="bandana" data-cosmetic-id="${b.id}">
      <div class="cosmetic-preview" style="background:linear-gradient(135deg, ${b.color}, ${b.color}88)">
        <i class="ri-shirt-fill"></i>
      </div>
      <span class="cosmetic-name">${b.name}</span>
    </div>
  `).join('');
  bindCosmeticSelection(grid, 'bandana');
}

function bindCosmeticSelection(grid, type) {
  grid.querySelectorAll('.cosmetic-item').forEach(item => {
    item.addEventListener('click', async () => {
      const id = item.dataset.cosmeticId;
      await window.electronAPI.clientSetCosmetic(type, id);
      grid.querySelectorAll('.cosmetic-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      showClientToast(`${type.charAt(0).toUpperCase() + type.slice(1)} updated`);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// HUD LAYOUT EDITOR
// ═══════════════════════════════════════════════════════════════════════
let hudLayout = {};
let draggingElement = null;
let dragOffset = { x: 0, y: 0 };

async function initHudEditor() {
  try {
    hudLayout = await window.electronAPI.clientGetHudLayout();
  } catch (e) {
    hudLayout = {};
  }
  renderHudEditor();

  document.getElementById('hud-reset-btn')?.addEventListener('click', resetHudLayout);
  document.getElementById('hud-save-btn')?.addEventListener('click', saveHudLayout);
}

function renderHudEditor() {
  const canvas = document.getElementById('hud-editor-canvas');
  if (!canvas) return;

  // Get HUD mods only
  const hudMods = allClientMods.filter(m => m.enabled && m.category === 'HUD');

  // Default positions for HUD elements
  const defaultPositions = {
    'top-left': { x: 5, y: 5 },
    'top-right': { x: 75, y: 5 },
    'top-center': { x: 40, y: 5 },
    'bottom-left': { x: 5, y: 85 },
    'bottom-right': { x: 75, y: 85 },
    'center': { x: 40, y: 45 },
    'right': { x: 80, y: 30 }
  };

  let usedPositions = {};

  canvas.innerHTML = `
    <div class="hud-screen-border">
      <div class="hud-hotbar"></div>
      <div class="hud-crosshair">+</div>
      ${hudMods.map((mod, i) => {
        const savedPos = hudLayout[mod.id];
        const configPos = mod.config?.position || 'top-left';
        let pos = savedPos || defaultPositions[configPos] || { x: 5 + (i * 12) % 80, y: 5 + Math.floor(i / 6) * 15 };

        // Avoid overlaps
        const posKey = `${Math.round(pos.x)}-${Math.round(pos.y)}`;
        if (usedPositions[posKey]) {
          pos = { x: pos.x, y: pos.y + 8 };
        }
        usedPositions[posKey] = true;

        return `
          <div class="hud-element" data-hud-mod="${mod.id}"
               style="left:${pos.x}%;top:${pos.y}%"
               title="${mod.name}">
            <i class="${mod.icon}"></i>
            <span>${mod.name}</span>
          </div>`;
      }).join('')}
    </div>
  `;

  // Make elements draggable
  canvas.querySelectorAll('.hud-element').forEach(el => {
    el.addEventListener('mousedown', startDrag);
  });

  canvas.addEventListener('mousemove', onDrag);
  canvas.addEventListener('mouseup', endDrag);
  canvas.addEventListener('mouseleave', endDrag);
}

function startDrag(e) {
  draggingElement = e.currentTarget;
  const rect = draggingElement.parentElement.getBoundingClientRect();
  dragOffset.x = e.clientX - draggingElement.offsetLeft;
  dragOffset.y = e.clientY - draggingElement.offsetTop;
  draggingElement.classList.add('dragging');
  e.preventDefault();
}

function onDrag(e) {
  if (!draggingElement) return;
  const canvas = draggingElement.parentElement;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  draggingElement.style.left = `${Math.max(0, Math.min(90, x))}%`;
  draggingElement.style.top = `${Math.max(0, Math.min(90, y))}%`;
}

function endDrag() {
  if (!draggingElement) return;
  const modId = draggingElement.dataset.hudMod;
  const x = parseFloat(draggingElement.style.left);
  const y = parseFloat(draggingElement.style.top);
  hudLayout[modId] = { x, y };
  draggingElement.classList.remove('dragging');
  draggingElement = null;
}

async function saveHudLayout() {
  await window.electronAPI.clientSetHudLayout(hudLayout);
  showClientToast('HUD layout saved');
}

function resetHudLayout() {
  hudLayout = {};
  renderHudEditor();
  showClientToast('HUD layout reset to defaults');
}

// ═══════════════════════════════════════════════════════════════════════
// INSTALL CLIENT MODS (before launch)
// ═══════════════════════════════════════════════════════════════════════
export async function installClientModsForLaunch(version, loader) {
  if (loader !== 'fabric' && loader !== 'quilt') return { skipped: true };
  try {
    const result = await window.electronAPI.clientInstallMods(version, loader);
    return result;
  } catch (e) {
    console.error('Client mod install failed:', e);
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ENABLE ALL / DISABLE ALL
// ═══════════════════════════════════════════════════════════════════════
document.getElementById('client-enable-all')?.addEventListener('click', async () => {
  for (const mod of allClientMods) {
    await window.electronAPI.clientToggleMod(mod.id, true);
  }
  await loadClientMods();
  showClientToast('All mods enabled');
});

document.getElementById('client-disable-all')?.addEventListener('click', async () => {
  for (const mod of allClientMods) {
    await window.electronAPI.clientToggleMod(mod.id, false);
  }
  await loadClientMods();
  showClientToast('All mods disabled');
});

// ═══════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════
function showClientToast(message) {
  let toast = document.getElementById('client-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'client-toast';
    toast.className = 'client-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}
