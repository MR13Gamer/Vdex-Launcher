// Mods module - CurseForge & Modrinth API integration
import { getSelectedVersion, getSelectedLoader } from './minecraft.js';

let currentSource = 'modrinth';
let currentModDetail = null;

// Filter & pagination state
let currentLoader = '';
let currentGameVersion = '';
let currentOffset = 0;
let totalHits = 0;
let currentResults = [];
let currentQuery = '';

// Detail view filter state
let allDetailVersions = [];
let detailLoader = '';
let detailGameVersion = '';
let detailVersionsShown = 50;

const MODRINTH_API = 'https://api.modrinth.com/v2';
// CurseForge requires an API key - user must provide their own
const CURSEFORGE_API = 'https://api.curseforge.com/v1';
const CURSEFORGE_API_KEY = '$2a$10$snS/X2aXBfkxdvrfMy952e0OTb0SHYh.48YPg.D.Yb9dP3lRP483m';

const CURSEFORGE_LOADER_MAP = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };

// Populate MC version dropdown from Modrinth tags
export async function populateVersionDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select || select.options.length > 1) return; // already populated

  try {
    const res = await fetch(`${MODRINTH_API}/tag/game_version`);
    const versions = await res.json();

    const releases = versions.filter(v => v.version_type === 'release');
    const grouped = {};
    for (const v of releases) {
      const major = v.version.split('.').slice(0, 2).join('.');
      if (!grouped[major]) grouped[major] = [];
      grouped[major].push(v.version);
    }

    for (const [major, vers] of Object.entries(grouped)) {
      const group = document.createElement('optgroup');
      group.label = major;
      for (const ver of vers) {
        const opt = document.createElement('option');
        opt.value = ver;
        opt.textContent = ver;
        group.appendChild(opt);
      }
      select.appendChild(group);
    }
  } catch (err) {
    console.error('Failed to load game versions:', err);
  }
}

// Search mods
export async function searchMods(queryText, source = currentSource, append = false) {
  currentSource = source;
  currentQuery = queryText;

  if (!append) {
    currentOffset = 0;
    currentResults = [];
  }

  let result;
  if (source === 'modrinth') {
    result = await searchModrinth(queryText);
  } else {
    result = await searchCurseForge(queryText);
  }

  totalHits = result.totalHits;
  currentResults = append ? [...currentResults, ...result.hits] : result.hits;

  return currentResults;
}

async function searchModrinth(queryText) {
  try {
    const facets = [['project_type:mod']];
    if (currentLoader) facets.push([`categories:${currentLoader}`]);
    if (currentGameVersion) facets.push([`versions:${currentGameVersion}`]);

    const params = new URLSearchParams({
      query: queryText,
      limit: '20',
      offset: String(currentOffset),
      facets: JSON.stringify(facets)
    });
    const res = await fetch(`${MODRINTH_API}/search?${params}`);
    const data = await res.json();

    const hits = (data.hits || []).map(mod => ({
      id: mod.project_id,
      name: mod.title,
      description: mod.description,
      icon: mod.icon_url,
      downloads: mod.downloads,
      author: mod.author,
      source: 'modrinth',
      url: `https://modrinth.com/mod/${mod.slug}`
    }));

    return { hits, totalHits: data.total_hits || 0 };
  } catch (err) {
    console.error('Modrinth search error:', err);
    return { hits: [], totalHits: 0 };
  }
}

async function searchCurseForge(queryText) {
  if (!CURSEFORGE_API_KEY) {
    return { hits: [{ error: true, message: 'CurseForge API key not configured. Set it in mods.js.' }], totalHits: 0 };
  }
  try {
    const params = new URLSearchParams({
      gameId: '432',
      searchFilter: queryText,
      pageSize: '20',
      index: String(currentOffset),
      classId: '6'
    });
    if (currentLoader && CURSEFORGE_LOADER_MAP[currentLoader]) {
      params.set('modLoaderType', String(CURSEFORGE_LOADER_MAP[currentLoader]));
    }
    if (currentGameVersion) {
      params.set('gameVersion', currentGameVersion);
    }

    const res = await fetch(`${CURSEFORGE_API}/mods/search?${params}`, {
      headers: { 'x-api-key': CURSEFORGE_API_KEY }
    });
    const data = await res.json();

    const hits = (data.data || []).map(mod => ({
      id: mod.id,
      name: mod.name,
      description: mod.summary,
      icon: mod.logo?.url || '',
      downloads: mod.downloadCount,
      author: mod.authors?.[0]?.name || 'Unknown',
      source: 'curseforge',
      url: mod.links?.websiteUrl || ''
    }));

    return { hits, totalHits: data.pagination?.totalCount || 0 };
  } catch (err) {
    console.error('CurseForge search error:', err);
    return { hits: [], totalHits: 0 };
  }
}

// Load more results (pagination)
export async function loadMoreMods() {
  currentOffset += 20;
  return searchMods(currentQuery, currentSource, true);
}

// Set loader filter
export function setLoaderFilter(loader) {
  currentLoader = loader;
}

// Set game version filter
export function setGameVersionFilter(version) {
  currentGameVersion = version;
}

// Get mod versions/files
export async function getModVersions(modId, source) {
  if (source === 'modrinth') {
    return getModrinthVersions(modId);
  } else {
    return getCurseForgeFiles(modId);
  }
}

async function getModrinthVersions(projectId) {
  try {
    const res = await fetch(`${MODRINTH_API}/project/${projectId}/version`);
    const data = await res.json();

    return data.map(v => ({
      id: v.id,
      name: v.name,
      versionNumber: v.version_number,
      gameVersions: v.game_versions,
      loaders: v.loaders,
      downloadUrl: v.files?.[0]?.url || '',
      filename: v.files?.[0]?.filename || `${v.name}.jar`,
      size: v.files?.[0]?.size || 0
    }));
  } catch (err) {
    console.error('Modrinth versions error:', err);
    return [];
  }
}

async function getCurseForgeFiles(modId) {
  if (!CURSEFORGE_API_KEY) return [];
  try {
    const res = await fetch(`${CURSEFORGE_API}/mods/${modId}/files?pageSize=50`, {
      headers: { 'x-api-key': CURSEFORGE_API_KEY }
    });
    const data = await res.json();

    return (data.data || []).map(f => {
      // CurseForge sometimes returns null downloadUrl — construct it from file ID
      let dlUrl = f.downloadUrl || '';
      if (!dlUrl && f.id && modId) {
        // CurseForge CDN URL pattern: /files/{first4digits}/{remaining}/filename
        const idStr = String(f.id);
        const part1 = idStr.substring(0, 4);
        const part2 = idStr.substring(4);
        dlUrl = `https://edge.forgecdn.net/files/${part1}/${part2}/${f.fileName}`;
      }
      return {
        id: f.id,
        name: f.displayName,
        versionNumber: f.displayName,
        gameVersions: f.gameVersions,
        loaders: [],
        downloadUrl: dlUrl,
        filename: f.fileName,
        size: f.fileLength || 0
      };
    });
  } catch (err) {
    console.error('CurseForge files error:', err);
    return [];
  }
}

// Download a mod file using preload bridge (instance-aware)
export async function downloadMod(downloadUrl, filename) {
  if (!downloadUrl) {
    return { success: false, error: 'No download URL available' };
  }
  try {
    const version = getSelectedVersion();
    const loader = getSelectedLoader();
    const result = await window.electronAPI.downloadFile(downloadUrl, filename, version, loader);
    return result;
  } catch (err) {
    console.error('Download error:', err);
    return { success: false, error: err.message || 'Download failed' };
  }
}

// List downloaded mods (instance-aware)
export async function getDownloadedMods() {
  try {
    const version = getSelectedVersion();
    const loader = getSelectedLoader();
    return await window.electronAPI.listMods(version, loader);
  } catch (err) {
    console.error('List mods error:', err);
    return [];
  }
}

// Delete a downloaded mod (instance-aware)
export async function deleteDownloadedMod(filename) {
  try {
    const version = getSelectedVersion();
    const loader = getSelectedLoader();
    return await window.electronAPI.deleteFile(filename, version, loader);
  } catch (err) {
    console.error('Delete mod error:', err);
    return { success: false };
  }
}

// Open mod page in browser
export async function openModPage(url) {
  if (url) {
    await window.electronAPI.openExternal(url);
  }
}

// Format file size
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format download count
export function formatDownloads(count) {
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
  return count.toString();
}

// Render mod search results
export function renderModResults(mods, append = false) {
  const container = document.getElementById('mod-results');
  if (!container) return;

  // Remove existing load-more and results-info
  const existingLoadMore = container.parentElement.querySelector('.load-more-btn');
  if (existingLoadMore) existingLoadMore.remove();
  const existingInfo = container.parentElement.querySelector('.mod-results-info');
  if (existingInfo) existingInfo.remove();

  if (mods.length === 0 && !append) {
    container.innerHTML = '<div class="empty-state"><i class="ri-search-line"></i><p>No mods found. Try a different search.</p></div>';
    return;
  }

  if (mods[0]?.error) {
    container.innerHTML = `<div class="empty-state"><i class="ri-error-warning-line"></i><p>${mods[0].message}</p></div>`;
    return;
  }

  const cardsHtml = mods.map(mod => `
    <div class="mod-result-card" data-mod-id="${mod.id}" data-source="${mod.source}">
      <div class="mod-result-icon">
        ${mod.icon ? `<img src="${mod.icon}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><i class="ri-puzzle-fill" style="display:none"></i>` : '<i class="ri-puzzle-fill"></i>'}
      </div>
      <div class="mod-result-info">
        <h3>${escapeHtml(mod.name)}</h3>
        <p>${escapeHtml(mod.description?.substring(0, 120) || '')}</p>
        <div class="mod-meta">
          <span><i class="ri-download-line"></i> ${formatDownloads(mod.downloads)}</span>
          <span><i class="ri-user-line"></i> ${escapeHtml(mod.author || '')}</span>
        </div>
      </div>
    </div>
  `).join('');

  if (append) {
    container.insertAdjacentHTML('beforeend', cardsHtml);
  } else {
    container.innerHTML = cardsHtml;
  }

  // Show results count
  if (totalHits > 0) {
    const info = document.createElement('div');
    info.className = 'mod-results-info';
    info.textContent = `Showing ${mods.length} of ${totalHits} results`;
    container.parentElement.insertBefore(info, container.nextSibling);
  }

  // Show Load More button if more results exist
  if (currentOffset + 20 < totalHits) {
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'load-more-btn';
    loadMoreBtn.innerHTML = '<i class="ri-arrow-down-line"></i> Load More';
    loadMoreBtn.addEventListener('click', async () => {
      loadMoreBtn.innerHTML = '<i class="ri-loader-4-line spinning"></i> Loading...';
      loadMoreBtn.disabled = true;
      const results = await loadMoreMods();
      renderModResults(results, true);
    });
    container.parentElement.insertBefore(loadMoreBtn, container.nextSibling.nextSibling);
  }

  // Re-attach click handlers on all cards
  container.querySelectorAll('.mod-result-card').forEach(card => {
    if (card.dataset.bound) return;
    card.dataset.bound = '1';
    card.addEventListener('click', () => {
      const modId = card.dataset.modId;
      const mod = mods.find(m => String(m.id) === modId);
      if (mod) showModDetail(mod);
    });
  });
}

// Show mod detail view
async function showModDetail(mod) {
  currentModDetail = mod;
  detailLoader = '';
  detailGameVersion = '';
  detailVersionsShown = 50;

  const detailView = document.getElementById('mod-detail');
  const searchView = document.getElementById('mod-search-view');

  if (searchView) searchView.classList.add('hidden');
  if (detailView) detailView.classList.remove('hidden');

  document.getElementById('detail-mod-name').textContent = mod.name;
  document.getElementById('detail-mod-desc').textContent = mod.description || '';
  document.getElementById('detail-mod-icon').innerHTML = mod.icon
    ? `<img src="${mod.icon}" alt="">`
    : '<i class="ri-puzzle-fill"></i>';

  // Reset detail filters UI
  document.querySelectorAll('.detail-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.loader === '');
  });
  const detailVersionSelect = document.getElementById('detail-version-filter');
  if (detailVersionSelect) detailVersionSelect.value = '';

  const versionsContainer = document.getElementById('mod-versions-list');
  versionsContainer.innerHTML = '<div class="loading-spinner"><i class="ri-loader-4-line"></i> Loading versions...</div>';

  const versions = await getModVersions(mod.id, mod.source);
  allDetailVersions = versions;
  filterDetailVersions();
}

// Filter detail versions by loader + game version (client-side)
export function filterDetailVersions() {
  let filtered = allDetailVersions;

  if (detailLoader) {
    filtered = filtered.filter(v =>
      v.loaders?.some(l => l.toLowerCase() === detailLoader.toLowerCase())
    );
  }

  if (detailGameVersion) {
    filtered = filtered.filter(v =>
      v.gameVersions?.includes(detailGameVersion)
    );
  }

  renderVersions(filtered.slice(0, detailVersionsShown), currentModDetail, filtered.length);
}

// Set detail loader filter
export function setDetailLoaderFilter(loader) {
  detailLoader = loader;
  detailVersionsShown = 50;
}

// Set detail game version filter
export function setDetailGameVersionFilter(version) {
  detailGameVersion = version;
  detailVersionsShown = 50;
}

function renderVersions(versions, mod, totalCount) {
  const container = document.getElementById('mod-versions-list');
  if (!container) return;

  if (versions.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No versions match the selected filters.</p></div>';
    return;
  }

  container.innerHTML = versions.map(v => {
    const hasUrl = v.downloadUrl && v.downloadUrl.trim() !== '';
    return `
    <div class="version-item">
      <div class="version-info">
        <span class="version-name">${escapeHtml(v.name)}</span>
        <span class="version-meta">${v.gameVersions?.slice(0, 3).join(', ') || ''} ${v.loaders?.join(', ') || ''}</span>
      </div>
      <div class="version-size">${formatSize(v.size)}</div>
      <button class="download-version-btn" data-url="${v.downloadUrl || ''}" data-filename="${v.filename}" ${!hasUrl ? 'disabled title="No download available"' : ''}>
        <i class="${hasUrl ? 'ri-download-line' : 'ri-forbid-line'}"></i>
      </button>
    </div>
  `;
  }).join('');

  // Show Load More for versions if there are more
  if (totalCount && detailVersionsShown < totalCount) {
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'load-more-btn';
    loadMoreBtn.innerHTML = `<i class="ri-arrow-down-line"></i> Load More (${detailVersionsShown} of ${totalCount})`;
    loadMoreBtn.addEventListener('click', () => {
      detailVersionsShown += 50;
      filterDetailVersions();
    });
    container.appendChild(loadMoreBtn);
  }

  container.querySelectorAll('.download-version-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = btn.dataset.url;
      const filename = btn.dataset.filename;
      btn.innerHTML = '<i class="ri-loader-4-line spinning"></i>';
      btn.disabled = true;

      console.log(`Downloading mod: ${filename} from ${url}`);
      const result = await downloadMod(url, filename);
      console.log('Download result:', result);
      if (result?.success) {
        btn.innerHTML = '<i class="ri-check-line"></i>';
        btn.title = 'Downloaded!';
        refreshDownloadedMods();
      } else {
        const errMsg = result?.error || 'Download failed';
        console.error('Mod download failed:', errMsg);
        btn.innerHTML = '<i class="ri-error-warning-line"></i>';
        btn.title = errMsg;
        setTimeout(() => { btn.innerHTML = '<i class="ri-download-line"></i>'; btn.disabled = false; btn.title = ''; }, 3000);
      }
    });
  });
}

// Go back from detail view
export function closeModDetail() {
  const detailView = document.getElementById('mod-detail');
  const searchView = document.getElementById('mod-search-view');
  if (detailView) detailView.classList.add('hidden');
  if (searchView) searchView.classList.remove('hidden');
  currentModDetail = null;
  allDetailVersions = [];
}

// Render downloaded mods with toggle on/off
export async function refreshDownloadedMods() {
  const container = document.getElementById('downloaded-mods-list');
  if (!container) return;

  const mods = await getDownloadedMods();

  if (mods.length === 0) {
    container.innerHTML = '<div class="empty-state small"><p>No downloaded mods yet.</p></div>';
    return;
  }

  const enabledCount = mods.filter(m => m.enabled !== false).length;
  const disabledCount = mods.length - enabledCount;

  container.innerHTML = `
    <div class="mod-list-header">
      <span class="mod-count">${mods.length} mod${mods.length !== 1 ? 's' : ''} (${enabledCount} active${disabledCount ? `, ${disabledCount} disabled` : ''})</span>
    </div>
  ` + mods.map(mod => {
    const isEnabled = mod.enabled !== false;
    const displayName = mod.displayName || mod.name;
    return `
    <div class="downloaded-mod-item ${isEnabled ? '' : 'mod-disabled'}">
      <i class="ri-file-fill" style="color:${isEnabled ? '#a78bfa' : '#666'}"></i>
      <div class="downloaded-mod-info">
        <span class="downloaded-mod-name">${escapeHtml(displayName)}</span>
        <span class="downloaded-mod-size">${formatSize(mod.size)}</span>
      </div>
      <label class="mod-toggle" title="${isEnabled ? 'Disable mod' : 'Enable mod'}">
        <input type="checkbox" class="mod-toggle-input" data-name="${escapeHtml(mod.name)}" ${isEnabled ? 'checked' : ''}>
        <span class="mod-toggle-slider"></span>
      </label>
      <button class="mod-action-btn delete-mod-btn" data-name="${escapeHtml(mod.name)}" title="Delete">
        <i class="ri-delete-bin-line"></i>
      </button>
    </div>
  `}).join('');

  // Toggle mod on/off
  container.querySelectorAll('.mod-toggle-input').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      const result = await window.electronAPI.toggleMod(toggle.dataset.name);
      if (result.success) {
        refreshDownloadedMods();
      } else {
        toggle.checked = !toggle.checked;
        console.error('Toggle failed:', result.error);
      }
    });
  });

  container.querySelectorAll('.delete-mod-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deleteDownloadedMod(btn.dataset.name);
      refreshDownloadedMods();
    });
  });
}

// =================== RECOMMENDED MODS ===================

const RECOMMENDED_SLUGS = {
  popular: ['sodium', 'iris', 'lithium', 'fabric-api', 'modmenu', 'journeymap', 'jei', 'xaeros-minimap', 'appleskin', 'waystones'],
  performance: ['sodium', 'lithium', 'starlight', 'ferritecore', 'entityculling', 'memoryleakfix', 'immediatelyfast', 'modernfix'],
  qol: ['modmenu', 'appleskin', 'roughly-enough-items', 'mouse-tweaks', 'controlling', 'inventory-profiles-next', 'jade', 'light-overlay'],
  worldgen: ['terralith', 'biomes-o-plenty', 'tectonic', 'nullscape', 'amplified-nether', 'geophilic', 'regions-unexplored'],
  libraries: ['fabric-api', 'cloth-config', 'architectury-api', 'geckolib', 'moonlight', 'iceberg', 'puzzles-lib']
};

export async function loadRecommendedMods(category = 'popular') {
  const slugs = RECOMMENDED_SLUGS[category] || RECOMMENDED_SLUGS.popular;
  const grid = document.getElementById('recommended-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="loading-spinner"><i class="ri-loader-4-line"></i> Loading recommendations...</div>';

  const mods = [];
  const fetchPromises = slugs.map(async (slug) => {
    try {
      const res = await fetch(`${MODRINTH_API}/project/${slug}`);
      if (res.ok) {
        const data = await res.json();
        mods.push({
          id: data.id,
          slug: data.slug,
          name: data.title,
          description: data.description,
          icon: data.icon_url,
          downloads: data.downloads,
          author: data.team || '',
          source: 'modrinth'
        });
      }
    } catch (e) {
      console.error(`Failed to fetch ${slug}:`, e);
    }
  });

  await Promise.all(fetchPromises);

  if (mods.length === 0) {
    grid.innerHTML = '<div class="empty-state small"><p>Could not load recommendations.</p></div>';
    return;
  }

  grid.innerHTML = mods.map(mod => `
    <div class="rec-mod-card" data-mod-id="${mod.id}" data-slug="${mod.slug}">
      <div class="rec-mod-header">
        <div class="rec-mod-icon">
          ${mod.icon ? `<img src="${mod.icon}" alt="" onerror="this.style.display='none'">` : '<i class="ri-puzzle-fill"></i>'}
        </div>
        <div>
          <div class="rec-mod-name">${escapeHtml(mod.name)}</div>
          <div class="rec-mod-author">${escapeHtml(mod.author)}</div>
        </div>
      </div>
      <div class="rec-mod-desc">${escapeHtml(mod.description?.substring(0, 100) || '')}</div>
      <div class="rec-mod-footer">
        <span class="rec-mod-downloads"><i class="ri-download-line"></i> ${formatDownloads(mod.downloads)}</span>
        <button class="quick-install-btn" data-slug="${mod.slug}" data-mod-id="${mod.id}">
          <i class="ri-download-line"></i> Install
        </button>
      </div>
    </div>
  `).join('');

  // Attach click handlers for quick install
  grid.querySelectorAll('.quick-install-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.innerHTML = '<i class="ri-loader-4-line spinning"></i> Downloading...';
      console.log(`Quick installing mod: ${btn.dataset.slug}`);
      const result = await quickInstallMod(btn.dataset.slug);
      console.log('Quick install result:', result);
      if (result) {
        btn.innerHTML = '<i class="ri-check-line"></i> Installed';
        refreshDownloadedMods();
      } else {
        btn.innerHTML = '<i class="ri-error-warning-line"></i> Failed';
        setTimeout(() => { btn.innerHTML = '<i class="ri-download-line"></i> Install'; btn.disabled = false; }, 3000);
      }
    });
  });

  // Card click opens detail
  grid.querySelectorAll('.rec-mod-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.quick-install-btn')) return;
      const mod = mods.find(m => m.id === card.dataset.modId);
      if (mod) showModDetail(mod);
    });
  });
}

// Quick install: fetch latest version, check dependencies, download
async function quickInstallMod(slug) {
  try {
    // Get project versions
    const res = await fetch(`${MODRINTH_API}/project/${slug}/version`);
    const versions = await res.json();
    if (!versions || versions.length === 0) return false;

    const latest = versions[0];
    const mainFile = latest.files?.[0];
    if (!mainFile?.url) return false;

    // Download main file
    const result = await downloadMod(mainFile.url, mainFile.filename);
    if (!result?.success) return false;

    // Check dependencies and download them
    if (latest.dependencies && latest.dependencies.length > 0) {
      for (const dep of latest.dependencies) {
        if (dep.dependency_type === 'required' && dep.project_id) {
          try {
            const depRes = await fetch(`${MODRINTH_API}/project/${dep.project_id}/version`);
            const depVersions = await depRes.json();
            if (depVersions && depVersions.length > 0) {
              const depFile = depVersions[0].files?.[0];
              if (depFile?.url) {
                await downloadMod(depFile.url, depFile.filename);
              }
            }
          } catch (e) {
            console.error('Failed to install dependency:', e);
          }
        }
      }
    }

    return true;
  } catch (e) {
    console.error('Quick install error:', e);
    return false;
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
